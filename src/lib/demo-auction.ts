import type { Auction, Bid, Participant } from "@/lib/types";

export type DemoAuctionState = {
  auctions: Auction[];
  bids: Bid[];
  participants: Participant[];
};

export const DEMO_STATE_KEY = "rb-auction-demo-state-v2";
export const DEMO_PARTICIPANT_KEY = "rb-auction-demo-participant-v2";

export function createDemoAuctionState(): DemoAuctionState {
  const now = Date.now();
  const auctionId = "demo-auction";
  const participants: Participant[] = [
    {
      id: "demo-participant-mia",
      auction_id: auctionId,
      username: "Mia K.",
      email: "mia@example.com",
      created_at: new Date(now - 24 * 60 * 1000).toISOString(),
    },
    {
      id: "demo-participant-jonas",
      auction_id: auctionId,
      username: "Jonas R.",
      email: "jonas@example.com",
      created_at: new Date(now - 19 * 60 * 1000).toISOString(),
    },
    {
      id: "demo-participant-lea",
      auction_id: auctionId,
      username: "Lea S.",
      email: "lea@example.com",
      created_at: new Date(now - 13 * 60 * 1000).toISOString(),
    },
  ];

  return {
    auctions: [
      {
        id: auctionId,
        title: "Original Eames Lounge Chair",
        description:
          "A timeless walnut and black leather lounge chair in excellent condition, including the matching ottoman and original documentation.",
        image_url: null,
        starting_price: 550,
        minimum_increment: 25,
        maximum_bid_difference: 100,
        winner_count: 1,
        currency: "EUR",
        status: "active",
        starts_at: new Date(now - 30 * 60 * 1000).toISOString(),
        ends_at: new Date(now + 90 * 60 * 1000).toISOString(),
        sort_order: 1,
        created_at: new Date(now - 60 * 60 * 1000).toISOString(),
      },
      {
        id: "demo-auction-2",
        title: "Limited Edition Floor Lamp",
        description:
          "A numbered brass and opal glass floor lamp from a limited European design edition.",
        image_url: null,
        starting_price: 280,
        minimum_increment: 20,
        maximum_bid_difference: 100,
        winner_count: 5,
        currency: "EUR",
        status: "upcoming",
        starts_at: null,
        ends_at: null,
        sort_order: 2,
        created_at: new Date(now - 50 * 60 * 1000).toISOString(),
      },
      {
        id: "demo-auction-3",
        title: "Signed Abstract Lithograph",
        description:
          "A hand-signed and framed abstract lithograph, edition 18 of 75, with certificate of authenticity.",
        image_url: null,
        starting_price: 180,
        minimum_increment: 10,
        maximum_bid_difference: 50,
        winner_count: 1,
        currency: "EUR",
        status: "upcoming",
        starts_at: null,
        ends_at: null,
        sort_order: 3,
        created_at: new Date(now - 40 * 60 * 1000).toISOString(),
      },
    ],
    participants,
    bids: [
      {
        id: "demo-bid-3",
        auction_id: auctionId,
        participant_id: participants[0].id,
        amount: 700,
        created_at: new Date(now - 3 * 60 * 1000).toISOString(),
        username: participants[0].username,
      },
      {
        id: "demo-bid-2",
        auction_id: auctionId,
        participant_id: participants[1].id,
        amount: 650,
        created_at: new Date(now - 7 * 60 * 1000).toISOString(),
        username: participants[1].username,
      },
      {
        id: "demo-bid-1",
        auction_id: auctionId,
        participant_id: participants[2].id,
        amount: 600,
        created_at: new Date(now - 11 * 60 * 1000).toISOString(),
        username: participants[2].username,
      },
    ],
  };
}

export function loadDemoAuctionState() {
  try {
    const saved = window.localStorage.getItem(DEMO_STATE_KEY);
    if (!saved) return createDemoAuctionState();
    const parsed = JSON.parse(saved) as Partial<DemoAuctionState>;
    if (
      Array.isArray(parsed.auctions) &&
      Array.isArray(parsed.bids) &&
      Array.isArray(parsed.participants)
    ) {
      return {
        ...parsed,
        auctions: parsed.auctions.map((auction) => ({
          ...auction,
          maximum_bid_difference: auction.maximum_bid_difference == null
            ? null
            : Number(auction.maximum_bid_difference),
          winner_count: Number(auction.winner_count ?? 1),
        })),
        participants: parsed.participants.map((participant) => ({
          ...participant,
          email: typeof participant.email === "string" ? participant.email : null,
        })),
      } as DemoAuctionState;
    }
  } catch {
    // Invalid or unavailable browser storage falls back to a fresh demo.
  }
  return createDemoAuctionState();
}

export function saveDemoAuctionState(state: DemoAuctionState) {
  try {
    window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(state));
  } catch {
    // The in-memory demo still works when browser storage is unavailable.
  }
}

export function loadDemoParticipantId() {
  try {
    return window.localStorage.getItem(DEMO_PARTICIPANT_KEY);
  } catch {
    return null;
  }
}

export function saveDemoParticipantId(participantId: string) {
  try {
    window.localStorage.setItem(DEMO_PARTICIPANT_KEY, participantId);
  } catch {
    // The active page still retains the participant in memory.
  }
}

export function clearDemoParticipantId() {
  try {
    window.localStorage.removeItem(DEMO_PARTICIPANT_KEY);
  } catch {
    // Nothing else is required when browser storage is unavailable.
  }
}
