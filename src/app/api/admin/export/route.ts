import { isAdminRequest } from "@/lib/admin-auth";
import { getSupabaseAdminClient } from "@/lib/supabase-admin";

function csvCell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export async function GET() {
  if (!(await isAdminRequest())) {
    return Response.json(
      { error: "Administrator authorization required." },
      { status: 401, headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    const { data, error } = await getSupabaseAdminClient().rpc("get_auction_winner_report");
    if (error) throw error;
    const columns = [
      "Event order",
      "Event",
      "Winner rank",
      "Name",
      "Email",
      "Winning amount",
      "Currency",
      "Finalized at",
      "Paid at",
    ];
    const rows = (data ?? []).map((entry: Record<string, unknown>) => [
      entry.sort_order,
      entry.title,
      entry.winner_rank,
      entry.username,
      entry.email,
      entry.winning_amount,
      entry.currency,
      entry.finalized_at,
      entry.paid_at,
    ]);
    const csv = `\uFEFF${[columns, ...rows]
      .map((row) => row.map(csvCell).join(","))
      .join("\r\n")}`;

    return new Response(csv, {
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `attachment; filename="auction-winners-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Content-Type": "text/csv; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Winner export failed.", error);
    return Response.json(
      { error: "Could not export finalized winners." },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
