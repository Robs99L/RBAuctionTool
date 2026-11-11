export type ClockSample = { serverTimeAtReceipt: number; receivedAt: number };

export function clockSample(serverTime: number, sentAt: number, receivedAt: number): ClockSample {
  const roundTrip = receivedAt - sentAt;
  if (!Number.isFinite(serverTime) || serverTime <= 0 || !Number.isFinite(roundTrip) || roundTrip < 0 || roundTrip > 5_000) {
    throw new Error("Could not synchronize the auction clock.");
  }
  return { serverTimeAtReceipt: serverTime + roundTrip / 2, receivedAt };
}

export function clockTime(sample: ClockSample | null, monotonicNow: number, localNow: number) {
  return sample ? sample.serverTimeAtReceipt + monotonicNow - sample.receivedAt : localNow;
}

let sample: ClockSample | null = null;

export function getAuctionNow() {
  return clockTime(sample, performance.now(), Date.now());
}

export function hasAuctionClock() {
  return sample !== null;
}

export async function synchronizeAuctionClock() {
  const sentAt = performance.now();
  const response = await fetch("/api/auction-clock", { cache: "no-store", signal: AbortSignal.timeout(5_000) });
  if (!response.ok) throw new Error("Could not synchronize the auction clock.");
  const data = await response.json() as { server_time?: unknown };
  if (typeof data.server_time !== "number") throw new Error("Could not synchronize the auction clock.");
  sample = clockSample(data.server_time, sentAt, performance.now());
}
