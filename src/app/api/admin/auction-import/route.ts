import {
  AUCTION_IMPORT_MAX_BYTES,
  createAuctionImportTemplate,
  parseAuctionImport,
} from "@/lib/auction-excel";
import {
  crossOriginResponse,
  isSameOriginRequest,
  noStoreJson,
  publicAdminError,
} from "@/lib/admin-api";
import { isAdminRequest } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

export const runtime = "nodejs";

function unauthorized() {
  return noStoreJson({ error: "Administrator authorization required." }, { status: 401 });
}

export async function GET() {
  if (!(await isAdminRequest())) return unauthorized();

  try {
    const buffer = await createAuctionImportTemplate();
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": 'attachment; filename="Event-Import-Vorlage.xlsx"',
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Event import template generation failed.", error);
    return noStoreJson({ error: "Could not create the Excel template." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return crossOriginResponse();
  if (!(await isAdminRequest())) return unauthorized();

  const formData = await request.formData().catch(() => null);
  const entry = formData?.get("file");
  if (!(entry instanceof File) || entry.size === 0) {
    return noStoreJson({ error: "Select an .xlsx event file." }, { status: 400 });
  }
  if (!entry.name.toLowerCase().endsWith(".xlsx")) {
    return noStoreJson({ error: "Only .xlsx Excel files can be imported." }, { status: 400 });
  }
  if (entry.size > AUCTION_IMPORT_MAX_BYTES) {
    return noStoreJson({ error: "The Excel file must not exceed 2 MB." }, { status: 413 });
  }

  const parsed = await parseAuctionImport(new Uint8Array(await entry.arrayBuffer()));
  if (!parsed.ok) {
    return noStoreJson(
      { error: parsed.error, rowErrors: parsed.rowErrors ?? [] },
      { status: 422 },
    );
  }

  try {
    const { data, error } = await getSupabaseAdminClient()
      .from("auctions")
      .insert(parsed.auctions)
      .select("*");
    if (error) throw error;

    return noStoreJson({
      imported: data?.length ?? parsed.auctions.length,
      auctions: data ?? [],
    });
  } catch (error) {
    console.error("Event Excel import failed.", error);
    return noStoreJson(
      { error: publicAdminError(error, "Could not import the events.") },
      { status: 500 },
    );
  }
}
