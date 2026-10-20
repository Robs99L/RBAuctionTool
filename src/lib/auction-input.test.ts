import { describe, expect, it } from "vitest";

import { validateAuctionInput, validateHttpsImageUrl } from "./auction-input";

const validInput = {
  title: "Dinner for two",
  description: "A description",
  startingPrice: "0",
  minimumIncrement: "5",
  maximumDifference: "50",
  winnerCount: "1",
  timerDurationMinutes: "2",
  currency: "eur",
};

describe("validateAuctionInput", () => {
  it("normalizes a valid manual or spreadsheet event", () => {
    expect(validateAuctionInput(validInput)).toEqual({
      ok: true,
      value: {
        title: "Dinner for two",
        description: "A description",
        starting_price: 0,
        minimum_increment: 5,
        maximum_bid_difference: 50,
        winner_count: 1,
        timer_duration_seconds: 120,
        currency: "EUR",
      },
    });
  });

  it("accepts an unlimited maximum increase", () => {
    const result = validateAuctionInput({ ...validInput, maximumDifference: "" });
    expect(result.ok && result.value.maximum_bid_difference).toBeNull();
  });

  it("rejects invalid limits", () => {
    const result = validateAuctionInput({
      ...validInput,
      title: "",
      minimumIncrement: 10,
      maximumDifference: 5,
      timerDurationMinutes: 0.1,
    });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.errors).toHaveLength(3);
  });
});

describe("validateHttpsImageUrl", () => {
  it("accepts blank and HTTPS image URLs", () => {
    expect(validateHttpsImageUrl("")).toEqual({ ok: true, value: null });
    expect(validateHttpsImageUrl("https://example.com/image.jpg")).toEqual({
      ok: true,
      value: "https://example.com/image.jpg",
    });
  });

  it("rejects insecure image URLs", () => {
    expect(validateHttpsImageUrl("http://example.com/image.jpg").ok).toBe(false);
  });
});
