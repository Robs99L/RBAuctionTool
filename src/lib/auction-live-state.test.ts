import { describe, expect, it } from "vitest";

import {
  applyAuctionRules,
  applyBidInsert,
  applyParticipantInsert,
  applyLiveAuctionEvents,
  emptyAuctionLiveState,
  type LiveAuctionEvent,
} from "./auction-live-state";
import { selectWinningBids } from "./auction-winners";

describe("live auction state", () => {
  it("converges for 10,000 shuffled bid deliveries with duplicates and late registrations", () => {
    const bids = Array.from({ length: 10_000 }, (_, i) => ({
      id: `b${String(i).padStart(5, "0")}`, auction_id: "a1", participant_id: `p${i % 500}`,
      amount: 10 + Math.floor(i / 500), created_at: new Date(1_700_000_000_000 + i).toISOString(),
    }));
    const events: LiveAuctionEvent[] = [
      ...[...bids].reverse().flatMap(record => [{ kind: "bid" as const, record }, { kind: "bid" as const, record }]),
      ...Array.from({ length: 500 }, (_, i) => ({
        kind: "participant" as const, record: { id: `p${i}`, auction_id: "a1", username: `Bidder ${i}` },
      })),
    ];
    const rules = { winner_count: 12, status: "active" as const };
    const allAtOnce = applyLiveAuctionEvents(emptyAuctionLiveState(), events, rules);
    let inChunks = emptyAuctionLiveState();
    for (let i = 0; i < events.length; i += 137) {
      inChunks = applyLiveAuctionEvents(inChunks, events.slice(i, i + 137), rules);
    }
    expect(inChunks).toEqual(allAtOnce);
    expect(allAtOnce.participantCount).toBe(500);
    expect(allAtOnce.bids).toHaveLength(30);
    expect(allAtOnce.leaderboard.map(entry => entry.bid_id)).toEqual(selectWinningBids(bids, 500).map(bid => bid.id));
    expect(allAtOnce.leaderboard.filter(entry => entry.is_winner)).toHaveLength(12);
    expect(allAtOnce.leaderboard.every(entry => entry.username === `Bidder ${entry.participant_id.slice(1)}`)).toBe(true);
    expect(applyLiveAuctionEvents(allAtOnce, events.slice(0, 10), rules)).toBe(allAtOnce);
  });

  it("replays a pending burst over a stale snapshot with updated winner rules", () => {
    const events: LiveAuctionEvent[] = [
      { kind: "bid", record: { id: "b2", auction_id: "a1", participant_id: "p2", amount: 50, created_at: "2026-11-11T12:00:00Z" } },
      { kind: "bid", record: { id: "b1", auction_id: "a1", participant_id: "p1", amount: 50, created_at: "2026-11-11T12:00:00Z" } },
    ];
    const final = applyLiveAuctionEvents(emptyAuctionLiveState(), events, { winner_count: 2, status: "ended" });
    expect(final.leaderboard.map(entry => entry.bid_id)).toEqual(["b1", "b2"]);
    expect(final.leaderboard.every(entry => entry.is_winner && entry.is_final)).toBe(true);
  });
  it("repairs participant names when a bid notification arrives before registration", () => {
    const bidFirst = applyBidInsert(emptyAuctionLiveState(), {
      id: "b1", auction_id: "a1", participant_id: "p1", amount: 50, created_at: "2026-11-11T12:00:00Z",
    }, { winner_count: 1, status: "active" });
    const registered = applyParticipantInsert(bidFirst, { id: "p1", auction_id: "a1", username: "Mia" });
    expect(registered.leaderboard[0].username).toBe("Mia");
    expect(registered.bids[0].username).toBe("Mia");
    expect(registered.participantCount).toBe(1);
  });
  it("counts each participant event once", () => {
    const participant = { id: "p1", auction_id: "a1", username: "Mia" };
    const once = applyParticipantInsert(emptyAuctionLiveState(), participant);
    const twice = applyParticipantInsert(once, participant);

    expect(twice.participantCount).toBe(1);
    expect(twice.participantNames.p1).toBe("Mia");
  });

  it("updates recent bids and one best bid per participant without refetching", () => {
    let state = applyParticipantInsert(emptyAuctionLiveState(), {
      id: "p1",
      auction_id: "a1",
      username: "Mia",
    });
    state = applyParticipantInsert(state, {
      id: "p2",
      auction_id: "a1",
      username: "Noah",
    });
    state = applyBidInsert(state, {
      id: "b1",
      auction_id: "a1",
      participant_id: "p1",
      amount: 11,
      created_at: "2026-10-22T10:00:00.000Z",
    }, { winner_count: 1, status: "active" });
    state = applyBidInsert(state, {
      id: "b2",
      auction_id: "a1",
      participant_id: "p2",
      amount: 12,
      created_at: "2026-10-22T10:00:01.000Z",
    }, { winner_count: 1, status: "active" });
    state = applyBidInsert(state, {
      id: "b3",
      auction_id: "a1",
      participant_id: "p1",
      amount: 13,
      created_at: "2026-10-22T10:00:02.000Z",
    }, { winner_count: 1, status: "active" });

    expect(state.bids.map((bid) => bid.id)).toEqual(["b3", "b2", "b1"]);
    expect(state.leaderboard).toHaveLength(2);
    expect(state.leaderboard[0]).toMatchObject({
      bid_id: "b3",
      username: "Mia",
      bidder_rank: 1,
      is_winner: true,
    });
  });

  it("deduplicates replayed events after a reconnect snapshot", () => {
    const event = {
      id: "b1",
      auction_id: "a1",
      participant_id: "p1",
      amount: 11,
      created_at: "2026-10-22T10:00:00.000Z",
    };
    const initial = applyParticipantInsert(emptyAuctionLiveState(), {
      id: "p1",
      auction_id: "a1",
      username: "Mia",
    });
    const once = applyBidInsert(initial, event, { winner_count: 1, status: "active" });
    const twice = applyBidInsert(once, event, { winner_count: 1, status: "active" });

    expect(twice).toBe(once);
    expect(twice.bids).toHaveLength(1);
  });

  it("marks the same standings as final when the auction ends", () => {
    const active = applyBidInsert(
      applyParticipantInsert(emptyAuctionLiveState(), {
        id: "p1",
        auction_id: "a1",
        username: "Mia",
      }),
      {
        id: "b1",
        auction_id: "a1",
        participant_id: "p1",
        amount: 11,
        created_at: "2026-10-22T10:00:00.000Z",
      },
      { winner_count: 1, status: "active" },
    );

    const ended = applyAuctionRules(active, { winner_count: 1, status: "ended" });
    expect(ended.leaderboard[0].is_final).toBe(true);
    expect(ended.leaderboard[0].is_winner).toBe(true);
  });
});
