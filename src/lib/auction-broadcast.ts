import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { LiveAuctionEvent } from "@/lib/auction-live-state";
import { parseBidAmount } from "@/lib/bid-rules";
import { ensureAnonymousSupabaseSession } from "@/lib/supabase-browser";

export const AUCTION_BROADCAST_TOPIC = "auction-live";
export const AUCTION_BROADCAST_EVENT = "auction_batch";

const pendingSessions = new WeakMap<SupabaseClient, Promise<Session>>();
function ensureLiveSession(client: SupabaseClient) {
  const pending = pendingSessions.get(client);
  if (pending) return pending;
  const request = ensureAnonymousSupabaseSession(client).finally(() => {
    if (pendingSessions.get(client) === request) pendingSessions.delete(client);
  });
  pendingSessions.set(client, request);
  return request;
}

export function usesAuctionBroadcast() {
  return process.env.NEXT_PUBLIC_BATCHED_REALTIME === "true";
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** Validate the entire batch and retain only the public fields we consume. */
export function decodeAuctionBatch(value: unknown): LiveAuctionEvent[] | null {
  const batch = record(value);
  if (batch?.protocol !== 1 || !text(batch.batch_id) || !Array.isArray(batch.events)
      || batch.events.length < 1 || batch.events.length > 1000) return null;
  const events: LiveAuctionEvent[] = [];
  for (const value of batch.events) {
    const event = record(value);
    const row = record(event?.record);
    if (!row || !text(row.id) || !text(row.auction_id)) return null;
    if (event?.kind === "participant") {
      if (!text(row.username) || row.username.length > 120) return null;
      events.push({ kind: "participant", record: {
        id: row.id, auction_id: row.auction_id, username: row.username,
      } });
    } else if (event?.kind === "bid") {
      const amount = typeof row.amount === "number" ? row.amount : Number.NaN;
      if (!text(row.participant_id) || !text(row.created_at)
          || !Number.isFinite(Date.parse(row.created_at))
          || parseBidAmount(String(amount)) !== amount) return null;
      events.push({ kind: "bid", record: {
        id: row.id, auction_id: row.auction_id, participant_id: row.participant_id,
        amount, created_at: row.created_at,
      } });
    } else return null;
  }
  return events;
}

/** Joining creates a session, not a participant registration. */
export function subscribeAuctionBatches(client: SupabaseClient, {
  onEvents, onStatus, onError,
}: {
  onEvents: (events: LiveAuctionEvent[]) => void;
  onStatus: (status: string) => void;
  onError: (error: Error) => void;
}) {
  let disposed = false;
  let channel: ReturnType<SupabaseClient["channel"]> | null = null;
  let generation = 0;
  let retryDelay = 1000;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let teardown = Promise.resolve();
  function removeChannel() {
    if (!channel) return;
    const previous = channel;
    channel = null;
    teardown = client.removeChannel(previous).then(() => {}, () => {});
  }
  function retry(error: unknown, attempt: number) {
    if (disposed || attempt !== generation) return;
    generation += 1;
    removeChannel();
    onError(error instanceof Error ? error : new Error("Could not connect to live auction updates."));
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void connect();
    }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 30_000);
  }
  async function connect() {
    const attempt = ++generation;
    const current = () => !disposed && attempt === generation;
    try {
      await teardown;
      if (!current()) return;
      const session = await ensureLiveSession(client);
      if (!current()) return;
      await client.realtime.setAuth(session.access_token);
      if (!current()) return;
      channel = client.channel(AUCTION_BROADCAST_TOPIC, { config: { private: true } });
      channel.on("broadcast", { event: AUCTION_BROADCAST_EVENT }, ({ payload }) => {
        if (!current()) return;
        const events = decodeAuctionBatch(payload);
        if (events) onEvents(events);
        else retry(new Error("The live auction update could not be verified."), attempt);
      }).subscribe(status => {
        if (!current()) return;
        if (status === "SUBSCRIBED") retryDelay = 1000;
        onStatus(status);
      });
    } catch (error) {
      retry(error, attempt);
    }
  }
  void connect();
  return () => {
    disposed = true;
    generation += 1;
    if (retryTimer !== null) clearTimeout(retryTimer);
    removeChannel();
  };
}
