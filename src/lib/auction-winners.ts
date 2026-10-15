type RankedBidInput = {
  id: string;
  participant_id: string;
  amount: number;
  created_at: string;
};

export type WinningBid<T extends RankedBidInput = RankedBidInput> = T & {
  rank: number;
};

export function selectWinningBids<T extends RankedBidInput>(
  bids: readonly T[],
  winnerCount: number,
): Array<WinningBid<T>> {
  if (!Number.isSafeInteger(winnerCount) || winnerCount < 1) return [];

  const highestByParticipant = new Map<string, T>();

  for (const bid of bids) {
    const current = highestByParticipant.get(bid.participant_id);
    if (
      !current ||
      bid.amount > current.amount ||
      (bid.amount === current.amount && bid.created_at < current.created_at)
    ) {
      highestByParticipant.set(bid.participant_id, bid);
    }
  }

  return [...highestByParticipant.values()]
    .sort((left, right) => (
      right.amount - left.amount ||
      left.created_at.localeCompare(right.created_at) ||
      left.id.localeCompare(right.id)
    ))
    .slice(0, winnerCount)
    .map((bid, index) => ({ ...bid, rank: index + 1 }));
}
