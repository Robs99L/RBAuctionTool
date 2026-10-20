import {
  crossOriginResponse,
  isSameOriginRequest,
  noStoreJson,
  publicAdminError,
} from "@/lib/admin-api";
import { isAdminRequest } from "@/lib/admin-auth";
import {
  productImageExtension,
  productImagePathFromUrl,
  PRODUCT_IMAGE_BUCKET,
  PRODUCT_IMAGE_MAX_BYTES,
  PRODUCT_IMAGE_MIME_TYPES,
  type ProductImageMimeType,
} from "@/lib/product-image";
import { validateAuctionInput } from "@/lib/auction-input";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

function unauthorized() {
  return noStoreJson({ error: "Administrator authorization required." }, { status: 401 });
}

function adminRequestError(error: unknown, fallback: string, status = 500) {
  const details = error instanceof Error
    ? `${error.name}: ${error.message}${error.cause ? `\nCause: ${String(error.cause)}` : ""}`
    : JSON.stringify(error);
  console.error(`Admin Supabase request failed. ${details}`);
  return noStoreJson({ error: publicAdminError(error, fallback) }, { status });
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

async function removeProductImageIfUnused(
  client: ReturnType<typeof getSupabaseAdminClient>,
  imageUrl: string | null,
) {
  try {
    const path = productImagePathFromUrl(imageUrl);
    if (!path || !imageUrl) return;

    const { count, error } = await client
      .from("auctions")
      .select("id", { count: "exact", head: true })
      .eq("image_url", imageUrl);
    if (error) {
      console.error(`Could not verify whether product image ${path} is still used. ${error.message}`);
      return;
    }
    if ((count ?? 0) === 0) await removeProductImage(client, path);
  } catch (error) {
    console.error("Could not clean up an unused product image.", error);
  }
}

export async function GET(request: Request) {
  if (!(await isAdminRequest())) return unauthorized();
  try {
    const client = getSupabaseAdminClient();
    const [auctionResult, donationResult, winnerReportResult] = await Promise.all([
      client
        .from("auctions")
        .select("*")
        .order("sort_order", { ascending: true }),
      client.rpc("get_auction_donation_totals"),
      client.rpc("get_auction_winner_report"),
    ]);
    if (auctionResult.error) throw auctionResult.error;
    if (donationResult.error) throw donationResult.error;
    if (winnerReportResult.error) throw winnerReportResult.error;
    const auctions = auctionResult.data ?? [];
    const requestedId = new URL(request.url).searchParams.get("auctionId");
    const selected =
      auctions.find((auction) => auction.id === requestedId) ??
      auctions.find((auction) => auction.status === "active") ??
      auctions.find((auction) => auction.status === "upcoming") ??
      [...auctions].reverse().find((auction) => auction.status === "ended") ??
      null;
    let bids: unknown[] = [];
    if (selected) {
      const result = await client.rpc("get_auction_admin_bids", {
        p_auction_id: selected.id,
      });
      if (result.error) throw result.error;
      bids = result.data ?? [];
    }
    return noStoreJson({
      auctions,
      auction: selected,
      bids,
      donationTotals: donationResult.data ?? [],
      winnerReport: winnerReportResult.data ?? [],
    });
  } catch (error) {
    return adminRequestError(error, "Could not load the auction queue.");
  }
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) return crossOriginResponse();
  if (!(await isAdminRequest())) return unauthorized();
  const formData = await request.formData().catch(() => null);
  if (!formData) return noStoreJson({ error: "Invalid event form data." }, { status: 400 });

  const id = formValue(formData, "id").trim();
  const validation = validateAuctionInput({
    title: formValue(formData, "title"),
    description: formValue(formData, "description"),
    startingPrice: formValue(formData, "startingPrice"),
    minimumIncrement: formValue(formData, "minimumIncrement"),
    maximumDifference: formValue(formData, "maximumDifference"),
    winnerCount: formValue(formData, "winnerCount"),
    timerDurationMinutes: formValue(formData, "timerDurationMinutes"),
    currency: formValue(formData, "currency"),
  });
  if (!validation.ok) {
    return noStoreJson({ error: validation.errors.join(" ") }, { status: 400 });
  }
  const {
    title,
    description,
    starting_price: startingPrice,
    minimum_increment: minimumIncrement,
    maximum_bid_difference: maximumDifference,
    winner_count: winnerCount,
    timer_duration_seconds: timerDurationSeconds,
    currency,
  } = validation.value;
  const imageEntry = formData.get("image");
  const imageFile = imageEntry instanceof File && imageEntry.size > 0 ? imageEntry : null;

  if (imageFile && imageFile.size > PRODUCT_IMAGE_MAX_BYTES) {
    return noStoreJson({ error: "Event images must not exceed 4 MB." }, { status: 413 });
  }

  let imageUpload: { bytes: Uint8Array; extension: "png" | "jpg" } | null = null;
  if (imageFile) {
    const bytes = new Uint8Array(await imageFile.arrayBuffer());
    const extension = productImageExtension(imageFile.type, bytes);
    if (!extension) {
      return noStoreJson({ error: "Event images must be valid PNG or JPEG files." }, { status: 400 });
    }
    imageUpload = { bytes, extension };
  }

  let uploadedPath: string | null = null;
  try {
    const client = getSupabaseAdminClient();
    const auctionId = id || crypto.randomUUID();
    let previousImageUrl: string | null = null;
    let existingStatus: "upcoming" | "active" | "ended" | null = null;
    if (id) {
      const { data: existingAuction, error: existingAuctionError } = await client
        .from("auctions")
        .select("title,description,image_url,status,starting_price,minimum_increment,maximum_bid_difference,winner_count,timer_duration_seconds,currency")
        .eq("id", id)
        .single();
      if (existingAuctionError) throw existingAuctionError;
      previousImageUrl = existingAuction.image_url;
      existingStatus = existingAuction.status;
      if (
        existingStatus === "active" &&
        (
          existingAuction.title !== title ||
          existingAuction.description !== description ||
          imageFile !== null
        )
      ) {
        return noStoreJson({
          error: "Name, description, and image cannot change while an event is live.",
        }, { status: 409 });
      }
      if (
        existingStatus !== "upcoming" &&
        (
          Number(existingAuction.starting_price) !== startingPrice ||
          Number(existingAuction.minimum_increment) !== minimumIncrement ||
          (existingAuction.maximum_bid_difference == null
            ? maximumDifference !== null
            : Number(existingAuction.maximum_bid_difference) !== maximumDifference) ||
          Number(existingAuction.winner_count) !== winnerCount ||
          Number(existingAuction.timer_duration_seconds) !== timerDurationSeconds ||
          existingAuction.currency !== currency
        )
      ) {
        return noStoreJson({
          error: "Pricing, winner, currency, and timer rules cannot change after an event starts.",
        }, { status: 409 });
      }
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

    const contentValues = {
      title,
      description,
      image_url: imageUrl,
    };
    const ruleValues = {
      starting_price: startingPrice,
      minimum_increment: minimumIncrement,
      maximum_bid_difference: maximumDifference,
      winner_count: winnerCount,
      timer_duration_seconds: timerDurationSeconds,
      currency,
    };
    const values = existingStatus && existingStatus !== "upcoming"
      ? contentValues
      : { ...contentValues, ...ruleValues };
    const query = id
      ? client.from("auctions").update(values).eq("id", id).select("*").single()
      : client.from("auctions").insert({ id: auctionId, ...values, status: "upcoming" }).select("*").single();
    const { data, error } = await query;
    if (error) throw error;

    if (uploadedPath && previousImageUrl) {
      await removeProductImageIfUnused(client, previousImageUrl);
    }
    return noStoreJson({ auction: data });
  } catch (error) {
    if (uploadedPath) {
      const client = getSupabaseAdminClient();
      await removeProductImage(client, uploadedPath);
    }
    return adminRequestError(error, "Could not save the event.");
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return crossOriginResponse();
  if (!(await isAdminRequest())) return unauthorized();
  const body = (await request.json().catch(() => null)) as {
    id?: string;
    action?: "start" | "end" | "move_up" | "move_down" | "duplicate" | "payment";
    participantId?: string;
    paymentStatus?: "pending" | "paid" | "waived";
  } | null;
  if (
    !body?.id ||
    !["start", "end", "move_up", "move_down", "duplicate", "payment"].includes(body.action ?? "")
  ) {
    return noStoreJson({ error: "A valid auction action is required." }, { status: 400 });
  }

  try {
    const client = getSupabaseAdminClient();
    if (body.action === "start") {
      const { error: activationError } = await client.rpc("activate_auction", {
        p_auction_id: body.id,
      });
      if (activationError) throw activationError;
    } else if (body.action === "end") {
      const { error: endError } = await client.rpc("end_auction", {
        p_auction_id: body.id,
      });
      if (endError) throw endError;
    } else if (body.action === "move_up" || body.action === "move_down") {
      const { error: reorderError } = await client.rpc("reorder_auction", {
        p_auction_id: body.id,
        p_direction: body.action === "move_up" ? -1 : 1,
      });
      if (reorderError) throw reorderError;
      const { data: auctions, error: queueError } = await client
        .from("auctions")
        .select("*")
        .order("sort_order", { ascending: true });
      if (queueError) throw queueError;
      return noStoreJson({
        auction: auctions.find((item) => item.id === body.id) ?? null,
        auctions,
      });
    } else if (body.action === "duplicate") {
      const { data, error: duplicateError } = await client.rpc("duplicate_auction", {
        p_auction_id: body.id,
      });
      if (duplicateError) throw duplicateError;
      return noStoreJson({ auction: data?.[0] ?? null });
    } else {
      if (
        !body.participantId ||
        !body.paymentStatus ||
        !["pending", "paid", "waived"].includes(body.paymentStatus)
      ) {
        return noStoreJson({ error: "A valid winner payment update is required." }, { status: 400 });
      }
      const { error: paymentError } = await client.rpc("set_auction_winner_payment", {
        p_auction_id: body.id,
        p_participant_id: body.participantId,
        p_payment_status: body.paymentStatus,
      });
      if (paymentError) throw paymentError;
      return noStoreJson({ ok: true });
    }
    const { data, error } = await client
      .from("auctions")
      .select("*")
      .eq("id", body.id)
      .single();
    if (error) throw error;
    return noStoreJson({ auction: data });
  } catch (error) {
    return adminRequestError(error, "Could not update the auction event.", 409);
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return crossOriginResponse();
  if (!(await isAdminRequest())) return unauthorized();
  const body = (await request.json().catch(() => null)) as { id?: string } | null;
  if (!body?.id) {
    return noStoreJson({ error: "An auction event is required." }, { status: 400 });
  }

  try {
    const client = getSupabaseAdminClient();
    const { data: existing, error: existingError } = await client
      .from("auctions")
      .select("image_url")
      .eq("id", body.id)
      .single();
    if (existingError) throw existingError;

    const { error: deleteError } = await client.rpc("delete_upcoming_auction", {
      p_auction_id: body.id,
    });
    if (deleteError) throw deleteError;

    await removeProductImageIfUnused(client, existing.image_url);

    return noStoreJson({ ok: true });
  } catch (error) {
    return adminRequestError(error, "Could not delete the auction event.", 409);
  }
}
