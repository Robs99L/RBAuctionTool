-- Store bid/name notifications cheaply in the accepting transaction. One Cron
-- publisher sends up to 1,000 public records in a single private Broadcast.
-- Clients enable this transport only after migration and Cron verification.

create extension if not exists pg_cron with schema pg_catalog;

create table private.auction_live_outbox (
  id bigint generated always as identity primary key,
  event jsonb not null,
  queued_at timestamptz not null default clock_timestamp()
);
alter table private.auction_live_outbox enable row level security;
revoke all on private.auction_live_outbox from public, anon, authenticated;

create table private.auction_live_publisher (
  id boolean primary key default true check (id),
  last_published_at timestamptz
);
insert into private.auction_live_publisher (id) values (true);
alter table private.auction_live_publisher enable row level security;
revoke all on private.auction_live_publisher from public, anon, authenticated;

create function private.enqueue_auction_live_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_event jsonb;
begin
  if tg_table_name = 'bids' then
    v_event := jsonb_build_object('kind', 'bid', 'record', jsonb_build_object(
      'id', new.id, 'auction_id', new.auction_id,
      'participant_id', new.participant_id, 'amount', new.amount,
      'created_at', new.created_at
    ));
  elsif tg_table_name = 'participants' then
    v_event := jsonb_build_object('kind', 'participant', 'record', jsonb_build_object(
      'id', new.id, 'auction_id', new.auction_id, 'username', new.username
    ));
  else
    raise exception 'Unexpected auction live source.';
  end if;
  insert into private.auction_live_outbox (event) values (v_event);
  return new;
end;
$$;
revoke all on function private.enqueue_auction_live_event() from public, anon, authenticated;

create trigger bids_enqueue_live_event after insert on public.bids
  for each row execute function private.enqueue_auction_live_event();
create trigger participants_enqueue_live_event after insert on public.participants
  for each row execute function private.enqueue_auction_live_event();

-- Broadcast authorization permits reception, never client-generated auction
-- updates. Keep existing policies for unrelated topics intact.
create policy auction_live_receive on realtime.messages
  for select to authenticated
  using ((select realtime.topic()) = 'auction-live' and topic = 'auction-live' and extension = 'broadcast');
create policy auction_live_no_client_send on realtime.messages
  as restrictive for insert to anon, authenticated
  with check ((select realtime.topic()) is distinct from 'auction-live' and topic is distinct from 'auction-live');

create function private.publish_auction_live_batch()
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ids bigint[];
  v_events jsonb;
  v_batch_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
  v_sent_at timestamptz;
begin
  -- A concurrent invocation skips immediately; it never competes for bid locks.
  if not pg_try_advisory_xact_lock(726218, 1) then return 0; end if;
  select last_published_at into v_sent_at from private.auction_live_publisher where id;
  -- Allow minor Cron scheduling jitter while avoiding repeated manual flushes.
  if v_sent_at is not null and v_now < v_sent_at + interval '900 milliseconds' then
    return 0;
  end if;

  select array_agg(pending.id order by pending.id),
         jsonb_agg(pending.event order by pending.id)
    into v_ids, v_events
  from (
    select outbox.id, outbox.event from private.auction_live_outbox as outbox
    order by outbox.id limit 1000 for update skip locked
  ) as pending;
  if v_ids is null then return 0; end if;

  perform realtime.send(
    jsonb_build_object('protocol', 1, 'batch_id', v_batch_id, 'events', v_events),
    'auction_batch', 'auction-live', true
  );
  -- realtime.send can swallow insert failures and emit only a WARNING. Verify
  -- that it actually wrote this message before removing its queued records.
  if not exists (
    select 1 from realtime.messages as message
    where message.topic = 'auction-live' and message.extension = 'broadcast'
      and message.private is true
      and message.inserted_at >= (transaction_timestamp() at time zone 'UTC') - interval '1 minute'
      and message.payload ->> 'batch_id' = v_batch_id::text
  ) then
    raise warning 'Auction batch not inserted; keeping pending live events for retry.';
    return 0;
  end if;
  delete from private.auction_live_outbox where id = any(v_ids);
  update private.auction_live_publisher set last_published_at = clock_timestamp() where id;
  return cardinality(v_ids);
end;
$$;
revoke all on function private.publish_auction_live_batch() from public, anon, authenticated;

select cron.schedule(
  'auction-live-batches', '1 second', 'select private.publish_auction_live_batch();'
);
