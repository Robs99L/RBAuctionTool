import "server-only";

import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

export function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

function netlifySiteOrigin() {
  // Netlify provides SITE_ID and URL to Functions at runtime. Its Next.js
  // adapter may retain an internal URL or the host of an earlier request.
  // Trust this server configuration, never client-supplied forwarded headers.
  if (!process.env.SITE_ID || !process.env.URL) return null;
  try {
    const siteUrl = new URL(process.env.URL);
    if (siteUrl.protocol !== "https:" || siteUrl.username || siteUrl.password) return null;
    return siteUrl.origin;
  } catch {
    return null;
  }
}

export function isSameOriginRequest(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin) return process.env.NODE_ENV !== "production";

  try {
    const browserUrl = new URL(origin);
    if (!["http:", "https:"].includes(browserUrl.protocol) || browserUrl.origin !== origin) return false;
    const requestUrl = new URL(request.url);
    const host = request.headers.get("host");
    // Next's dev server can normalize 127.0.0.1 to localhost in request.url.
    // Only use the browser's actual Host for local development requests.
    if (
      process.env.NODE_ENV !== "production" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(requestUrl.hostname) &&
      host && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(host)
    ) {
      const localUrl = new URL(`${requestUrl.protocol}//${host}`);
      if (localUrl.port !== requestUrl.port) return false;
      return browserUrl.origin === localUrl.origin;
    }
    return browserUrl.origin === requestUrl.origin || (
      process.env.NODE_ENV === "production" && browserUrl.origin === netlifySiteOrigin()
    );
  } catch {
    return false;
  }
}

export function crossOriginResponse() {
  return noStoreJson({ error: "Cross-origin request rejected." }, { status: 403 });
}

export function loginRateLimitKey(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const address = forwarded || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`admin-login:${address}`).digest("hex");
}

export function publicAdminError(error: unknown, fallback: string) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "";
  if (message.includes("Auction rules cannot change")) {
    return "Pricing, winner, currency, and timer rules cannot change after an event starts.";
  }
  if (message.includes("Auction details cannot change while an event is active")) {
    return "Name, description, and image cannot change while an event is live.";
  }
  if (message.includes("Only an upcoming auction event can be deleted")) {
    return "Only upcoming events can be deleted.";
  }
  if (message.includes("registrations or bids cannot be deleted")) {
    return "This event already has registrations or bids and cannot be deleted.";
  }
  if (message.includes("Only an active auction event can be ended")) {
    return "Only the active event can be ended.";
  }
  if (message.includes("Only an upcoming auction event can be started")) {
    return "Only an upcoming event can be started.";
  }
  return fallback;
}
