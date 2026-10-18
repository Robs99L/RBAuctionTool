import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_LIFETIME_SECONDS = 8 * 60 * 60;
const TOKEN_VERSION = "v1";

function signatureFor(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createAdminSessionToken(
  secret: string,
  nowMs = Date.now(),
  nonce = randomBytes(18).toString("base64url"),
) {
  if (secret.length < 16) {
    throw new Error("ADMIN_SECRET must be at least 16 characters.");
  }

  const issuedAt = Math.floor(nowMs / 1000);
  const expiresAt = issuedAt + ADMIN_SESSION_LIFETIME_SECONDS;
  const payload = `${TOKEN_VERSION}.${issuedAt}.${expiresAt}.${nonce}`;
  return `${payload}.${signatureFor(payload, secret)}`;
}

export function verifyAdminSessionToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
) {
  if (!token || secret.length < 16) return false;
  const parts = token.split(".");
  if (parts.length !== 5) return false;

  const [version, issuedAtValue, expiresAtValue, nonce, actualSignature] = parts;
  const issuedAt = Number(issuedAtValue);
  const expiresAt = Number(expiresAtValue);
  const now = Math.floor(nowMs / 1000);
  if (
    version !== TOKEN_VERSION ||
    !nonce ||
    !Number.isSafeInteger(issuedAt) ||
    !Number.isSafeInteger(expiresAt) ||
    issuedAt > now + 60 ||
    expiresAt <= now ||
    expiresAt - issuedAt !== ADMIN_SESSION_LIFETIME_SECONDS
  ) {
    return false;
  }

  const payload = parts.slice(0, 4).join(".");
  const expectedSignature = signatureFor(payload, secret);
  const actual = Buffer.from(actualSignature);
  const expected = Buffer.from(expectedSignature);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
