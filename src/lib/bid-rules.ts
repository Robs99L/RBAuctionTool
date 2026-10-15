export function minimumNextBid(
  startingPrice: number,
  minimumIncrement: number,
  highestBid?: number | null,
  isHighestBidder = false,
) {
  const base = highestBid ?? startingPrice;
  const increment = highestBid !== null && highestBid !== undefined && isHighestBidder
    ? 0.01
    : minimumIncrement;
  return roundCurrency(base + increment);
}

export function parseBidAmount(value: string) {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) return null;
  const amount = Number(value.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return roundCurrency(amount);
}

export function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
