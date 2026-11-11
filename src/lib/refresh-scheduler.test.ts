import { afterEach, describe, expect, it, vi } from "vitest";

import { createRefreshScheduler } from "./refresh-scheduler";

afterEach(() => vi.useRealTimers());

describe("live refresh scheduler", () => {
  it("refreshes throughout a continuous stream instead of waiting for it to stop", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);
    const scheduler = createRefreshScheduler(refresh);
    for (let i = 0; i < 20; i++) {
      scheduler.request();
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(refresh.mock.calls.length).toBeGreaterThanOrEqual(6);
    scheduler.dispose();
  });

  it("runs one follow-up for updates arriving during a slow request", async () => {
    vi.useFakeTimers();
    let finish: () => void = () => undefined;
    const refresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const scheduler = createRefreshScheduler(refresh);
    scheduler.request();
    await vi.advanceTimersByTimeAsync(250);
    for (let i = 0; i < 20; i++) scheduler.request();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(refresh).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(250);
    expect(refresh).toHaveBeenCalledTimes(2);
    scheduler.dispose();
    finish();
  });

  it("cancels pending work when the page unmounts", async () => {
    vi.useFakeTimers();
    const refresh = vi.fn(async () => undefined);
    const scheduler = createRefreshScheduler(refresh);
    scheduler.request();
    scheduler.dispose();
    scheduler.request(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(refresh).not.toHaveBeenCalled();
  });
});
