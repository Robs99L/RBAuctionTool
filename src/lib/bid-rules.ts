export function minimumNextBid(
  startingPrice: number,
  minimumIncrement: number,
  highestBid?: number | null,
) {
  const base = highestBid ?? startingPrice;
  return roundCurrency(base + minimumIncrement);
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
