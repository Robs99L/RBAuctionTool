export const AUCTION_TIMER_SECONDS = 2 * 60;

export function remainingAuctionSeconds(startsAt: string | null, now = Date.now()) {
  if (!startsAt) return AUCTION_TIMER_SECONDS;
  const start = Date.parse(startsAt);
  if (!Number.isFinite(start)) return AUCTION_TIMER_SECONDS;
  const deadline = start + AUCTION_TIMER_SECONDS * 1000;
  return Math.max(0, Math.ceil((deadline - now) / 1000));
}

export function formatAuctionTimer(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const minutesPart = Math.floor(seconds / 60);
  const secondsPart = seconds % 60;
  return `${String(minutesPart).padStart(2, "0")}:${String(secondsPart).padStart(2, "0")}`;
}
