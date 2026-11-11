import { describe, expect, it } from "vitest";

import { selectWinningBids } from "./auction-winners";

const bids = [
  { id: "a-old", participant_id: "a", amount: 50, created_at: "2026-10-15T10:00:00Z" },
  { id: "b", participant_id: "b", amount: 70, created_at: "2026-10-15T10:02:00Z" },
  { id: "a-new", participant_id: "a", amount: 80, created_at: "2026-10-15T10:03:00Z" },
  { id: "c", participant_id: "c", amount: 60, created_at: "2026-10-15T10:01:00Z" },
];

describe("auction winners", () => {
  it("selects the highest distinct bidders up to the configured count", () => {
    expect(selectWinningBids(bids, 2)).toEqual([
      { ...bids[2], rank: 1 },
      { ...bids[1], rank: 2 },
    ]);
  });

  it("does not give one participant multiple winner places", () => {
    expect(selectWinningBids(bids, 3).map((bid) => bid.participant_id)).toEqual(["a", "b", "c"]);
  });

  it("rejects invalid winner counts", () => {
    expect(selectWinningBids(bids, 0)).toEqual([]);
    expect(selectWinningBids(bids, 1.5)).toEqual([]);
  });

  it("uses timestamp and bid ID to resolve ties independent of history order", () => {
    const tied = [
      { id: "c", participant_id: "a", amount: 80, created_at: "2026-10-15T10:03:00Z" },
      { id: "b", participant_id: "b", amount: 80, created_at: "2026-10-15T10:03:00Z" },
      { id: "a", participant_id: "a", amount: 80, created_at: "2026-10-15T10:03:00Z" },
      { id: "d", participant_id: "c", amount: 80, created_at: "2026-10-15T10:04:00Z" },
    ];
    const expected = ["a", "b", "d"];
    expect(selectWinningBids(tied, 3).map((bid) => bid.id)).toEqual(expected);
    expect(selectWinningBids([...tied].reverse(), 3).map((bid) => bid.id)).toEqual(expected);
  });
});
