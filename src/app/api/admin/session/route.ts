import { NextResponse } from "next/server";

import {
  ADMIN_COOKIE,
  adminCookieValue,
  adminIsConfigured,
  isAdminRequest,
  secretIsValid,
} from "@/lib/admin-auth";

export async function GET() {
  return NextResponse.json({
    configured: adminIsConfigured(),
    authenticated: await isAdminRequest(),
  });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { secret?: string } | null;
  if (!body?.secret || !secretIsValid(body.secret)) {
    return NextResponse.json({ error: "Invalid administrator secret." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, adminCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 8,
    path: "/",
  });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, maxAge: 0, path: "/" });
  return response;
}
