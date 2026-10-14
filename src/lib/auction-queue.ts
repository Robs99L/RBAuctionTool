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
