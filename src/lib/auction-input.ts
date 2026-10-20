export type AuctionInput = {
  title: unknown;
  description: unknown;
  startingPrice: unknown;
  minimumIncrement: unknown;
  maximumDifference: unknown;
  winnerCount: unknown;
  timerDurationMinutes: unknown;
  currency: unknown;
};

export type ValidAuctionInput = {
  title: string;
  description: string;
  starting_price: number;
  minimum_increment: number;
  maximum_bid_difference: number | null;
  winner_count: number;
  timer_duration_seconds: number;
  currency: string;
};

export type AuctionInputResult =
  | { ok: true; value: ValidAuctionInput }
  | { ok: false; errors: string[] };

export type ImageUrlResult =
  | { ok: true; value: string | null }
  | { ok: false; error: string };

const MAX_MONEY = 9_999_999_999.99;

function textValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberValue(value: unknown) {
  if (typeof value === "number") return value;
  const text = textValue(value).trim();
  if (!text) return Number.NaN;
  return Number(text.includes(",") && !text.includes(".") ? text.replace(",", ".") : text);
}

function hasAtMostTwoDecimals(value: number) {
  return Math.abs(value * 100 - Math.round(value * 100)) < 1e-8;
}

function isMoney(value: number, allowZero: boolean) {
  return Number.isFinite(value)
    && (allowZero ? value >= 0 : value > 0)
    && value <= MAX_MONEY
    && hasAtMostTwoDecimals(value);
}

export function validateAuctionInput(input: AuctionInput): AuctionInputResult {
  const title = textValue(input.title).trim();
  const description = textValue(input.description).trim();
  const startingPrice = numberValue(input.startingPrice);
  const minimumIncrement = numberValue(input.minimumIncrement);
  const maximumDifferenceText = textValue(input.maximumDifference).trim();
  const maximumDifference = maximumDifferenceText === ""
    ? null
    : numberValue(input.maximumDifference);
  const winnerCount = numberValue(input.winnerCount);
  const timerDurationMinutes = numberValue(input.timerDurationMinutes);
  const timerDurationSeconds = timerDurationMinutes * 60;
  const currency = textValue(input.currency).trim().toUpperCase();
  const errors: string[] = [];

  if (!title || title.length > 120) {
    errors.push("Event name must contain 1 to 120 characters.");
  }
  if (description.length > 4000) {
    errors.push("Description must not exceed 4,000 characters.");
  }
  if (!isMoney(startingPrice, true)) {
    errors.push("Starting price must be between 0 and 9,999,999,999.99 with at most two decimals.");
  }
  if (!isMoney(minimumIncrement, false)) {
    errors.push("Minimum step must be between 0.01 and 9,999,999,999.99 with at most two decimals.");
  }
  if (
    maximumDifference !== null
    && (
      !isMoney(maximumDifference, false)
      || (Number.isFinite(minimumIncrement) && maximumDifference < minimumIncrement)
    )
  ) {
    errors.push("Maximum increase must be blank or at least the minimum step, with at most two decimals.");
  }
  if (!Number.isSafeInteger(winnerCount) || winnerCount < 1 || winnerCount > 1000) {
    errors.push("Winning bidders must be a whole number between 1 and 1,000.");
  }
  if (
    !Number.isSafeInteger(timerDurationSeconds)
    || timerDurationSeconds < 30
    || timerDurationSeconds > 86_400
  ) {
    errors.push("Timer duration must be between 0.5 and 1,440 minutes.");
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    errors.push("Currency must be a three-letter code such as EUR.");
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      title,
      description,
      starting_price: startingPrice,
      minimum_increment: minimumIncrement,
      maximum_bid_difference: maximumDifference,
      winner_count: winnerCount,
      timer_duration_seconds: timerDurationSeconds,
      currency,
    },
  };
}

export function validateHttpsImageUrl(value: unknown): ImageUrlResult {
  const imageUrl = textValue(value).trim();
  if (!imageUrl) return { ok: true, value: null };
  if (imageUrl.length > 2000) {
    return { ok: false, error: "Image URL must not exceed 2,000 characters." };
  }

  try {
    const parsed = new URL(imageUrl);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error();
  } catch {
    return { ok: false, error: "Image URL must be a valid public HTTPS URL." };
  }

  return { ok: true, value: imageUrl };
}
