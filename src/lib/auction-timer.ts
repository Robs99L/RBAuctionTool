export const DEFAULT_AUCTION_TIMER_SECONDS = 2 * 60;
export const AUCTION_START_COUNTDOWN_SECONDS = 15;

export function remainingAuctionStartSeconds(
  startsAt: string | null,
  now = Date.now(),
) {
  if (!startsAt) return 0;
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start)) return 0;
  return Math.max(0, Math.ceil((start - now) / 1000));
}

export function remainingAuctionSeconds(
  startsAt: string | null,
  durationSeconds = DEFAULT_AUCTION_TIMER_SECONDS,
  now = Date.now(),
) {
  if (!startsAt) return durationSeconds;
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start)) return durationSeconds;
  const deadline = start + durationSeconds * 1000;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function formatAuctionTimer(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutesPart = Math.floor(seconds / 60);
  const secondsPart = seconds % 60;
  return `${String(minutesPart).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}`;
}
