import { describe, expect, it } from "vitest";

import { summarizeDonations } from "./donation-summary";

describe("donation summary", () => {
  it("sums only the highest bids from the configured number of winners", () => {
    const [summary] = summarizeDonations(
      [{ id: "lot-1", title: "Dinner", currency: "EUR", sort_order: 1, winner_count: 2 }],
      [
        { id: "a-old", auction_id: "lot-1", participant_id: "a", amount: 10, created_at: "2026-10-16T10:00:00Z" },
        { id: "a-new", auction_id: "lot-1", participant_id: "a", amount: 30, created_at: "2026-10-16T10:03:00Z" },
        { id: "b", auction_id: "lot-1", participant_id: "b", amount: 20, created_at: "2026-10-16T10:02:00Z" },
        { id: "c", auction_id: "lot-1", participant_id: "c", amount: 15, created_at: "2026-10-16T10:01:00Z" },
      ],
    );

    expect(summary).toMatchObject({ bid_count: 2, total_bid_amount: 50 });
  });

  it("includes products without bids", () => {
    expect(summarizeDonations(
      [{ id: "lot-1", title: "Dinner", currency: "EUR", sort_order: 1, winner_count: 1 }],
      [],
    )[0]).toMatchObject({ bid_count: 0, total_bid_amount: 0 });
  });
});
