import { applyAuctionQueueEvent, type AuctionQueueEvent } from "@/lib/auction-queue";
import { applyAuctionRules, applyLiveAuctionEvents, emptyAuctionLiveState, type LiveAuctionEvent, type LiveParticipantInsert } from "@/lib/auction-live-state";
import type { DonationTotal } from "@/lib/donation-summary";
import type { Auction, AuctionLiveState, WinnerReportEntry } from "@/lib/types";

export const ADMIN_RECENT_BID_LIMIT = 500;

export type AdminBid = {
  id: string; participant_id: string; amount: number; created_at: string;
  username: string; email: string;
};
export type AdminLiveEvent = LiveAuctionEvent | { kind: "queue"; event: AuctionQueueEvent };
export type AdminLiveState = {
  auctions: Auction[]; auction: Auction | null; bids: AdminBid[];
  donationTotals: DonationTotal[]; winnerReport: WinnerReportEntry[];
  participantNames: Record<string, string>;
  loadedAuctionId: string | null;
  standings: AuctionLiveState;
};

export function emptyAdminLiveState(): AdminLiveState {
  return {
    auctions: [], auction: null, bids: [], donationTotals: [], winnerReport: [],
    participantNames: {}, loadedAuctionId: null, standings: emptyAuctionLiveState(),
  };
}

/** Private contacts only come from the protected snapshot, never Realtime. */
export function applyAdminLiveEvents(state: AdminLiveState, events: readonly AdminLiveEvent[]): AdminLiveState {
  let auctions = state.auctions;
  let auction = state.auction;
  const names = { ...state.standings.participantNames, ...state.participantNames };
  for (const event of events) {
    if (event.kind === "queue") {
      auctions = applyAuctionQueueEvent(auctions, event.event);
      auction = auctions.find(item => item.id === auction?.id) ?? null;
    } else if (event.kind === "participant") {
      names[event.record.id] = event.record.username;
    }
  }
  const byId = new Map(state.bids.map(bid => [bid.id, bid]));
  const contacts = new Map(state.bids.map(bid => [bid.participant_id, bid]));
  for (const event of events) {
    if (event.kind !== "bid" || event.record.auction_id !== auction?.id || byId.has(event.record.id)) continue;
    const record = event.record;
    const contact = contacts.get(record.participant_id);
    byId.set(record.id, {
      id: record.id, participant_id: record.participant_id,
      amount: record.amount, created_at: record.created_at,
      username: names[record.participant_id] ?? record.username ?? contact?.username ?? "Unknown participant",
      email: contact?.email ?? "",
    });
  }
  const bids = [...byId.values()].map(bid => {
    const username = names[bid.participant_id];
    return username && bid.username !== username ? { ...bid, username } : bid;
  }).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).slice(0, ADMIN_RECENT_BID_LIMIT);
  const liveEvents = events.filter((event): event is LiveAuctionEvent => event.kind !== "queue" && event.record.auction_id === auction?.id);
  const standings = auction ? applyAuctionRules(applyLiveAuctionEvents(state.standings, liveEvents, auction), auction) : emptyAuctionLiveState();
  // One consistent winning-bid basis for selected history, ranks and donation amount.
  let donationTotals = state.donationTotals;
  if (auction && state.loadedAuctionId === auction.id) {
    const winners = standings.leaderboard.filter(entry => entry.is_winner);
    const total = {
      auction_id: auction.id, title: auction.title, currency: auction.currency, sort_order: auction.sort_order,
      bid_count: winners.length,
      total_bid_amount: Math.round((winners.reduce((sum, entry) => sum + entry.amount, 0) + Number.EPSILON) * 100) / 100,
    };
    donationTotals = [...donationTotals.filter(item => item.auction_id !== auction.id), total];
  }
  return { ...state, auctions, auction, bids, donationTotals, participantNames: names, standings };
}

export function replayAdminSnapshot(
  snapshot: AdminLiveState,
  participants: readonly LiveParticipantInsert[],
  events: readonly AdminLiveEvent[],
): AdminLiveState {
  return applyAdminLiveEvents(snapshot, [
    ...participants.map(record => ({ kind: "participant" as const, record })),
    ...events,
  ]);
}
