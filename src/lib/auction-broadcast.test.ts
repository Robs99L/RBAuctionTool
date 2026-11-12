import { describe, expect, it, vi, afterEach } from "vitest";
import { decodeAuctionBatch, usesAuctionBroadcast } from "./auction-broadcast";

const bid = { kind: "bid", record: { id: "b1", auction_id: "a1", participant_id: "p1",
  amount: 0.01, created_at: "2026-11-12T12:00:00Z" } };
const name = { kind: "participant", record: { id: "p1", auction_id: "a1", username: "Mia" } };
const batch = (events: unknown[]) => ({ protocol: 1, batch_id: "batch1", events });

afterEach(() => vi.unstubAllEnvs());
describe("auction broadcast protocol", () => {
  it("decodes low bids and participant names while stripping private or unexpected fields", () => {
    expect(decodeAuctionBatch(batch([
      { ...bid, record: { ...bid.record, email: "private@example.invalid" } },
      { ...name, record: { ...name.record, user_id: "private-auth-id", email: "private@example.invalid" } },
    ]))).toEqual([bid, name]);
  });
  it("accepts the 1,000-record delivery limit", () => {
    expect(decodeAuctionBatch(batch(Array(1000).fill(bid)))).toHaveLength(1000);
    expect(decodeAuctionBatch(batch(Array(1001).fill(bid)))).toBeNull();
  });
  it.each([undefined, null, [], {}, { ...batch([bid]), protocol: 2 }, batch([]),
    batch([bid, { kind: "unknown", record: {} }]),
    batch([{ ...bid, record: { ...bid.record, amount: 0 } }]),
    batch([{ ...bid, record: { ...bid.record, amount: 1.001 } }]),
    batch([{ ...bid, record: { ...bid.record, amount: 0.000001 } }]),
    batch([{ ...bid, record: { ...bid.record, amount: Number.NaN } }]),
    batch([{ ...bid, record: { ...bid.record, created_at: "invalid" } }]),
    batch([{ ...name, record: { ...name.record, username: "" } }]),
  ])("rejects malformed batches without partially applying them", value => {
    expect(decodeAuctionBatch(value)).toBeNull();
  });
  it("requires an explicit deployment switch", () => {
    vi.stubEnv("NEXT_PUBLIC_BATCHED_REALTIME", undefined);
    expect(usesAuctionBroadcast()).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_BATCHED_REALTIME", "true");
    expect(usesAuctionBroadcast()).toBe(true);
    vi.stubEnv("NEXT_PUBLIC_BATCHED_REALTIME", "false");
    expect(usesAuctionBroadcast()).toBe(false);
  });
});
