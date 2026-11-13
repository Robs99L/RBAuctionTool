import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isSameOriginRequest } from "./admin-api";

afterEach(() => vi.unstubAllEnvs());
beforeEach(() => {
  vi.stubEnv("SITE_ID", undefined);
  vi.stubEnv("URL", undefined);
});

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

  it("ignores forwarded hosts and keeps non-Netlify production validation tied to the request URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    const valid = request("https://auction.example/api/admin/session", "https://auction.example", "untrusted.example");
    valid.headers.set("x-forwarded-host", "untrusted.example");
    expect(isSameOriginRequest(valid)).toBe(true);
    expect(isSameOriginRequest(request("https://auction.example/api/admin/session", "https://untrusted.example", "untrusted.example"))).toBe(false);
    expect(isSameOriginRequest(request("http://localhost:3000/api/admin/session", "http://127.0.0.1:3000", "127.0.0.1:3000"))).toBe(false);
  });

  it.each([
    "http://localhost:443/api/admin/session",
    "http://rbchristmasauction.netlify.app/api/admin/session",
    "https://older-deploy--rbchristmasauction.netlify.app/api/admin/session",
  ])("accepts the configured public Netlify origin when the adapter URL is %s", url => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_ID", "trusted-netlify-site");
    vi.stubEnv("URL", "https://rbchristmasauction.netlify.app");
    expect(isSameOriginRequest(request(url, "https://rbchristmasauction.netlify.app"))).toBe(true);
  });

  it.each([
    "https://untrusted.example", "http://rbchristmasauction.netlify.app",
    "https://rbchristmasauction.netlify.app:444", "https://rbchristmasauction.netlify.app.untrusted.example",
    "null", "https://rbchristmasauction.netlify.app/admin", "https://user@rbchristmasauction.netlify.app",
  ])("rejects an untrusted or malformed origin %s despite forged forwarding headers", origin => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_ID", "trusted-netlify-site");
    vi.stubEnv("URL", "https://rbchristmasauction.netlify.app");
    const input = request("http://localhost:443/api/admin/session", origin, new URL(origin === "null" ? "https://untrusted.example" : origin).host);
    input.headers.set("x-forwarded-host", input.headers.get("host")!);
    input.headers.set("x-forwarded-proto", "https");
    expect(isSameOriginRequest(input)).toBe(false);
  });

  it.each([undefined, "invalid", "http://rbchristmasauction.netlify.app", "https://user:password@rbchristmasauction.netlify.app"])("fails closed for missing or invalid Netlify configuration %s", value => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SITE_ID", "trusted-netlify-site");
    vi.stubEnv("URL", value);
    expect(isSameOriginRequest(request("http://localhost:443/api/admin/session", "https://rbchristmasauction.netlify.app"))).toBe(false);
  });

  it("does not trust a URL environment variable outside Netlify or allow missing Origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("URL", "https://rbchristmasauction.netlify.app");
    const input = request("http://localhost:443/api/admin/session", "https://rbchristmasauction.netlify.app");
    expect(isSameOriginRequest(input)).toBe(false);
    vi.stubEnv("SITE_ID", "trusted-netlify-site");
    expect(isSameOriginRequest(request(input.url))).toBe(false);
  });

  it("requires an Origin in production while allowing local tools without it", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isSameOriginRequest(request("https://auction.example/api/admin/session"))).toBe(false);
    vi.stubEnv("NODE_ENV", "development");
    expect(isSameOriginRequest(request("http://localhost:3000/api/admin/session"))).toBe(true);
  });
});
