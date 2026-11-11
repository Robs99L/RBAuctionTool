import { describe, expect, it } from "vitest";

import { clockSample, clockTime } from "./auction-clock";
import { remainingAuctionStartSeconds } from "./auction-timer";

describe("shared auction clock", () => {
  const serverTime = Date.parse("2026-11-11T12:00:00Z");

  it("corrects different device clocks using server time and half the round trip", () => {
    const first = clockSample(serverTime, 100, 300);
    const second = clockSample(serverTime, 9_100, 9_300);
    const firstNow = clockTime(first, 1_300, serverTime + 300_000);
    const secondNow = clockTime(second, 10_300, serverTime - 300_000);
    expect(firstNow).toBe(serverTime + 1_100);
    expect(secondNow).toBe(firstNow);
    const startsAt = new Date(serverTime + 15_000).toISOString();
    expect(remainingAuctionStartSeconds(startsAt, firstNow)).toBe(14);
    expect(remainingAuctionStartSeconds(startsAt, secondNow)).toBe(14);
  });

  it("ignores changes to a device's wall clock after synchronizing", () => {
    const sample = clockSample(serverTime, 100, 100);
    expect(clockTime(sample, 2_100, serverTime - 86_400_000)).toBe(serverTime + 2_000);
    expect(clockTime(sample, 2_100, serverTime + 86_400_000)).toBe(serverTime + 2_000);
  });

  it("rejects invalid and excessively delayed clock samples", () => {
    expect(() => clockSample(NaN, 0, 100)).toThrow();
    expect(() => clockSample(serverTime, 100, 50)).toThrow();
    expect(() => clockSample(serverTime, 0, 5_001)).toThrow();
  });
});
