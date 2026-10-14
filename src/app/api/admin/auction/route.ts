import { NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

type AuctionInput = {
  id?: string;
  title?: string;
  description?: string;
  imageUrl?: string;
  startingPrice?: number;
  minimumIncrement?: number;
  currency?: string;
};

function unauthorized() {
  return NextResponse.json({ error: "Administrator authorization required." }, { status: 401 });
}

function configurationError(error: unknown) {
  const message = error instanceof Error ? error.message : "Server configuration error.";
  return NextResponse.json({ error: message }, { status: 503 });
}

export async function GET() {
  if (!(await isAdminRequest())) return unauthorized();
  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("auctions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    let bids: unknown[] = [];
    if (data) {
      const result = await getSupabaseAdminClient()
        .from("bids")
        .select("id, amount, created_at, participants(username)")
        .eq("auction_id", data.id)
        .order("created_at", { ascending: false });
      if (result.error) throw result.error;
      bids = result.data ?? [];
    }
    return NextResponse.json({ auction: data, bids });
  } catch (error) {
    return configurationError(error);
  }
}

export async function PUT(request: Request) {
  if (!(await isAdminRequest())) return unauthorized();
  const body = (await request.json().catch(() => null)) as AuctionInput | null;
  const title = body?.title?.trim() ?? "";
  const startingPrice = Number(body?.startingPrice);
  const minimumIncrement = Number(body?.minimumIncrement);
  const currency = body?.currency?.trim().toUpperCase() ?? "";
  const imageUrl = body?.imageUrl?.trim() ?? "";

  if (imageUrl) {
    try {
      const parsedImageUrl = new URL(imageUrl);
      if (!["http:", "https:"].includes(parsedImageUrl.protocol)) throw new Error();
    } catch {
      return NextResponse.json({ error: "Image URL must be a valid HTTP or HTTPS address." }, { status: 400 });
    }
  }

  if (
    !title ||
    title.length > 120 ||
    !Number.isFinite(startingPrice) ||
    startingPrice < 0 ||
    !Number.isFinite(minimumIncrement) ||
    minimumIncrement <= 0 ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return NextResponse.json({ error: "Check the title, prices, and currency." }, { status: 400 });
  }

  const values = {
    title,
    description: body?.description?.trim().slice(0, 4000) ?? "",
    image_url: imageUrl.slice(0, 2000) || null,
    starting_price: startingPrice,
    minimum_increment: minimumIncrement,
    currency,
  };

  try {
    const client = getSupabaseAdminClient();
    const query = body?.id
      ? client.from("auctions").update(values).eq("id", body.id).select("*").single()
      : client.from("auctions").insert({ ...values, status: "upcoming" }).select("*").single();
    const { data, error } = await query;
    if (error) throw error;
    return NextResponse.json({ auction: data });
  } catch (error) {
    return configurationError(error);
  }
}

export async function POST(request: Request) {
  if (!(await isAdminRequest())) return unauthorized();
  const body = (await request.json().catch(() => null)) as {
    id?: string;
    action?: "start" | "end";
  } | null;
  if (!body?.id || !["start", "end"].includes(body.action ?? "")) {
    return NextResponse.json({ error: "A valid auction action is required." }, { status: 400 });
  }

  const now = new Date().toISOString();
  const values =
    body.action === "start"
      ? { status: "active", starts_at: now, ends_at: null }
      : { status: "ended", ends_at: now };

  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("auctions")
      .update(values)
      .eq("id", body.id)
      .select("*")
      .single();
    if (error) throw error;
    return NextResponse.json({ auction: data });
  } catch (error) {
    return configurationError(error);
  }
}
