import { afterEach, describe, expect, it, vi } from "vitest";

import { isSameOriginRequest } from "./admin-api";

afterEach(() => vi.unstubAllEnvs());

function request(url: string, origin?: string, host?: string) {
  const headers = new Headers();
  if (origin !== undefined) headers.set("origin", origin);
  if (host !== undefined) headers.set("host", host);
  return new Request(url, { headers });
}

describe("admin request origin", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])("accepts the actual local host %s when Next normalizes its URL", (host) => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isSameOriginRequest(request("http://localhost:3000/api/admin/session", `http://${host}:3000`, `${host}:3000`))).toBe(true);
  });

  it("rejects a different local host from the browser's actual origin", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isSameOriginRequest(request("http://localhost:3000/api/admin/session", "http://localhost:3000", "127.0.0.1:3000"))).toBe(false);
  });

  it.each(["http://localhost:3001", "https://localhost:3000", "https://untrusted.example", "null", "invalid"])("rejects a different or invalid origin %s", (origin) => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isSameOriginRequest(request("http://localhost:3000/api/admin/session", origin, "localhost:3000"))).toBe(false);
  });

  it("rejects a mismatched port in the local host header", () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(isSameOriginRequest(request("http://localhost:3000/api/admin/session", "http://127.0.0.1:3001", "127.0.0.1:3001"))).toBe(false);
  });

  it("keeps production validation tied to the request URL and ignores forwarded hosts", () => {
    vi.stubEnv("NODE_ENV", "production");
    const valid = request("https://auction.example/api/admin/session", "https://auction.example", "untrusted.example");
    valid.headers.set("x-forwarded-host", "untrusted.example");
    expect(isSameOriginRequest(valid)).toBe(true);
    expect(isSameOriginRequest(request("https://auction.example/api/admin/session", "https://untrusted.example", "untrusted.example"))).toBe(false);
    expect(isSameOriginRequest(request("http://localhost:3000/api/admin/session", "http://127.0.0.1:3000", "127.0.0.1:3000"))).toBe(false);
  });

  it("requires an Origin in production while allowing local tools without it", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isSameOriginRequest(request("https://auction.example/api/admin/session"))).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(isSameOriginRequest(request("http://localhost:3000/api/admin/session"))).toBe(true);
  });
});
