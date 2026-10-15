import { describe, expect, it } from "vitest";

import {
  AUCTION_TIMER_SECONDS,
  formatAuctionTimer,
  remainingAuctionSeconds,
} from "./auction-timer";

describe("remainingAuctionSeconds", () => {
  const startedAt = "2026-10-15T20:00:00.000Z";
  const start = Date.parse(startedAt);

  it("starts at two minutes and counts down", () => {
    expect(remainingAuctionSeconds(startedAt, start)).toBe(AUCTION_TIMER_SECONDS);
    expect(remainingAuctionSeconds(startedAt, start + 30_000)).toBe(90);
    expect(remainingAuctionSeconds(startedAt, start + 119_500)).toBe(1);
  });

  it("stops at zero without changing auction state", () => {
    expect(remainingAuctionSeconds(startedAt, start + 120_000)).toBe(0);
    expect(remainingAuctionSeconds(startedAt, start + 10 * 60_000)).toBe(0);
  });
});

describe("formatAuctionTimer", () => {
  it("formats minutes and seconds", () => {
    expect(formatAuctionTimer(120)).toBe("02:00");
    expect(formatAuctionTimer(9)).toBe("00:09");
    expect(formatAuctionTimer(0)).toBe("00:00");
  });
});
