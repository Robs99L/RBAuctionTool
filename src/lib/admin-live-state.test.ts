import { describe, expect, it } from "vitest";
import { applyAdminLiveEvents, emptyAdminLiveState, replayAdminSnapshot, type AdminLiveEvent } from "./admin-live-state";
import { applyLiveAuctionEvents, emptyAuctionLiveState } from "./auction-live-state";
import { selectWinningBids } from "./auction-winners";
import type { Auction } from "./types";

const auction: Auction = {
  id: "a1", title: "Event", description: "", image_url: null, starting_price: 0, minimum_increment: 1,
  maximum_bid_difference: null, winner_count: 12, timer_duration_seconds: 120, currency: "EUR",
  status: "active", starts_at: null, ends_at: null, sort_order: 0, created_at: "2026-11-11T12:00:00Z",
};
const baseline = () => ({ ...emptyAdminLiveState(), auctions: [auction], auction, loadedAuctionId: auction.id });

describe("administration live consistency", () => {
  it("keeps 500 recent bids and the same complete standings as public views in a duplicated burst", () => {
    const events = Array.from({ length: 2_000 }, (_, i): AdminLiveEvent => ({ kind: "bid", record: {
      id: `b${i}`, auction_id: "a1", participant_id: `p${i % 100}`, amount: 10 + i,
      created_at: new Date(1_700_000_000_000 + i).toISOString(),
    } }));
    const admin = applyAdminLiveEvents(baseline(), [...events].reverse().concat(events));
    const publicState = applyLiveAuctionEvents(emptyAuctionLiveState(), events.filter(event => event.kind !== "queue"), auction);
    expect(admin.bids).toHaveLength(500);
    expect(selectWinningBids(admin.bids, 12).map(bid => bid.id)).toEqual(publicState.leaderboard.slice(0, 12).map(entry => entry.bid_id));
    expect(admin.donationTotals[0].total_bid_amount).toBe(publicState.leaderboard.slice(0, 12).reduce((sum, entry) => sum + entry.amount, 0));
  });

  it("retains older winning bidders absent from the latest 500 history rows after a snapshot", () => {
    const events = Array.from({ length: 601 }, (_, i): AdminLiveEvent => ({ kind: "bid", record: {
      id: `b${i}`, auction_id: "a1", participant_id: i === 0 ? "old-winner" : "frequent-bidder",
      amount: 100 + i, created_at: new Date(1_700_000_000_000 + i).toISOString(),
    } }));
    const before = applyAdminLiveEvents(baseline(), events);
    expect(before.bids.some(bid => bid.participant_id === "old-winner")).toBe(false);
    const restored = replayAdminSnapshot(before, [], [{ kind: "bid", record: {
      id: "latest", auction_id: "a1", participant_id: "frequent-bidder", amount: 701,
      created_at: new Date(1_700_000_000_701).toISOString(),
    } }]);
    expect(restored.standings.leaderboard.map(entry => entry.participant_id)).toEqual(["frequent-bidder", "old-winner"]);
    expect(restored.donationTotals[0].total_bid_amount).toBe(801);
  });

  it("merges every bid and queue update arriving during a slow protected snapshot", () => {
    const record = { id: "b1", auction_id: "a1", participant_id: "p1", amount: 50, created_at: "2026-11-11T12:00:01Z" };
    const events: AdminLiveEvent[] = [
      { kind: "bid", record }, { kind: "bid", record },
      { kind: "queue", event: { kind: "upsert", auction: { ...auction, title: "Updated event", winner_count: 1 } } },
    ];
    const next = replayAdminSnapshot(baseline(), [{ id: "p1", auction_id: "a1", username: "Mia" }], events);
    expect(next.auction?.title).toBe("Updated event");
    expect(next.auction?.winner_count).toBe(1);
    expect(next.bids).toHaveLength(1);
    expect(next.bids[0].username).toBe("Mia");
    expect(next.donationTotals[0].total_bid_amount).toBe(50);
  });

  it("keeps final donations consistent over a stale response followed by a live bid and event end", () => {
    const stale = baseline();
    stale.donationTotals = [{ auction_id: auction.id, title: auction.title, currency: "EUR", sort_order: 0, bid_count: 0, total_bid_amount: 0 }];
    const final = replayAdminSnapshot(stale, [], [
      { kind: "bid", record: { id: "last", auction_id: auction.id, participant_id: "p1", amount: 100, created_at: auction.created_at } },
      { kind: "queue", event: { kind: "upsert", auction: { ...auction, status: "ended" } } },
    ]);
    expect(final.auction?.status).toBe("ended");
    expect(final.donationTotals[0].total_bid_amount).toBe(100);
    expect(final.standings.leaderboard[0].is_final).toBe(true);
  });

  it("only fills private contacts from protected history, including for subsequent live bids", () => {
    const state = baseline();
    state.bids = [{ id: "b1", participant_id: "p1", amount: 10, created_at: "2026-11-11T12:00:00Z", username: "Mia", email: "private@example.invalid" }];
    const next = applyAdminLiveEvents(state, [{ kind: "bid", record: {
      id: "b2", auction_id: "a1", participant_id: "p1", amount: 20,
      created_at: "2026-11-11T12:00:01Z", ...{ email: "forged@example.invalid" },
    } }]);
    expect(next.bids[0].email).toBe("private@example.invalid");
  });

  it("repairs a late name and ignores bids from a different selected event", () => {
    const next = applyAdminLiveEvents(baseline(), [
      { kind: "bid", record: { id: "other", auction_id: "a2", participant_id: "p2", amount: 100, created_at: "2026-11-11T12:00:01Z" } },
      { kind: "bid", record: { id: "b1", auction_id: "a1", participant_id: "p1", amount: 50, created_at: "2026-11-11T12:00:01Z" } },
      { kind: "participant", record: { id: "p1", auction_id: "a1", username: "Mia" } },
    ]);
    expect(next.bids.map(bid => bid.id)).toEqual(["b1"]);
    expect(next.bids[0]).toMatchObject({ username: "Mia", email: "" });
  });
});
