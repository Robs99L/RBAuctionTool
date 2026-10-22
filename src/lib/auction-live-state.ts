import type {
  Auction,
  AuctionDashboardSnapshot,
  AuctionLiveState,
  Bid,
  LeaderboardEntry,
} from "@/lib/types";

export type LiveParticipantInsert = {
  id: string;
  auction_id: string;
  username: string;
};

export type LiveBidInsert = {
  id: string;
  auction_id: string;
  participant_id: string;
  amount: number;
  created_at: string;
  username?: string;
};

export type LiveAuctionEvent =
  | { kind: "participant"; record: LiveParticipantInsert }
  | { kind: "bid"; record: LiveBidInsert };

export function emptyAuctionLiveState(): AuctionLiveState {
  return {
    bids: [],
    leaderboard: [],
    participantCount: 0,
    participantNames: {},
  };
}

function recordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
    : [];
}

function normalizeLeaderboard(rows: Array<Record<string, unknown>>): LeaderboardEntry[] {
  return rows.map((row) => ({
    bid_id: String(row.bid_id),
    participant_id: String(row.participant_id),
    username: String(row.username ?? "Unknown participant"),
    amount: Number(row.amount),
    created_at: String(row.created_at),
    bidder_rank: Number(row.bidder_rank),
    is_winner: Boolean(row.is_winner),
    is_final: Boolean(row.is_final),
  }));
}

export function normalizeAuctionDashboard(
  value: unknown,
  normalizeAuction: (row: Record<string, unknown>) => Auction,
): AuctionDashboardSnapshot {
  if (!value || typeof value !== "object") {
    throw new Error("The auction snapshot is unavailable.");
  }

  const snapshot = value as Record<string, unknown>;
  if (!snapshot.auction || typeof snapshot.auction !== "object") {
    throw new Error("The auction snapshot does not contain an event.");
  }

  const participants = recordArray(snapshot.participants);
  const participantNames = Object.fromEntries(participants.map((participant) => [
    String(participant.id),
    String(participant.username ?? "Unknown participant"),
  ]));
  const bids = recordArray(snapshot.bids).map((bid): Bid => ({
    id: String(bid.id),
    auction_id: String(bid.auction_id),
    participant_id: String(bid.participant_id),
    amount: Number(bid.amount),
    created_at: String(bid.created_at),
    username: String(
      bid.username ?? participantNames[String(bid.participant_id)] ?? "Unknown participant",
    ),
  }));

  return {
    auction: normalizeAuction(snapshot.auction as Record<string, unknown>),
    liveState: {
      bids,
      leaderboard: normalizeLeaderboard(recordArray(snapshot.leaderboard)),
      participantCount: Math.max(Number(snapshot.participant_count ?? 0), participants.length),
      participantNames,
    },
  };
}

function leaderboardOrder(left: LeaderboardEntry, right: LeaderboardEntry) {
  return (
    right.amount - left.amount ||
    left.created_at.localeCompare(right.created_at) ||
    left.bid_id.localeCompare(right.bid_id)
  );
}

function recentBidOrder(left: Bid, right: Bid) {
  return right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);
}

export function applyAuctionRules(
  state: AuctionLiveState,
  auction: Pick<Auction, "winner_count" | "status">,
): AuctionLiveState {
  const leaderboard = [...state.leaderboard]
    .sort(leaderboardOrder)
    .map((entry, index) => ({
      ...entry,
      bidder_rank: index + 1,
      is_winner: index < auction.winner_count,
      is_final: auction.status === "ended",
    }));
  return { ...state, leaderboard };
}

export function applyParticipantInsert(
  state: AuctionLiveState,
  record: LiveParticipantInsert,
): AuctionLiveState {
  if (!record.id || state.participantNames[record.id]) return state;
  return {
    ...state,
    participantCount: state.participantCount + 1,
    participantNames: {
      ...state.participantNames,
      [record.id]: record.username || "Unknown participant",
    },
  };
}

export function applyBidInsert(
  state: AuctionLiveState,
  record: LiveBidInsert,
  auction: Pick<Auction, "winner_count" | "status">,
): AuctionLiveState {
  if (
    !record.id ||
    state.bids.some((bid) => bid.id === record.id) ||
    state.leaderboard.some((entry) => entry.bid_id === record.id)
  ) {
    return state;
  }

  const existingEntry = state.leaderboard.find(
    (entry) => entry.participant_id === record.participant_id,
  );
  const username =
    record.username ??
    state.participantNames[record.participant_id] ??
    existingEntry?.username ??
    "Unknown participant";
  const bid: Bid = { ...record, username };
  const bids = [bid, ...state.bids].sort(recentBidOrder).slice(0, 30);

  let leaderboard = state.leaderboard;
  const improvesParticipantBest =
    !existingEntry ||
    record.amount > existingEntry.amount ||
    (
      record.amount === existingEntry.amount &&
      (
        record.created_at < existingEntry.created_at ||
        (record.created_at === existingEntry.created_at && record.id < existingEntry.bid_id)
      )
    );

  if (improvesParticipantBest) {
    const nextEntry: LeaderboardEntry = {
      bid_id: record.id,
      participant_id: record.participant_id,
      username,
      amount: record.amount,
      created_at: record.created_at,
      bidder_rank: 0,
      is_winner: false,
      is_final: auction.status === "ended",
    };
    leaderboard = existingEntry
      ? state.leaderboard.map((entry) => (
        entry.participant_id === record.participant_id ? nextEntry : entry
      ))
      : [...state.leaderboard, nextEntry];
  }

  return applyAuctionRules({ ...state, bids, leaderboard }, auction);
}

export function applyLiveAuctionEvent(
  state: AuctionLiveState,
  event: LiveAuctionEvent,
  auction: Pick<Auction, "winner_count" | "status">,
) {
  return event.kind === "participant"
    ? applyParticipantInsert(state, event.record)
    : applyBidInsert(state, event.record, auction);
}
