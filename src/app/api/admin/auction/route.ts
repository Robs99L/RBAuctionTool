import { NextResponse } from "next/server";

import { isAdminRequest } from "@/lib/admin-auth";
import {
  productImageExtension,
  productImagePathFromUrl,
  PRODUCT_IMAGE_BUCKET,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MIME_TYPES,
  type ProductImageMimeType,
} from "@/lib/product-image";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

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

function formValue(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

async function ensureProductImageBucket(client: ReturnType<typeof getSupabaseAdminClient>) {
  const bucketOptions = {
    public: true,
    fileSizeLimit: PRODUCT_IMAGE_MAX_BYTES,
    allowedMimeTypes: [...PRODUCT_IMAGE_MIME_TYPES],
  };
  const { data: bucket, error: bucketError } = await client.storage.getBucket(PRODUCT_IMAGE_BUCKET);

  if (bucketError) {
    if (bucketError.statusCode !== "404") throw bucketError;
    const { error: createError } = await client.storage.createBucket(PRODUCT_IMAGE_BUCKET, bucketOptions);
    if (createError && createError.statusCode !== "409") throw createError;
    return;
  }

  const allowedMimeTypes = bucket.allowed_mime_types ?? [];
  const needsUpdate =
    !bucket.public ||
    bucket.file_size_limit !== PRODUCT_IMAGE_MAX_BYTES ||
    PRODUCT_IMAGE_MIME_TYPES.some((mimeType) => !allowedMimeTypes.includes(mimeType)) ||
    allowedMimeTypes.some((mimeType) => !PRODUCT_IMAGE_MIME_TYPES.includes(mimeType as ProductImageMimeType));

  if (needsUpdate) {
    const { error: updateError } = await client.storage.updateBucket(PRODUCT_IMAGE_BUCKET, bucketOptions);
    if (updateError) throw updateError;
  }
}

async function removeProductImage(
  client: ReturnType<typeof getSupabaseAdminClient>,
  path: string,
) {
  const { error } = await client.storage.from(PRODUCT_IMAGE_BUCKET).remove([path]);
  if (error) console.error(`Could not remove product image ${path}. ${error.message}`);
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
  const formData = await request.formData().catch(() => null);
  if (!formData) return NextResponse.json({ error: "Invalid product form data." }, { status: 400 });

  const id = formValue(formData, "id").trim();
  const title = formValue(formData, "title").trim();
  const description = formValue(formData, "description").trim().slice(0, 4000);
  const startingPrice = Number(formValue(formData, "startingPrice"));
  const minimumIncrement = Number(formValue(formData, "minimumIncrement"));
  const winnerCount = Number(formValue(formData, "winnerCount"));
  const currency = formValue(formData, "currency").trim().toUpperCase();
  const imageEntry = formData.get("image");
  const imageFile = imageEntry instanceof File && imageEntry.size > 0 ? imageEntry : null;

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

  if (imageFile && imageFile.size > PRODUCT_IMAGE_MAX_BYTES) {
    return NextResponse.json({ error: "Product images must not exceed 4 MB." }, { status: 413 });
  }

  let imageUpload: { bytes: Uint8Array; extension: "png" | "jpg" } | null = null;
  if (imageFile) {
    const bytes = new Uint8Array(await imageFile.arrayBuffer());
    const extension = productImageExtension(imageFile.type, bytes);
    if (!extension) {
      return NextResponse.json({ error: "Product images must be valid PNG or JPEG files." }, { status: 400 });
    }
    imageUpload = { bytes, extension };
  }

  let uploadedPath: string | null = null;
  try {
    const client = getSupabaseAdminClient();
    const auctionId = id || crypto.randomUUID();
    let previousImageUrl: string | null = null;
    if (id) {
      const { data: existingAuction, error: existingAuctionError } = await client
        .from("auctions")
        .select("image_url")
        .eq("id", id)
        .single();
      if (existingAuctionError) throw existingAuctionError;
      previousImageUrl = existingAuction.image_url;
    }

    let imageUrl = previousImageUrl;
    if (imageUpload && imageFile) {
      await ensureProductImageBucket(client);
      uploadedPath = `${auctionId}/${crypto.randomUUID()}.${imageUpload.extension}`;
      const { error: uploadError } = await client.storage
        .from(PRODUCT_IMAGE_BUCKET)
        .upload(uploadedPath, imageUpload.bytes, {
          cacheControl: "31536000",
          contentType: imageFile.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;
      imageUrl = client.storage.from(PRODUCT_IMAGE_BUCKET).getPublicUrl(uploadedPath).data.publicUrl;
    }

    const values = {
      title,
      description,
      image_url: imageUrl,
      starting_price: startingPrice,
      minimum_increment: minimumIncrement,
      winner_count: winnerCount,
      currency,
    };
    const query = id
      ? client.from("auctions").update(values).eq("id", id).select("*").single()
      : client.from("auctions").insert({ id: auctionId, ...values, status: "upcoming" }).select("*").single();
    const { data, error } = await query;
    if (error) throw error;

    const previousImagePath = productImagePathFromUrl(previousImageUrl);
    if (uploadedPath && previousImagePath && previousImagePath !== uploadedPath) {
      await removeProductImage(client, previousImagePath);
    }
    return NextResponse.json({ auction: data });
  } catch (error) {
    if (uploadedPath) {
      const client = getSupabaseAdminClient();
      await removeProductImage(client, uploadedPath);
    }
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
