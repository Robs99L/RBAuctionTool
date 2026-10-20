import { describe, expect, it } from "vitest";

import {
  moveAuctionInQueue,
  selectCurrentAuction,
  selectNextAuction,
  selectParticipantAuction,
} from "./auction-queue";
import type { Auction } from "./types";

function lot(id: string, sortOrder: number, status: Auction["status"]): Auction {
  return {
    id,
    title: id,
    description: "",
    image_url: null,
    starting_price: 10,
    minimum_increment: 1,
    maximum_bid_difference: null,
    winner_count: 1,
    timer_duration_seconds: 120,
    currency: "EUR",
    status,
    starts_at: null,
    ends_at: null,
    sort_order: sortOrder,
    created_at: "2026-10-14T00:00:00.000Z",
  };
}

describe("auction queue", () => {
  it("moves an auction by swapping its stable queue position", () => {
    const auctions = [
      lot("first", 10, "upcoming"),
      lot("second", 20, "upcoming"),
      lot("third", 30, "upcoming"),
    ];

    const moved = moveAuctionInQueue(auctions, "second", -1);

    expect(moved.map((auction) => auction.id)).toEqual(["second", "first", "third"]);
    expect(moved.map((auction) => auction.sort_order)).toEqual([10, 20, 30]);
    expect(auctions.map((auction) => auction.id)).toEqual(["first", "second", "third"]);
  });

  it("keeps the queue unchanged at its boundaries", () => {
    const auctions = [lot("first", 1, "upcoming"), lot("second", 2, "upcoming")];

    expect(moveAuctionInQueue(auctions, "first", -1).map((auction) => auction.id))
      .toEqual(["first", "second"]);
    expect(moveAuctionInQueue(auctions, "second", 1).map((auction) => auction.id))
      .toEqual(["first", "second"]);
  });

  it("prefers the active lot regardless of its position", () => {
    expect(selectCurrentAuction([
      lot("next", 2, "upcoming"),
      lot("live", 3, "active"),
      lot("ended", 1, "ended"),
    ])?.id).toBe("live");
  });

  it("shows the earliest upcoming lot when none is active", () => {
    expect(selectCurrentAuction([
      lot("later", 3, "upcoming"),
      lot("next", 2, "upcoming"),
      lot("ended", 1, "ended"),
    ])?.id).toBe("next");
  });

  it("keeps the latest result visible after the queue ends", () => {
    expect(selectCurrentAuction([
      lot("first", 1, "ended"),
      lot("last", 2, "ended"),
    ])?.id).toBe("last");
  });

  it("keeps final results visible to participants until the next lot starts", () => {
    const auctions = [
      lot("ended", 1, "ended"),
      lot("next", 2, "upcoming"),
    ];

    expect(selectParticipantAuction(auctions)?.id).toBe("ended");
    expect(selectParticipantAuction([
      ...auctions,
      lot("live", 3, "active"),
    ])?.id).toBe("live");
  });

  it("selects the next upcoming lot after the current one", () => {
    const auctions = [
      lot("ended", 1, "ended"),
      lot("live", 2, "active"),
      lot("skipped", 3, "ended"),
      lot("next", 4, "upcoming"),
      lot("later", 5, "upcoming"),
    ];

    expect(selectNextAuction(auctions, "live")?.id).toBe("next");
    expect(selectNextAuction(auctions, "later")).toBeNull();
  });
});
