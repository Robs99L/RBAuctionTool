import { selectWinningBids } from "./auction-winners";

type DonationAuction = {
  id: string;
  title: string;
  currency: string;
  sort_order: number;
  winner_count: number;
};

type DonationBid = {
  id: string;
  auction_id: string;
  participant_id: string;
  amount: number;
  created_at: string;
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
  const bidsByAuction = new Map<string, DonationBid[]>();

  for (const bid of bids) {
    const auctionBids = bidsByAuction.get(bid.auction_id) ?? [];
    auctionBids.push(bid);
    bidsByAuction.set(bid.auction_id, auctionBids);
  }

  return auctions
    .map((auction) => {
      const winningBids = selectWinningBids(
        bidsByAuction.get(auction.id) ?? [],
        auction.winner_count,
      );
      const totalAmount = winningBids.reduce((total, bid) => total + bid.amount, 0);
      return {
        auction_id: auction.id,
        title: auction.title,
        currency: auction.currency,
        sort_order: auction.sort_order,
        bid_count: winningBids.length,
        total_bid_amount: Math.round((totalAmount + Number.EPSILON) * 100) / 100,
      };
    })
    .sort((left, right) => left.sort_order - right.sort_order);
}
