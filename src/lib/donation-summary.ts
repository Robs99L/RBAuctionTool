type DonationAuction = {
  id: string;
  title: string;
  currency: string;
  sort_order: number;
};

type DonationBid = {
  auction_id: string;
  amount: number;
};

export type DonationTotal = {
  auction_id: string;
  title: string;
  currency: string;
  sort_order: number;
  bid_count: number;
  total_bid_amount: number;
};

export function summarizeDonations(
  auctions: readonly DonationAuction[],
  bids: readonly DonationBid[],
): DonationTotal[] {
  const totals = new Map<string, { bidCount: number; amount: number }>();

  for (const bid of bids) {
    const current = totals.get(bid.auction_id) ?? { bidCount: 0, amount: 0 };
    totals.set(bid.auction_id, {
      bidCount: current.bidCount + 1,
      amount: current.amount + bid.amount,
    });
  }

  return auctions
    .map((auction) => {
      const total = totals.get(auction.id) ?? { bidCount: 0, amount: 0 };
      return {
        auction_id: auction.id,
        title: auction.title,
        currency: auction.currency,
        sort_order: auction.sort_order,
        bid_count: total.bidCount,
        total_bid_amount: Math.round((total.amount + Number.EPSILON) * 100) / 100,
      };
    })
    .sort((left, right) => left.sort_order - right.sort_order);
}
