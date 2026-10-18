import type { Auction } from "@/lib/types";

export function orderAuctions(auctions: Auction[]) {
  return [...auctions].sort((left, right) => left.sort_order - right.sort_order);
}

export function selectCurrentAuction(auctions: Auction[]) {
  const ordered = orderAuctions(auctions);
  return (
    ordered.find((auction) => auction.status === "active") ??
    ordered.find((auction) => auction.status === "upcoming") ??
    [...ordered].reverse().find((auction) => auction.status === "ended") ??
    null
  );
}

export function selectParticipantAuction(auctions: Auction[]) {
  const ordered = orderAuctions(auctions);
  return (
    ordered.find((auction) => auction.status === "active") ??
    [...ordered].reverse().find((auction) => auction.status === "ended") ??
    ordered.find((auction) => auction.status === "upcoming") ??
    null
  );
}

export function selectNextAuction(
  auctions: Auction[],
  currentAuctionId: string | null | undefined,
) {
  if (!currentAuctionId) return null;
  const ordered = orderAuctions(auctions);
  const currentIndex = ordered.findIndex((auction) => auction.id === currentAuctionId);
  if (currentIndex < 0) return null;
  return ordered.slice(currentIndex + 1).find((auction) => auction.status === "upcoming") ?? null;
}
