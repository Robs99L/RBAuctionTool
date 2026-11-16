import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { countOnlineBrowsers, createOnlineCountStore, getOnlineBrowserKey, subscribeOnlineCount } from "./auction-presence";

const stops: (() => void | Promise<void>)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  await Promise.all(stops.splice(0).map(stop => stop()));
  vi.useRealTimers();
});

function fixture() {
  const channels: {
    state: Record<string, { presence_ref: string }[]>;
    sync: () => void;
    status: (value: string) => void;
    track: ReturnType<typeof vi.fn>;
  }[] = [];
  const client = {
    removeChannel: vi.fn().mockResolvedValue("ok"),
    channel: vi.fn(() => {
      const entry = { state: {}, sync: () => {}, status: () => {}, track: vi.fn().mockResolvedValue("ok") } as typeof channels[number];
      const channel = {
        on: vi.fn((_type, _filter, callback: () => void) => { entry.sync = callback; return channel; }),
        subscribe: vi.fn((callback: (status: string) => void) => { entry.status = callback; return channel; }),
        track: entry.track,
        presenceState: () => entry.state,
      };
      channels.push(entry);
      return channel;
    }),
  };
  const onCount = vi.fn();
  const stop = subscribeOnlineCount(client as unknown as SupabaseClient, "browser-a", onCount);
  stops.push(stop);
  return { client, channels, onCount, stop };
}

describe("online browser presence", () => {
  it("counts browsers once across duplicate tabs and ignores empty presence entries", () => {
    expect(countOnlineBrowsers({ a: [{}, {}], b: [{}], disconnected: [] })).toBe(2);
  });

  it("reuses the same opaque browser key across tabs and gives another browser its own key", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    const key = getOnlineBrowserKey(storage);
    expect(getOnlineBrowserKey(storage)).toBe(key);
    expect(getOnlineBrowserKey({ getItem: () => null, setItem: () => {} })).not.toBe(key);
  });

  it("can reconnect with a stable key when browser storage is blocked", () => {
    const storage = { getItem: () => { throw new Error("Storage blocked"); }, setItem: () => {} };
    expect(getOnlineBrowserKey(storage)).toBe(getOnlineBrowserKey(storage));
  });

  it("tracks only anonymous presence and waits for its own confirmation before displaying a count", async () => {
    const { client, channels, onCount } = fixture();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.channel).toHaveBeenCalledWith("auction-online", { config: { presence: { key: "browser-a", enabled: true } } });
    channels[0].state = { b: [{ presence_ref: "b1" }] };
    channels[0].sync();
    expect(onCount).not.toHaveBeenCalled();
    channels[0].status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(0);
    expect(channels[0].track).toHaveBeenCalledWith({ online: true });
    expect(onCount).not.toHaveBeenCalled();
    channels[0].state["browser-a"] = [{ presence_ref: "a1" }];
    channels[0].sync();
    expect(onCount).toHaveBeenLastCalledWith(2);
  });

  it("updates arrivals and departures while retaining one count for multiple tabs", async () => {
    const { channels, onCount } = fixture();
    await vi.advanceTimersByTimeAsync(0);
    channels[0].state = { "browser-a": [{ presence_ref: "a1" }, { presence_ref: "a2" }], b: [{ presence_ref: "b1" }] };
    channels[0].status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(0);
    expect(onCount).toHaveBeenLastCalledWith(2);
    delete channels[0].state.b;
    channels[0].sync();
    expect(onCount).toHaveBeenLastCalledWith(1);
  });

  it("clears a stale count on disconnect, rejoins and ignores the abandoned channel", async () => {
    const { channels, onCount, client } = fixture();
    await vi.advanceTimersByTimeAsync(0);
    channels[0].state = { "browser-a": [{ presence_ref: "a1" }] };
    channels[0].status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(0);
    channels[0].status("CHANNEL_ERROR");
    expect(onCount).toHaveBeenLastCalledWith(null);
    expect(client.removeChannel).toHaveBeenCalledOnce();
    channels[0].sync();
    expect(onCount).toHaveBeenLastCalledWith(null);
    await vi.advanceTimersByTimeAsync(1000);
    channels[1].state = { "browser-a": [{ presence_ref: "a-new" }], b: [{ presence_ref: "b1" }] };
    channels[1].status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(0);
    expect(onCount).toHaveBeenLastCalledWith(2);
  });

  it("retries a failed tracking request and cancels recovery when disposed", async () => {
    const { channels, onCount, client, stop } = fixture();
    await vi.advanceTimersByTimeAsync(0);
    channels[0].track.mockResolvedValue("timed out");
    channels[0].status("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(0);
    expect(onCount).toHaveBeenLastCalledWith(null);
    await stop();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.channel).toHaveBeenCalledOnce();
  });

  it("does not create a channel after immediate disposal", async () => {
    const { client, stop } = fixture();
    await stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.channel).not.toHaveBeenCalled();
  });

  it("shares a single tab subscription and leaves only after the last consumer unmounts", async () => {
    const stop = vi.fn();
    const connect = vi.fn(() => stop);
    const store = createOnlineCountStore(connect);
    const first = store.subscribe(() => {});
    const second = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledOnce();
    first();
    expect(stop).not.toHaveBeenCalled();
    second();
    expect(stop).toHaveBeenCalledOnce();
    expect(store.getSnapshot()).toBeNull();
  });

  it("waits for old channel removal before reconnecting and ignores its late updates", async () => {
    let finish!: () => void;
    const cleanup = new Promise<void>(resolve => { finish = resolve; });
    const receivers: ((count: number | null) => void)[] = [];
    const connect = vi.fn((notify: (count: number | null) => void) => { receivers.push(notify); return () => cleanup; });
    const store = createOnlineCountStore(connect);
    const first = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    receivers[0](5);
    first();
    const second = store.subscribe(() => {});
    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledOnce();
    receivers[0](99);
    expect(store.getSnapshot()).toBeNull();
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(connect).toHaveBeenCalledTimes(2);
    receivers[1](2);
    expect(store.getSnapshot()).toBe(2);
    second();
  });
});
