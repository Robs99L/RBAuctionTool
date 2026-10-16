import { describe, expect, it } from "vitest";

import { summarizeDonations } from "./donation-summary";

describe("donation summary", () => {
  it("sums every accepted bid per product, including repeated bids", () => {
    const [summary] = summarizeDonations(
      [{ id: "lot-1", title: "Dinner", currency: "EUR", sort_order: 1 }],
      [
        { auction_id: "lot-1", amount: 10 },
        { auction_id: "lot-1", amount: 15 },
        { auction_id: "lot-1", amount: 20 },
      ],
    );

    expect(summary).toMatchObject({ bid_count: 3, total_bid_amount: 45 });
  });

  it("includes products without bids", () => {
    expect(summarizeDonations(
      [{ id: "lot-1", title: "Dinner", currency: "EUR", sort_order: 1 }],
      [],
    )[0]).toMatchObject({ bid_count: 0, total_bid_amount: 0 });
  });
});
