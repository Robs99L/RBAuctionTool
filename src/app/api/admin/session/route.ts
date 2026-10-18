import {
  crossOriginResponse,
  isSameOriginRequest,
  loginRateLimitKey,
  noStoreJson,
} from "@/lib/admin-api";
import {
  ADMIN_COOKIE,
  adminCookieValue,
  adminIsConfigured,
  isAdminRequest,
  secretIsValid,
} from "@/lib/admin-auth";
import { ADMIN_SESSION_LIFETIME_SECONDS } from "@/lib/admin-session-token";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export async function GET() {
  return noStoreJson({
    configured: adminIsConfigured(),
    authenticated: await isAdminRequest(),
  });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return crossOriginResponse();
  if (!adminIsConfigured()) {
    return noStoreJson({ error: "Administrator access is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as { secret?: string } | null;
  const succeeded = Boolean(body?.secret && secretIsValid(body.secret));

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("consume_admin_login_attempt", {
      p_key_hash: loginRateLimitKey(request),
      p_succeeded: succeeded,
    });
    if (error) throw error;
    const result = data?.[0] as { allowed?: boolean; retry_after_seconds?: number } | undefined;
    if (!result?.allowed) {
      const retryAfter = Math.max(1, Number(result?.retry_after_seconds ?? 60));
      const response = noStoreJson(
        { error: "Too many sign-in attempts. Try again later." },
        { status: 429 },
      );
      response.headers.set("Retry-After", String(retryAfter));
      return response;
    }
  } catch (error) {
    console.error("Admin login rate-limit check failed.", error);
    return noStoreJson({ error: "Administrator sign-in is temporarily unavailable." }, { status: 503 });
  }

  if (!succeeded) {
    return noStoreJson({ error: "Invalid administrator secret." }, { status: 401 });
  }

  const response = noStoreJson({ ok: true });
  response.cookies.set(ADMIN_COOKIE, adminCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: ADMIN_SESSION_LIFETIME_SECONDS,
    path: "/",
  });
  return response;
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return crossOriginResponse();
  const response = noStoreJson({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    path: "/",
  });
  return response;
}
