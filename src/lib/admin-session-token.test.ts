import { describe, expect, it } from "vitest";

import {
  ADMIN_SESSION_LIFETIME_SECONDS,
  createAdminSessionToken,
  verifyAdminSessionToken,
} from "./admin-session-token";

const secret = "a-secure-admin-secret-for-tests";
const now = Date.UTC(2026, 9, 18, 10, 0, 0);

describe("admin session tokens", () => {
  it("creates randomized signed tokens", () => {
    const first = createAdminSessionToken(secret, now, "nonce-one");
    const second = createAdminSessionToken(secret, now, "nonce-two");
    expect(first).not.toBe(second);
    expect(verifyAdminSessionToken(first, secret, now)).toBe(true);
    expect(verifyAdminSessionToken(second, secret, now)).toBe(true);
  });

  it("rejects expired or tampered tokens", () => {
    const token = createAdminSessionToken(secret, now, "nonce");
    expect(verifyAdminSessionToken(
      token,
      secret,
      now + ADMIN_SESSION_LIFETIME_SECONDS * 1000,
    )).toBe(false);
    expect(verifyAdminSessionToken(`${token}x`, secret, now)).toBe(false);
    expect(verifyAdminSessionToken(token, `${secret}-wrong`, now)).toBe(false);
  });
});
