import "server-only";

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE = "auction_admin";

function configuredSecret() {
  return process.env.ADMIN_SECRET ?? "";
}

function tokenFor(secret: string) {
  return createHmac("sha256", secret)
    .update("live-auction-admin-v1")
    .digest("hex");
}

export function adminIsConfigured() {
  return Boolean(
    configuredSecret().length >= 16 &&
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );
}

export function secretIsValid(candidate: string) {
  const expected = configuredSecret();
  if (expected.length < 16) return false;
  const candidateHash = createHash("sha256").update(candidate).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(candidateHash, expectedHash);
}

export function adminCookieValue() {
  const secret = configuredSecret();
  if (secret.length < 16) throw new Error("ADMIN_SECRET must be at least 16 characters.");
  return tokenFor(secret);
}

export async function isAdminRequest() {
  const cookieStore = await cookies();
  const actual = cookieStore.get(ADMIN_COOKIE)?.value ?? "";
  const secret = configuredSecret();
  if (!actual || secret.length < 16) return false;
  const expected = tokenFor(secret);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
