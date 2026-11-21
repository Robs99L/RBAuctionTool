import { AuctionApp } from "@/components/auction-app";
import { PresentationView } from "@/components/presentation-view";
import { createDemoAuctionState } from "@/lib/demo-auction";
import type { Auction, LeaderboardEntry } from "@/lib/types";

export const metadata = { title: "Live Presentation | Christmas Auction" };

export default async function PresentationPage({
  searchParams,
}: {
  searchParams: Promise<{ demo?: string | string[]; winners?: string | string[]; state?: string | string[]; description?: string | string[] }>;
}) {
  const query = process.env.NODE_ENV !== "production" ? await searchParams : null;
  if (query?.demo === "true") {
    const requestedWinnerCount = typeof query.winners === "string" ? Number(query.winners) : NaN;
    const winnerCount = Number.isSafeInteger(requestedWinnerCount) && requestedWinnerCount >= 1 && requestedWinnerCount <= 1000
      ? requestedWinnerCount
      : 2;
    const { auctions } = createDemoAuctionState();
    const threeLineDescription = query.description === "readable";
    const ended = query.state === "ended";
    const auction: Auction = {
      ...auctions[0],
      description: threeLineDescription
        ? "Designklassiker aus Nussbaum.\nInklusive Ottoman und Zertifikat.\nAbholung nach der Auktion."
        : auctions[0].description,
      image_url: threeLineDescription ? createPreviewScreenshot() : auctions[0].image_url,
      status: ended ? "ended" : "active",
      starts_at: new Date().toISOString(),
      ends_at: ended ? new Date().toISOString() : auctions[0].ends_at,
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
      "Emma F.",
      "Ben L.",
      "Julia S.",
    ].map((username, index) => ({
      bid_id: `presentation-demo-bid-${index}`,
      participant_id: `presentation-demo-participant-${index}`,
      username,
      amount: 700 - index * 25,
      created_at: auction.starts_at!,
      bidder_rank: index + 1,
      is_winner: index < auction.winner_count,
      is_final: ended,
    }));

    return <PresentationView auction={auction} leaderboard={leaderboard} connection="live" nextEventName={auctions[1].title} demo />;
  }

  return <AuctionApp presentation />;
}

function createPreviewScreenshot() {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
    <rect width="1600" height="900" fill="#eaf0f7"/>
    <rect x="6" y="6" width="1588" height="888" fill="none" stroke="#164e63" stroke-width="12"/>
    <rect width="1600" height="65" fill="#16a34a"/>
    <rect y="835" width="1600" height="65" fill="#2563eb"/>
    <g font-family="Arial" text-anchor="middle">
      <text x="800" y="455" font-size="62" fill="#164e63">Complete event screenshot 16:9</text>
      <text x="800" y="45" font-size="35" fill="white">TOP EDGE</text>
      <text x="800" y="880" font-size="35" fill="white">BOTTOM EDGE</text>
    </g>
  </svg>`)}`;
}
