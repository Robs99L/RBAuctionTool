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
  winnerCount?: number;
  currency?: string;
};

function unauthorized() {
  return NextResponse.json({ error: "Administrator authorization required." }, { status: 401 });
}

function configurationError(error: unknown) {
  const details = error instanceof Error
    ? `${error.name}: ${error.message}${error.cause ? `\nCause: ${String(error.cause)}` : ""}`
    : JSON.stringify(error);
  console.error(`Admin Supabase request failed. ${details}`);
  const message = error instanceof Error ? error.message : "Server configuration error.";
  return NextResponse.json({ error: message }, { status: 503 });
}

export async function GET(request: Request) {
  if (!(await isAdminRequest())) return unauthorized();
  try {
    const client = getSupabaseAdminClient();
    const { data, error } = await client
      .from("auctions")
      .select("*")
      .order("sort_order", { ascending: true });
    if (error) throw error;
    const auctions = data ?? [];
    const requestedId = new URL(request.url).searchParams.get("auctionId");
    const selected =
      auctions.find((auction) => auction.id === requestedId) ??
      auctions.find((auction) => auction.status === "active") ??
      auctions.find((auction) => auction.status === "upcoming") ??
      [...auctions].reverse().find((auction) => auction.status === "ended") ??
      null;
    let bids: unknown[] = [];
    if (selected) {
      const result = await client
        .from("bids")
        .select("id, participant_id, amount, created_at, participants(username)")
        .eq("auction_id", selected.id)
        .order("created_at", { ascending: false });
      if (result.error) throw result.error;
      bids = result.data ?? [];
    }
    return NextResponse.json({ auctions, auction: selected, bids });
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
  const winnerCount = Number(body?.winnerCount);
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
    !Number.isSafeInteger(winnerCount) ||
    winnerCount < 1 ||
    winnerCount > 1000 ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    return NextResponse.json({ error: "Check the title, prices, winner count, and currency." }, { status: 400 });
  }

  const values = {
    title,
    description: body?.description?.trim().slice(0, 4000) ?? "",
    image_url: imageUrl.slice(0, 2000) || null,
    starting_price: startingPrice,
    minimum_increment: minimumIncrement,
    winner_count: winnerCount,
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

  try {
    const client = getSupabaseAdminClient();
    if (body.action === "start") {
      const { error: activationError } = await client.rpc("activate_auction", {
        p_auction_id: body.id,
      });
      if (activationError) throw activationError;
    } else {
      const { error: endError } = await client
        .from("auctions")
        .update({ status: "ended", ends_at: new Date().toISOString() })
        .eq("id", body.id)
        .eq("status", "active")
        .select("id")
        .single();
      if (endError) throw endError;
    }
    const { data, error } = await client
      .from("auctions")
      .select("*")
      .eq("id", body.id)
      .single();
    if (error) throw error;
    return NextResponse.json({ auction: data });
  } catch (error) {
    return configurationError(error);
  }
}
