import { describe, expect, it } from "vitest";

import { MAX_BID_AMOUNT, parseBidAmount } from "./bid-rules";

describe("bid rules", () => {
  it("accepts any positive database-supported amount", () => {
    expect(parseBidAmount("0.01")).toBe(0.01);
    expect(parseBidAmount("10")).toBe(10);
    expect(parseBidAmount("9999999999.99")).toBe(MAX_BID_AMOUNT);
  });

  it("accepts two-decimal currency input", () => {
    expect(parseBidAmount(" 12.50 ")).toBe(12.5);
    expect(parseBidAmount("12,50")).toBe(12.5);
  });

  it.each(["", "0", "-2", "12.345", "five", "1e4", "10000000000", "NaN", "Infinity"])(
    "rejects invalid amount %s",
    (value) => expect(parseBidAmount(value)).toBeNull(),
  );
});
