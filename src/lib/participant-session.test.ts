import { describe, expect, it, vi } from "vitest";

import { continueParticipantAcrossLots } from "./participant-session";
import type { Participant } from "./types";

const existingParticipant: Participant = {
  id: "participant-1",
  auction_id: "lot-1",
  username: "Robin",
  email: "robin@example.com",
  created_at: "2026-10-15T09:00:00.000Z",
};

describe("participant session continuity", () => {
  it("keeps the current lot participant without joining again", async () => {
    const joinAuction = vi.fn();

    await expect(
      continueParticipantAcrossLots(existingParticipant, null, joinAuction),
    ).resolves.toBe(existingParticipant);
    expect(joinAuction).not.toHaveBeenCalled();
  });

  it("automatically joins the next lot with the previous contact details", async () => {
    const nextParticipant = { ...existingParticipant, id: "participant-2", auction_id: "lot-2" };
    const joinAuction = vi.fn().mockResolvedValue(nextParticipant);

    await expect(
      continueParticipantAcrossLots(
        null,
        { username: "  Robin  ", email: " ROBIN@EXAMPLE.COM " },
        joinAuction,
      ),
    ).resolves.toEqual(nextParticipant);
    expect(joinAuction).toHaveBeenCalledOnce();
    expect(joinAuction).toHaveBeenCalledWith("Robin", "robin@example.com");
  });

  it("still asks first-time visitors to register", async () => {
    const joinAuction = vi.fn();

    await expect(
      continueParticipantAcrossLots(null, null, joinAuction),
    ).resolves.toBeNull();
    expect(joinAuction).not.toHaveBeenCalled();
  });

  it("asks legacy participants without an email to complete registration", async () => {
    const joinAuction = vi.fn();

    await expect(
      continueParticipantAcrossLots({ ...existingParticipant, email: null }, null, joinAuction),
    ).resolves.toBeNull();
    expect(joinAuction).not.toHaveBeenCalled();
  });
});
