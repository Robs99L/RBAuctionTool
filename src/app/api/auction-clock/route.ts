export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ server_time: Date.now() }, {
    headers: { "Cache-Control": "no-store, max-age=0", "CDN-Cache-Control": "no-store" },
  });
}
