import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUCTION_TIMER_SECONDS,
  formatAuctionTimer,
  remainingAuctionSeconds,
} from "./auction-timer";

describe("remainingAuctionSeconds", () => {
  const startedAt = "2026-10-15T20:00:00.000Z";
  const start = Date.parse(startedAt);

  it("starts at two minutes and counts down", () => {
    expect(remainingAuctionSeconds(startedAt, DEFAULT_AUCTION_TIMER_SECONDS, start)).toBe(DEFAULT_AUCTION_TIMER_SECONDS);
    expect(remainingAuctionSeconds(startedAt, DEFAULT_AUCTION_TIMER_SECONDS, start + 30_000)).toBe(90);
    expect(remainingAuctionSeconds(startedAt, DEFAULT_AUCTION_TIMER_SECONDS, start + 119_500)).toBe(1);
  });

  it("uses the configured duration for each product", () => {
    expect(remainingAuctionSeconds(startedAt, 5 * 60, start)).toBe(300);
    expect(remainingAuctionSeconds(startedAt, 5 * 60, start + 90_000)).toBe(210);
  });

  it("stops at zero without changing auction state", () => {
    expect(remainingAuctionSeconds(startedAt, DEFAULT_AUCTION_TIMER_SECONDS, start + 120_000)).toBe(0);
    expect(remainingAuctionSeconds(startedAt, DEFAULT_AUCTION_TIMER_SECONDS, start + 10 * 60_000)).toBe(0);
  });
});

describe("formatAuctionTimer", () => {
  it("formats minutes and seconds", () => {
    expect(formatAuctionTimer(120)).toBe("02:00");
    expect(formatAuctionTimer(9)).toBe("00:09");
    expect(formatAuctionTimer(0)).toBe("00:00");
  });
});
