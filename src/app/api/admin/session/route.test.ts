import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  validSecret: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/admin-auth", () => ({
  ADMIN_COOKIE: "auction_admin",
  adminCookieValue: () => "signed-test-session",
  adminIsConfigured: mocks.configured,
  isAdminRequest: vi.fn(),
  secretIsValid: mocks.validSecret,
}));
vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdminClient: () => ({ rpc: mocks.rpc }),
}));

import { POST } from "./route";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("SITE_ID", undefined);
  vi.stubEnv("URL", undefined);
  mocks.configured.mockReturnValue(true);
  mocks.validSecret.mockImplementation((secret: string) => secret === "valid-test-secret");
  mocks.rpc.mockResolvedValue({ data: [{ allowed: true }], error: null });
});
afterEach(() => vi.unstubAllEnvs());

function request(body: unknown) {
  return new Request("http://localhost:3000/api/admin/session", {
    method: "POST",
    headers: { Origin: "http://localhost:3000", Host: "localhost:3000", "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin login input", () => {
  it.each([null, [], {}, { secret: 123 }, { secret: true }, { secret: null }, { secret: {} }, { secret: [] }])("rejects malformed input %j before hashing or accessing Supabase", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(mocks.validSecret).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects malformed JSON without a server error", async () => {
    const invalid = request({ secret: "unused" });
    const response = await POST(new Request(invalid, { body: "{" }));
    expect(response.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(["", "wrong-test-secret"])("keeps failed string passwords subject to the database rate limit", async (secret) => {
    const response = await POST(request({ secret }));
    expect(response.status).toBe(401);
    expect(mocks.rpc).toHaveBeenCalledWith("consume_admin_login_attempt", expect.objectContaining({ p_succeeded: false }));
  });

  it("keeps the rate-limit response and Retry-After header", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ allowed: false, retry_after_seconds: 90 }], error: null });
    const response = await POST(request({ secret: "wrong-test-secret" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("90");
  });

  it("issues a protected session cookie for a valid string password", async () => {
    const response = await POST(request({ secret: "valid-test-secret" }));
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("consume_admin_login_attempt", expect.objectContaining({ p_succeeded: true }));
    expect(response.headers.get("set-cookie")).toMatch(/auction_admin=signed-test-session/);
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect(response.headers.get("set-cookie")).toMatch(/SameSite=strict/i);
  });

  it("accepts the public Netlify origin behind the adapter and issues a secure session", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_ID", "trusted-netlify-site");
    vi.stubEnv("URL", "https://rbchristmasauction.netlify.app");
    const input = new Request("http://localhost:443/api/admin/session", {
      method: "POST",
      headers: { Origin: "https://rbchristmasauction.netlify.app", "Content-Type": "application/json" },
      body: JSON.stringify({ secret: "valid-test-secret" }),
    });
    const response = await POST(input);
    expect(response.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("consume_admin_login_attempt", expect.objectContaining({ p_succeeded: true }));
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/);
    expect(response.headers.get("set-cookie")).toMatch(/; Secure/);
    expect(response.headers.get("set-cookie")).toMatch(/SameSite=strict/i);
  });

  it("rejects foreign Netlify login origins before validating the secret or accessing Supabase", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_ID", "trusted-netlify-site");
    vi.stubEnv("URL", "https://rbchristmasauction.netlify.app");
    const input = new Request("http://localhost:443/api/admin/session", {
      method: "POST",
      headers: {
        Origin: "https://untrusted.example", Host: "untrusted.example",
        "x-forwarded-host": "untrusted.example", "x-forwarded-proto": "https",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ secret: "valid-test-secret" }),
    });
    const response = await POST(input);
    expect(response.status).toBe(403);
    expect(mocks.validSecret).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
