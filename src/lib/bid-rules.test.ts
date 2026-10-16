import { describe, expect, it } from "vitest";

import { maximumNextBid, minimumNextBid, parseBidAmount } from "./bid-rules";

describe("bid rules", () => {
  it("calculates the first and subsequent minimum bids", () => {
    expect(minimumNextBid(50, 1, null)).toBe(51);
    expect(minimumNextBid(50, 2.5, 61)).toBe(63.5);
  });

  it("lets the leading participant raise their own bid by one cent", () => {
    expect(minimumNextBid(50, 2.5, 61, true)).toBe(61.01);
    expect(minimumNextBid(50, 2.5, null, true)).toBe(52.5);
  });

  it("calculates an optional maximum from the current highest bid", () => {
    expect(maximumNextBid(50, 20, null)).toBe(70);
    expect(maximumNextBid(50, 20, 61)).toBe(81);
    expect(maximumNextBid(50, null, 61)).toBeNull();
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
