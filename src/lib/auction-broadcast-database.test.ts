import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestAuctionDatabase } from "./test-auction-database";
import { decodeAuctionBatch } from "./auction-broadcast";

const auctionId = "00000000-0000-4000-8000-000000000001";
const participantId = "20000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000001";

describe("transactional auction delivery queue", () => {
  let db: PGlite;
  beforeAll(async () => { db = await createTestAuctionDatabase(); }, 30_000);
  afterAll(async () => { await db?.close(); });
  beforeEach(async () => {
    await db.exec("begin");
    await db.query("insert into auth.users (id) values ($1)", [userId]);
    await db.query(`insert into public.auctions (id, title, starting_price, status)
      values ($1, 'Batched event', 500, 'active')`, [auctionId]);
    await db.query(`insert into public.participants (id, auction_id, user_id, username)
      values ($1, $2, $3, 'Mia')`, [participantId, auctionId, userId]);
    await db.query(`insert into private.participant_contacts (participant_id, email)
      values ($1, 'private@example.invalid')`, [participantId]);
  });
  afterEach(async () => { await db.exec("rollback"); });
  const flush = async () => Number((await db.query<{ count: number }>("select private.publish_auction_live_batch() as count")).rows[0].count);
  const countPending = async () => Number((await db.query<{ count: string }>("select count(*) from private.auction_live_outbox")).rows[0].count);
  async function insertBids(count: number) {
    await db.query(`insert into public.bids (auction_id, participant_id, amount)
      select $1, $2, 0.01 from generate_series(1, $3::integer)`, [auctionId, participantId, count]);
  }

  it("stores 300 separate bids and sends one batch containing only public data", async () => {
    await insertBids(300);
    expect(await countPending()).toBe(301);
    expect(await flush()).toBe(301);
    expect(await countPending()).toBe(0);
    const rows = (await db.query<{ payload: unknown; private: boolean }>("select payload, private from realtime.messages")).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0].private).toBe(true);
    const events = decodeAuctionBatch(rows[0].payload)!;
    expect(events.filter(event => event.kind === "bid")).toHaveLength(300);
    expect(events[0]).toMatchObject({ kind: "participant", record: { username: "Mia" } });
    expect(JSON.stringify(rows[0].payload)).not.toContain("private@example.invalid");
    expect(Number((await db.query<{ count: string }>("select count(*) from public.bids")).rows[0].count)).toBe(300);
  });

  it("keeps pending events when the managed send function silently fails, then retries", async () => {
    await insertBids(1);
    await db.exec("set local test.broadcast_failure = 'silent'");
    expect(await flush()).toBe(0);
    expect(await countPending()).toBe(2);
    await db.exec("set local test.broadcast_failure = ''");
    expect(await flush()).toBe(2);
    expect(await countPending()).toBe(0);
  });

  it("retains overflow for a later tick and prevents immediate repeat broadcasts", async () => {
    await insertBids(1250);
    expect(await flush()).toBe(1000);
    expect(await countPending()).toBe(251);
    expect(await flush()).toBe(0);
    expect(await countPending()).toBe(251);
    await db.exec("update private.auction_live_publisher set last_published_at = clock_timestamp() - interval '2 seconds'");
    expect(await flush()).toBe(251);
    expect(await countPending()).toBe(0);
    expect(Number((await db.query<{ count: string }>("select count(*) from realtime.messages")).rows[0].count)).toBe(2);
  });

  it("rolls queue insertion back with its source bid", async () => {
    const before = await countPending();
    await db.exec("savepoint accepted_bid");
    await insertBids(1);
    expect(await countPending()).toBe(before + 1);
    await db.exec("rollback to savepoint accepted_bid");
    expect(await countPending()).toBe(before);
  });

  it("lets authenticated clients receive but never forge a batch, even with another permissive send policy", async () => {
    await flush();
    await db.exec("insert into realtime.messages (topic, extension, payload) values ('another-topic', 'broadcast', '{}')");
    await db.exec("create policy other_send_permission on realtime.messages for insert to authenticated with check (true)");
    await db.exec("set local role authenticated; set local realtime.topic = 'auction-live'");
    expect((await db.query("select * from realtime.messages")).rows).toHaveLength(1);
    await expect(db.exec(`insert into realtime.messages (event, topic, private, extension, payload)
      values ('auction_batch', 'auction-live', true, 'broadcast', '{}')`)).rejects.toThrow("row-level security");
  });

  it("also blocks forged topic rows when the requested topic is different", async () => {
    await db.exec("create policy other_send_permission on realtime.messages for insert to authenticated with check (true)");
    await db.exec("set local role authenticated; set local realtime.topic = 'another-topic'");
    await expect(db.exec(`insert into realtime.messages (topic, extension, payload)
      values ('auction-live', 'broadcast', '{}')`)).rejects.toThrow("row-level security");
  });

  it("denies browser roles access to private queues and the publisher", async () => {
    const row = (await db.query<{ queue: boolean; publisher: boolean }>(`select
      has_table_privilege('authenticated', 'private.auction_live_outbox', 'select') as queue,
      has_function_privilege('authenticated', 'private.publish_auction_live_batch()', 'execute') as publisher`)).rows[0];
    expect(row).toEqual({ queue: false, publisher: false });
  });

  it("schedules exactly one named job at one-second cadence", async () => {
    const rows = (await db.query<{ jobname: string; schedule: string; command: string }>("select jobname, schedule, command from cron.job")).rows;
    expect(rows).toEqual([{ jobname: "auction-live-batches", schedule: "1 second", command: "select private.publish_auction_live_batch();" }]);
  });
});
