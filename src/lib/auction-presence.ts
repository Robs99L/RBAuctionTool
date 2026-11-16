import type { SupabaseClient } from "@supabase/supabase-js";

export const AUCTION_PRESENCE_TOPIC = "auction-online";
export const ONLINE_BROWSER_KEY = "rb-auction-online-browser";

let fallbackBrowserKey: string | null = null;

/** Share an opaque ID across tabs without publishing names or Auth identifiers. */
export function getOnlineBrowserKey(storage: Pick<Storage, "getItem" | "setItem">) {
  try {
    const existing = storage.getItem(ONLINE_BROWSER_KEY);
    if (existing) return existing;
    const key = crypto.randomUUID();
    storage.setItem(ONLINE_BROWSER_KEY, key);
    return key;
  } catch {
    fallbackBrowserKey ??= crypto.randomUUID();
    return fallbackBrowserKey;
  }
}

export function countOnlineBrowsers(state: Record<string, unknown[]>) {
  return Object.values(state).filter(presences => presences.length > 0).length;
}

export function subscribeOnlineCount(client: SupabaseClient, browserKey: string, onCount: (count: number | null) => void) {
  let disposed = false;
  let generation = 0;
  let channel: ReturnType<SupabaseClient["channel"]> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelay = 1000;
  let teardown = Promise.resolve();

  function removeChannel() {
    if (!channel) return;
    const previous = channel;
    channel = null;
    teardown = client.removeChannel(previous).then(() => {}, () => {});
  }
  function retry(attempt: number) {
    if (disposed || generation !== attempt) return;
    generation += 1;
    onCount(null);
    removeChannel();
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30_000);
  }
  async function connect() {
    const attempt = ++generation;
    const current = () => !disposed && generation === attempt;
    try {
      await teardown;
      if (!current()) return;
      let tracking = false;
      const joined = client.channel(AUCTION_PRESENCE_TOPIC, {
        config: { presence: { key: browserKey, enabled: true } },
      });
      channel = joined;
      const update = () => {
        if (!current() || !tracking) return;
        const state = joined.presenceState();
        // Wait for our own confirmed presence before reporting a complete count.
        if (state[browserKey]?.length) onCount(countOnlineBrowsers(state));
      };
      joined.on("presence", { event: "sync" }, update).subscribe(status => {
        if (!current()) return;
        if (status === "SUBSCRIBED") {
          void joined.track({ online: true }).then(result => {
            if (!current()) return;
            if (result !== "ok") return retry(attempt);
            retryDelay = 1000;
            tracking = true;
            update();
          }, () => retry(attempt));
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          tracking = false;
          retry(attempt);
        }
      });
    } catch {
      retry(attempt);
    }
  }
  void connect();
  return () => {
    disposed = true;
    generation += 1;
    if (retryTimer !== null) clearTimeout(retryTimer);
    removeChannel();
    return teardown;
  };
}

/** One subscription per tab, shared by the tracking hook and visible counters. */
export function createOnlineCountStore(connect: (onCount: (count: number | null) => void) => () => void | Promise<void>) {
  let count: number | null = null;
  let generation = 0;
  let stop: (() => void | Promise<void>) | null = null;
  let teardown = Promise.resolve();
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => count,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        const attempt = ++generation;
        void teardown.then(() => {
          if (attempt !== generation || !listeners.size) return;
          stop = connect(next => {
            if (attempt !== generation || next === count) return;
            count = next;
            listeners.forEach(notify => notify());
          });
        });
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        generation += 1;
        count = null;
        if (stop) teardown = Promise.resolve(stop()).then(() => {}, () => {});
        stop = null;
      };
    },
  };
}
