import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestAuctionDatabase } from "./test-auction-database";

const auctionId = "00000000-0000-4000-8000-000000000001";
const userIds = [1, 2, 3, 4].map(i => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const participantIds = [1, 2, 3, 4].map(i => `20000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
type Receipt = { bid_id: string; amount: string; created_at: Date; username: string };

describe("bid acceptance in PostgreSQL", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestAuctionDatabase();
  }, 30_000);

  beforeEach(async () => {
    await db.exec("begin;");
    await db.query("insert into auth.users (id) select unnest($1::uuid[])", [userIds]);
    await db.query(`
      insert into public.auctions
        (id, title, starting_price, minimum_increment, maximum_bid_difference,
         winner_count, timer_duration_seconds, status, starts_at)
      values ($1, 'Any positive bid', 500, 25, 100, 2, 120, 'active', now() - interval '1 minute')
    `, [auctionId]);
    for (let i = 0; i < userIds.length; i++) {
      await db.query(`insert into public.participants (id, auction_id, user_id, username)
        values ($1, $2, $3, $4)`, [participantIds[i], auctionId, userIds[i], `Bidder ${i + 1}`]);
      await db.query("insert into private.participant_contacts (participant_id, email) values ($1, $2)",
        [participantIds[i], `bidder${i + 1}@example.invalid`]);
    }
  });

  afterEach(async () => { await db.exec("rollback;"); });
  afterAll(async () => { await db?.close(); });

  async function placeBid(userId: string | null, amount: string | null) {
    await db.exec("set local role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
    return (await db.query<Receipt>("select * from public.place_bid($1, $2::numeric)", [auctionId, amount])).rows[0];
  }

  async function asOwner() { await db.exec("set local role postgres;"); }
  async function history() {
    await asOwner();
    return (await db.query<{ amount: string }>("select amount from public.bids order by created_at, id")).rows.map(bid => Number(bid.amount));
  }

  it("stores the first bid below the opening price and matching bids from different people", async () => {
    const receipts = [];
    for (const userId of userIds) receipts.push(await placeBid(userId, "10"));
    expect(new Set(receipts.map(receipt => receipt.bid_id)).size).toBe(4);
    expect(await history()).toEqual([10, 10, 10, 10]);
    const leaderboard = (await db.query<{ participant_id: string; is_winner: boolean }>(
      "select * from public.get_auction_leaderboard($1)", [auctionId])).rows;
    expect(leaderboard.map(row => row.participant_id)).toEqual(participantIds);
    expect(leaderboard.filter(row => row.is_winner)).toHaveLength(2);
  });

  it("stores a lower non-winning bid while keeping the earlier personal best and donation total", async () => {
    await db.query(`insert into public.bids (auction_id, participant_id, amount, created_at)
      values ($1, $2, 700, clock_timestamp() - interval '2 seconds'),
             ($1, $3, 600, clock_timestamp() - interval '1 second')`, [auctionId, participantIds[0], participantIds[1]]);
    await placeBid(userIds[0], "1");
    await placeBid(userIds[2], "0.01");
    expect(await history()).toEqual([700, 600, 1, 0.01]);
    const rows = (await db.query<{ amount: string; is_winner: boolean }>(
      "select * from public.get_auction_leaderboard($1)", [auctionId])).rows;
    expect(rows.map(row => Number(row.amount))).toEqual([700, 600, 0.01]);
    expect(rows[2].is_winner).toBe(false);
    const total = (await db.query<{ total_bid_amount: string }>("select * from public.get_auction_donation_totals()")).rows[0];
    expect(Number(total.total_bid_amount)).toBe(1300);
    await db.query("select public.end_auction($1)", [auctionId]);
    const final = (await db.query<{ amount: string; is_final: boolean }>(
      "select * from public.get_auction_leaderboard($1)", [auctionId])).rows;
    expect(final.filter(row => row.is_final).map(row => Number(row.amount))).toEqual([700, 600, 0.01]);
    const winners = (await db.query<{ winning_amount: string }>("select winning_amount from public.auction_winners order by winner_rank")).rows;
    expect(winners.map(row => Number(row.winning_amount))).toEqual([700, 600]);
  });

  it("stores amounts above the old maximum increase and at the storage limit", async () => {
    await placeBid(userIds[0], "1000");
    await placeBid(userIds[1], "9999999999.99");
    expect(await history()).toEqual([1000, 9999999999.99]);
  });

  it.each([null, "0", "-1", "0.001", "10000000000", "NaN", "Infinity", "-Infinity"])(
    "rejects invalid currency amount %s", async amount => {
      await expect(placeBid(userIds[0], amount)).rejects.toThrow("valid positive bid");
    },
  );

  it("requires a registered, authenticated participant", async () => {
    await expect(placeBid(null, "10")).rejects.toThrow("session has expired");
  });

  it("rejects an authenticated user who has not joined this event", async () => {
    await expect(placeBid("10000000-0000-4000-8000-999999999999", "10")).rejects.toThrow("Join the auction");
  });

  it("requires completed contact registration", async () => {
    await db.query("delete from private.participant_contacts where participant_id = $1", [participantIds[0]]);
    await expect(placeBid(userIds[0], "10")).rejects.toThrow("Complete registration");
  });

  it("retains the database protection against rapid repeated submissions", async () => {
    await placeBid(userIds[0], "10");
    await expect(placeBid(userIds[0], "1")).rejects.toThrow("Please wait a moment");
  });

  it("blocks bids during the start countdown", async () => {
    await db.query("update public.auctions set starts_at = now() + interval '15 seconds' where id = $1", [auctionId]);
    await expect(placeBid(userIds[0], "0.01")).rejects.toThrow("not accepting bids");
  });

  it("blocks bids after the event ends", async () => {
    await db.query("select public.end_auction($1)", [auctionId]);
    await expect(placeBid(userIds[0], "0.01")).rejects.toThrow("not accepting bids");
  });

  it("exposes bid submission only to authenticated users and denies direct writes", async () => {
    const result = (await db.query<{ anonymous: boolean; authenticated: boolean; direct_insert: boolean }>(`
      select has_function_privilege('anon', 'public.place_bid(uuid,numeric)', 'execute') as anonymous,
        has_function_privilege('authenticated', 'public.place_bid(uuid,numeric)', 'execute') as authenticated,
        has_table_privilege('authenticated', 'public.bids', 'insert') as direct_insert
    `)).rows[0];
    expect(result).toEqual({ anonymous: false, authenticated: true, direct_insert: false });
  });
});
