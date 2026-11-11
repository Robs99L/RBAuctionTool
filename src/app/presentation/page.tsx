import { AuctionApp } from "@/components/auction-app";
import { PresentationView } from "@/components/presentation-view";
import { createDemoAuctionState } from "@/lib/demo-auction";
import type { Auction, LeaderboardEntry } from "@/lib/types";

export const metadata = { title: "Live Presentation | Christmas Auction" };

export default async function PresentationPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string | string[]; winners?: string | string[] }>;
}) {
  const query = process.env.NODE_ENV !== "production" ? await searchParams : null;
  if (query?.demo === "true") {
    const requestedWinnerCount = typeof query.winners === "string" ? Number(query.winners) : NaN;
    const winnerCount = Number.isSafeInteger(requestedWinnerCount) && requestedWinnerCount >= 1 && requestedWinnerCount <= 1000
      ? requestedWinnerCount
      : 2;
    const { auctions } = createDemoAuctionState();
    const auction: Auction = {
      ...auctions[0],
      starts_at: new Date().toISOString(),
      timer_duration_seconds: 600,
      starting_price: 400,
      winner_count: winnerCount,
    };
    const leaderboard: LeaderboardEntry[] = [
      "Mia K.",
      "Jonas R.",
      "Lea S.",
      "Alexander von Beispielhausen",
      "Sophie W.",
      "David T.",
      "Clara B.",
      "Lukas H.",
      "Anna M.",
      "Felix D.",
      "Laura P.",
      "Max J.",
    ].map((username, index) => ({
      bid_id: `presentation-demo-bid-${index}`,
      participant_id: `presentation-demo-participant-${index}`,
      username,
      amount: 700 - index * 25,
      created_at: auction.starts_at!,
      bidder_rank: index + 1,
      is_winner: index < auction.winner_count,
      is_final: false,
    }));

    return <PresentationView auction={auction} leaderboard={leaderboard} connection="live" nextEventName={auctions[1].title} demo />;
  }

  return <AuctionApp presentation />;
}
