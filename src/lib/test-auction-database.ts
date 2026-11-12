import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

/** Real application SQL with adapters for managed Supabase services. */
export async function createTestAuctionDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated, service_role;
    create publication supabase_realtime;
    create schema realtime;
    create table realtime.messages (
      id uuid primary key default gen_random_uuid(), payload jsonb, event text,
      topic text, private boolean, extension text,
      inserted_at timestamp default (clock_timestamp() at time zone 'UTC')
    );
    alter table realtime.messages enable row level security;
    grant usage on schema realtime to anon, authenticated;
    grant select, insert on realtime.messages to anon, authenticated;
    create function realtime.topic() returns text language sql stable as $$
      select current_setting('realtime.topic', true)
    $$;
    create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
    returns void language plpgsql as $$
    begin
      perform set_config('realtime.topic', topic, true);
      if current_setting('test.broadcast_failure', true) = 'silent' then return; end if;
      begin
        insert into realtime.messages (payload, event, topic, private, extension)
          values (payload, event, topic, private, 'broadcast');
      exception when others then
        raise warning 'WarnSendingBroadcastMessage: %', SQLERRM;
      end;
    end;
    $$;
    create schema cron;
    create table cron.job (jobid bigint generated always as identity primary key,
      jobname text unique, schedule text, command text);
    create function cron.schedule(p_name text, p_schedule text, p_command text)
      returns bigint language sql as $$
      insert into cron.job (jobname, schedule, command) values (p_name, p_schedule, p_command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
      returning jobid
    $$;
  `);
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter(file => file.endsWith(".sql")).sort()) {
    const sql = await readFile(new URL(file, directory), "utf8");
    // PGlite includes gen_random_uuid; managed Realtime and Cron are adapters.
    await db.exec(sql.replace("create extension if not exists pgcrypto;", "")
      .replace("create extension if not exists pg_cron with schema pg_catalog;", ""));
  }
  return db;
}
