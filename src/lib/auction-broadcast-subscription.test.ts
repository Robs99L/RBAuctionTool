import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeAuctionBatches } from "./auction-broadcast";

const ensureSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase-browser", () => ({ ensureAnonymousSupabaseSession: ensureSession }));

const session = { access_token: "test-token" } as Session;
const stops: (() => void)[] = [];
function fixture() {
  const channels: {
    emit: (payload: unknown) => void;
    status: (value: string) => void;
  }[] = [];
  const client = {
    realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
    removeChannel: vi.fn().mockResolvedValue("ok"),
    channel: vi.fn(() => {
      let receive: (message: { payload: unknown }) => void;
      let status: (value: string) => void;
      const channel = {
        on: vi.fn((_type, _filter, callback: typeof receive) => { receive = callback; return channel; }),
        subscribe: vi.fn((callback: typeof status) => { status = callback; return channel; }),
      };
      channels.push({ emit: payload => receive({ payload }), status: value => status(value) });
      return channel;
    }),
  };
  const callbacks = { onEvents: vi.fn(), onStatus: vi.fn(), onError: vi.fn() };
  const subscribe = () => {
    const stop = subscribeAuctionBatches(client as unknown as SupabaseClient, callbacks);
    stops.push(stop);
    return stop;
  };
  return { client, channels, callbacks, subscribe };
}

beforeEach(() => {
  vi.useFakeTimers();
  ensureSession.mockReset().mockResolvedValue(session);
});
afterEach(() => {
  stops.splice(0).forEach(stop => stop());
  vi.useRealTimers();
});

describe("private live subscription recovery", () => {
  it("retries transient Auth failures and subscribes after recovery", async () => {
    ensureSession.mockRejectedValueOnce(new Error("Network unavailable"));
    const { subscribe, client, channels, callbacks } = fixture();
    subscribe();
    await vi.advanceTimersByTimeAsync(0);
    expect(callbacks.onError).toHaveBeenCalledWith(expect.objectContaining({ message: "Network unavailable" }));
    expect(client.channel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.channel).toHaveBeenCalledWith("auction-live", { config: { private: true } });
    expect(client.realtime.setAuth).toHaveBeenCalledWith("test-token");
    channels[0].status("SUBSCRIBED");
    expect(callbacks.onStatus).toHaveBeenCalledWith("SUBSCRIBED");
  });

  it("does not subscribe when disposed while Auth is pending", async () => {
    let resolve!: (value: Session) => void;
    ensureSession.mockReturnValueOnce(new Promise<Session>(done => { resolve = done; }));
    const { subscribe, client } = fixture();
    const stop = subscribe();
    await vi.advanceTimersByTimeAsync(0);
    stop();
    resolve(session);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.channel).not.toHaveBeenCalled();
  });

  it("shares one pending anonymous sign-in across a replaced subscription", async () => {
    let resolve!: (value: Session) => void;
    ensureSession.mockReturnValueOnce(new Promise<Session>(done => { resolve = done; }));
    const { subscribe, client } = fixture();
    const firstStop = subscribe();
    await vi.advanceTimersByTimeAsync(0);
    firstStop();
    subscribe();
    await vi.advanceTimersByTimeAsync(0);
    expect(ensureSession).toHaveBeenCalledTimes(1);
    resolve(session);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.channel).toHaveBeenCalledTimes(1);
  });

  it("rejoins after an invalid batch, ignores the old channel, and resumes verified events", async () => {
    const { subscribe, client, channels, callbacks } = fixture();
    subscribe();
    await vi.advanceTimersByTimeAsync(0);
    const payload = { protocol: 1, batch_id: "batch", events: [
      { kind: "participant", record: { id: "p", auction_id: "a", username: "Mia" } },
    ] };
    channels[0].emit({ protocol: 2 });
    expect(callbacks.onError).toHaveBeenCalledOnce();
    expect(client.removeChannel).toHaveBeenCalledOnce();
    channels[0].emit(payload);
    expect(callbacks.onEvents).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    channels[1].status("SUBSCRIBED");
    channels[1].emit(payload);
    expect(callbacks.onEvents).toHaveBeenCalledWith(payload.events);
  });

  it("cancels a scheduled recovery when the view unmounts", async () => {
    ensureSession.mockRejectedValue(new Error("Network unavailable"));
    const { subscribe, client } = fixture();
    const stop = subscribe();
    await vi.advanceTimersByTimeAsync(0);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(ensureSession).toHaveBeenCalledOnce();
    expect(client.channel).not.toHaveBeenCalled();
  });
});
