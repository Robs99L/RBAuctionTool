// Matches the numeric(12, 2) amount stored by public.place_bid.
export const MAX_BID_AMOUNT = 9_999_999_999.99;

export function parseBidAmount(value: string) {
  if (!/^\d+(?:[.,]\d{1,2})?$/.test(value.trim())) return null;
  const amount = Number(value.replace(",", "."));
  if (!Number.isFinite(amount) || amount <= 0 || amount > MAX_BID_AMOUNT) return null;
  return roundCurrency(amount);
}

export function roundCurrency(value: number) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
