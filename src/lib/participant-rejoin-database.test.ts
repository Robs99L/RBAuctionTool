import type { PGlite } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestAuctionDatabase } from "./test-auction-database";

const auctionId = "00000000-0000-4000-8000-000000000001";
const nextAuctionId = "00000000-0000-4000-8000-000000000002";
const userIds = [1, 2, 3].map(i => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
const participantId = "20000000-0000-4000-8000-000000000001";
const nextParticipantId = "20000000-0000-4000-8000-000000000002";
type Registration = { id: string; auction_id: string; username: string; email: string; created_at: Date };
type StoredBid = { id: string; participant_id: string; amount: string; created_at: Date };

describe("participant rejoining in PostgreSQL without email verification", () => {
  let db: PGlite;
  beforeAll(async () => { db = await createTestAuctionDatabase(); }, 30_000);
  beforeEach(async () => {
    await db.exec("begin;");
    await db.query("insert into auth.users (id) select unnest($1::uuid[])", [userIds]);
    await db.query(`insert into public.auctions (id, title, starting_price, status, starts_at)
      values ($1, 'Current event', 10, 'active', now() - interval '1 minute'),
             ($2, 'Next event', 10, 'upcoming', null)`, [auctionId, nextAuctionId]);
    await db.query(`insert into public.participants (id, auction_id, user_id, username)
      values ($1, $2, $3, 'Mia Keller'), ($4, $5, $3, 'Mia Keller')`,
    [participantId, auctionId, userIds[0], nextParticipantId, nextAuctionId]);
    await db.query(`insert into private.participant_contacts (participant_id, email)
      values ($1, 'mia@example.invalid'), ($2, 'mia@example.invalid')`, [participantId, nextParticipantId]);
    await db.query(`insert into public.bids (auction_id, participant_id, amount, created_at)
      values ($1, $2, 100, now() - interval '2 seconds'),
             ($1, $2, 25, now() - interval '1 second')`, [auctionId, participantId]);
  });
  afterEach(async () => { await db.exec("rollback;"); });
  afterAll(async () => { await db?.close(); });

  async function asOwner() { await db.exec("set local role postgres;"); }
  async function asUser(userId: string | null) {
    await db.exec("set local role authenticated;");
    await db.query("select set_config('request.jwt.claim.sub', $1, true)", [userId ?? ""]);
  }
  async function join(userId: string | null, name = "Mia Keller", email = "mia@example.invalid", lot = auctionId) {
    await asUser(userId);
    await db.exec("savepoint registration;");
    try {
      const result = (await db.query<Registration>("select * from public.join_auction_with_contact($1, $2, $3)", [lot, name, email])).rows[0];
      await db.exec("release savepoint registration;");
      return result;
    } catch (error) {
      await db.exec("rollback to savepoint registration;");
      throw error;
    }
  }
  async function history() {
    await asOwner();
    return (await db.query<StoredBid>("select id, participant_id, amount, created_at from public.bids order by created_at, id")).rows;
  }

  it("transfers a lost session to the same participant and retains every bid, rank and contact", async () => {
    const before = await history();
    const registration = await join(userIds[1]);
    expect(registration.id).toBe(participantId);
    expect(registration.username).toBe("Mia Keller");
    expect(registration.email).toBe("mia@example.invalid");
    expect(await history()).toEqual(before);
    const participants = (await db.query<{ id: string; user_id: string }>("select id, user_id from public.participants where auction_id = $1", [auctionId])).rows;
    expect(participants).toEqual([{ id: participantId, user_id: userIds[1] }]);
    const ranks = (await db.query<{ participant_id: string; amount: string; bidder_rank: number }>("select * from public.get_auction_leaderboard($1)", [auctionId])).rows;
    expect(ranks).toHaveLength(1);
    expect(ranks[0]).toMatchObject({ participant_id: participantId, amount: "100.00", bidder_rank: 1 });
  });

  it("matches names and emails without casing or outer-space differences", async () => {
    const registration = await join(userIds[1], "  MIA KELLER  ", "  MIA@EXAMPLE.INVALID  ");
    expect(registration.id).toBe(participantId);
    expect(registration.username).toBe("Mia Keller");
    expect(registration.email).toBe("mia@example.invalid");
  });

  it("reuses the same registration on repeated submissions from the current session", async () => {
    const first = await join(userIds[1]);
    expect(await join(userIds[1])).toEqual(first);
  });

  it("accepts new bids from the recovered session under the existing participant", async () => {
    await join(userIds[1]);
    const receipt = (await db.query<{ bid_id: string }>("select * from public.place_bid($1, 150)", [auctionId])).rows[0];
    const bids = await history();
    expect(bids).toHaveLength(3);
    expect(bids.find(bid => bid.id === receipt.bid_id)).toMatchObject({ participant_id: participantId, amount: "150.00" });
  });

  it("removes bid and private-contact access from the previous session", async () => {
    await join(userIds[1]);
    await asUser(userIds[0]);
    expect((await db.query("select * from public.get_my_participant_with_contact($1)", [auctionId])).rows).toEqual([]);
    await expect(db.query("select * from public.place_bid($1, 150)", [auctionId])).rejects.toThrow("Join the auction");
  });

  it("can recover again after a second session loss without duplicating participants", async () => {
    await join(userIds[1]);
    expect((await join(userIds[2])).id).toBe(participantId);
    expect(await history()).toHaveLength(2);
  });

  it("reclaims a pre-registered following lot when continuity joins with the same identity", async () => {
    await join(userIds[1]);
    expect((await join(userIds[1], "Mia Keller", "mia@example.invalid", nextAuctionId)).id).toBe(nextParticipantId);
  });

  it("preserves finalized winners and allows recovery after the auction ends", async () => {
    await db.query("select public.end_auction($1)", [auctionId]);
    const before = (await db.query("select * from public.auction_winners")).rows;
    expect((await join(userIds[1])).id).toBe(participantId);
    await asOwner();
    expect((await db.query("select * from public.auction_winners")).rows).toEqual(before);
    expect(await history()).toHaveLength(2);
  });

  it("rejects the same name with a different email without altering the participant or bids", async () => {
    const before = await history();
    await expect(join(userIds[1], "Mia Keller", "other@example.invalid")).rejects.toThrow("That name is already in use");
    expect(await history()).toEqual(before);
    expect((await db.query<{ user_id: string }>("select user_id from public.participants where id = $1", [participantId])).rows[0].user_id).toBe(userIds[0]);
  });

  it("does not transfer bids when only the email matches", async () => {
    const other = await join(userIds[1], "Someone Else");
    expect(other.id).not.toBe(participantId);
    expect((await history()).every(bid => bid.participant_id === participantId)).toBe(true);
  });

  it("cannot take a legacy participant without a matching private contact", async () => {
    await db.query("delete from private.participant_contacts where participant_id = $1", [nextParticipantId]);
    await expect(join(userIds[1], "Mia Keller", "mia@example.invalid", nextAuctionId)).rejects.toThrow("That name is already in use");
  });

  it("does not replace a different participant already owned by the current session", async () => {
    await join(userIds[1], "Someone Else", "other@example.invalid");
    await expect(join(userIds[1])).rejects.toThrow("This session has already joined as Someone Else");
  });

  it("still rejects new registration after auction end", async () => {
    await db.query("select public.end_auction($1)", [auctionId]);
    await expect(join(userIds[1], "New Bidder", "new@example.invalid")).rejects.toThrow("Registration is closed");
  });

  it("requires an authenticated session", async () => {
    await expect(join(null)).rejects.toThrow("authenticated session");
  });

  it.each([["", "mia@example.invalid"], ["Mia Keller", "invalid"]])("rejects invalid registration details %s / %s", async (name, email) => {
    await expect(join(userIds[1], name, email)).rejects.toThrow();
  });

  it("keeps emails private and denies direct participant changes and anonymous RPC access", async () => {
    const permissions = (await db.query(`select
      has_function_privilege('anon', 'public.join_auction_with_contact(uuid,text,text)', 'execute') as anon_rpc,
      has_function_privilege('authenticated', 'public.join_auction_with_contact(uuid,text,text)', 'execute') as authenticated_rpc,
      has_table_privilege('authenticated', 'public.participants', 'update') as direct_update,
      has_table_privilege('authenticated', 'private.participant_contacts', 'select') as private_email`)).rows[0];
    expect(permissions).toEqual({ anon_rpc: false, authenticated_rpc: true, direct_update: false, private_email: false });
  });
});
