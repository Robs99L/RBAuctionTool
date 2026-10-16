export type AuctionStatus = "upcoming" | "active" | "ended";

export type Auction = {
  id: string;
  title: string;
  description: string;
  image_url: string | null;
  starting_price: number;
  minimum_increment: number;
  maximum_bid_difference: number | null;
  winner_count: number;
  timer_duration_seconds: number;
  currency: string;
  status: AuctionStatus;
  starts_at: string | null;
  ends_at: string | null;
  sort_order: number;
  created_at: string;
};

export type Participant = {
  id: string;
  auction_id: string;
  username: string;
  email: string | null;
  created_at: string;
};

export type Bid = {
  id: string;
  auction_id: string;
  participant_id: string;
  amount: number;
  created_at: string;
  username: string;
};

export type BidReceipt = {
  bid_id: string;
  amount: number;
  created_at: string;
  username: string;
};
