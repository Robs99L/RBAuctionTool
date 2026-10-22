import { describe, expect, it } from "vitest";

import {
  applyAuctionRules,
  applyBidInsert,
  applyParticipantInsert,
  emptyAuctionLiveState,
} from "./auction-live-state";

describe("live auction state", () => {
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
