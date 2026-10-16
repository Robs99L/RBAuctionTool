import { describe, expect, it } from "vitest";

import { normalizeParticipantProfile } from "./participant-profile";

describe("participant profile", () => {
  it("normalizes a valid full name and email", () => {
    expect(normalizeParticipantProfile("  Robin Berger  ", " ROBIN@Example.COM ")).toEqual({
      username: "Robin Berger",
      email: "robin@example.com",
    });
  });

  it.each([
    ["", "robin@example.com"],
    ["Robin", ""],
    ["Robin", "not-an-email"],
    ["Robin", "robin@example"],
  ])("rejects invalid registration values", (username, email) => {
    expect(normalizeParticipantProfile(username, email)).toBeNull();
  });
});
