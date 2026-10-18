import "server-only";

import { createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";

import {
  createAdminSessionToken,
  verifyAdminSessionToken,
} from "@/lib/admin-session-token";

export const ADMIN_COOKIE = "auction_admin";

function configuredSecret() {
  return process.env.ADMIN_SECRET ?? "";
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
  return createAdminSessionToken(secret);
}

export async function isAdminRequest() {
  const cookieStore = await cookies();
  const actual = cookieStore.get(ADMIN_COOKIE)?.value ?? "";
  const secret = configuredSecret();
  return verifyAdminSessionToken(actual, secret);
}
