import { describe, expect, it } from "vitest";

import { minimumNextBid, parseBidAmount } from "./bid-rules";

describe("bid rules", () => {
  it("calculates the first and subsequent minimum bids", () => {
    expect(minimumNextBid(50, 1, null)).toBe(51);
    expect(minimumNextBid(50, 2.5, 61)).toBe(63.5);
  });

  it("accepts two-decimal currency input", () => {
    expect(parseBidAmount(" 12.50 ")).toBe(12.5);
    expect(parseBidAmount("12,50")).toBe(12.5);
  });

  it.each(["", "0", "-2", "12.345", "five", "1e4"])(
    "rejects invalid amount %s",
    (value) => expect(parseBidAmount(value)).toBeNull(),
  );
});
