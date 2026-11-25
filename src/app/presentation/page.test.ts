import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cookie: vi.fn(), redirect: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => mocks.cookie() }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    mocks.redirect(path);
    throw new Error(`redirect:${path}`);
  },
}));
vi.mock("@/components/auction-app", () => ({ AuctionApp: () => null }));

import { createAdminSessionToken } from "@/lib/admin-session-token";
import PresentationPage from "./page";

const secret = "local-presentation-access-test-secret";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("ADMIN_SECRET", secret);
  vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "false");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://fixture.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "local-test-key");
});
afterEach(() => vi.unstubAllEnvs());

describe("presentation admin access", () => {
  it("sends a participant without an admin session to the admin login", async () => {
    await expect(PresentationPage()).rejects.toThrow("redirect:/admin");
    expect(mocks.redirect).toHaveBeenCalledWith("/admin");
  });

  it("opens the presentation for a valid admin session", async () => {
    mocks.cookie.mockReturnValue({ value: createAdminSessionToken(secret) });
    expect((await PresentationPage()).props.presentation).toBe(true);
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each(["forged", "expired", "another secret"])("rejects an %s admin session", async (kind) => {
    const token = kind === "forged" ? "not-an-admin-token"
      : kind === "expired" ? createAdminSessionToken(secret, Date.now() - 9 * 60 * 60 * 1000)
        : createAdminSessionToken("a-different-local-test-secret");
    mocks.cookie.mockReturnValue({ value: token });
    await expect(PresentationPage()).rejects.toThrow("redirect:/admin");
  });

  it("also requires admin login for development connected to a real project", async () => {
    vi.stubEnv("NODE_ENV", "development");
    await expect(PresentationPage()).rejects.toThrow("redirect:/admin");
  });

  it("also requires an admin session for the standalone local development demo", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    await expect(PresentationPage()).rejects.toThrow("redirect:/admin");
  });

  it("does not bypass admin login when demo mode is enabled in production", async () => {
    vi.stubEnv("NEXT_PUBLIC_DEMO_MODE", "true");
    await expect(PresentationPage()).rejects.toThrow("redirect:/admin");
  });
});
