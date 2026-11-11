import { afterEach, describe, expect, it, vi } from "vitest";
import { createLiveEventBatcher } from "./live-event-batcher";

afterEach(() => vi.useRealTimers());

describe("displaying bid bursts", () => {
  it("delivers every notification in one display update even with duplicates", async () => {
    vi.useFakeTimers();
    const render = vi.fn();
    const batcher = createLiveEventBatcher<number>(render);
    for (let i = 0; i < 10_000; i++) batcher.push(i % 5_000);
    await vi.advanceTimersByTimeAsync(16);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0][0]).toHaveLength(10_000);
    batcher.dispose();
  });

  it("keeps displaying during continuous traffic", async () => {
    vi.useFakeTimers();
    const render = vi.fn();
    const batcher = createLiveEventBatcher<number>(render);
    for (let i = 0; i < 100; i++) {
      batcher.push(i);
      await vi.advanceTimersByTimeAsync(1);
    }
    expect(render.mock.calls.length).toBeGreaterThanOrEqual(6);
    batcher.flush();
    expect(render.mock.calls.flatMap(call => call[0])).toEqual(Array.from({ length: 100 }, (_, i) => i));
    batcher.dispose();
  });

  it("does not replay queued old-event notifications after an event switch or unmount", async () => {
    vi.useFakeTimers();
    const render = vi.fn();
    const batcher = createLiveEventBatcher<string>(render);
    batcher.push("old-event");
    batcher.cancel();
    batcher.push("new-event");
    await vi.advanceTimersByTimeAsync(16);
    expect(render.mock.calls).toEqual([[["new-event"]]]);
    batcher.push("unmounted");
    batcher.dispose();
    batcher.push("late-message");
    await vi.advanceTimersByTimeAsync(16);
    expect(render).toHaveBeenCalledTimes(1);
  });
});
