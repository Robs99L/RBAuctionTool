# RBAuctionTool

A responsive live-auction application built with Next.js, TypeScript, Tailwind CSS, Supabase PostgreSQL/Auth/Realtime, and Netlify. Participants join with their name and email address, submit bids through an atomic database function, and receive accepted bids over a Supabase Realtime channel. A separate server-protected page manages an ordered queue of auction products and shows the donation total from the winning bids per product.

## What is included

- Anonymous participant sessions persisted across every product lot by the Supabase browser client
- Duplicate display-name prevention per product lot
- Realtime bid history, highest bid, leading participant, and connection state
- Incremental Realtime updates without per-event dashboard refetches, plus a single consistent reconnect snapshot
- Optional database-side batching of public bid/name notifications into a private Broadcast once per second, with automatic connection recovery
- Database-ranked leaderboard with one best bid per participant, personal rank, and final winner state
- A synchronized 15-second public start countdown using a shared application-server clock, followed by a configurable visual auction timer that remains display-only; closing stays a manual administrator action
- Atomic bid acceptance that locks the auction, derives participant identity from `auth.uid()`, enforces status/time and positive two-decimal amounts, and stores every accepted bid in PostgreSQL
- Row Level Security with no browser access to insert bids or change auction settings
- Protected `/admin` page for creating/editing, starting, and ending an auction, uploading automatically optimized product images, configuring how many distinct highest bidders win, and viewing ranked bid history
- Downloadable Excel event template with validated, all-or-nothing queue import for up to 500 events
- Queue reordering, safe duplication/deletion, explicit start/end confirmations, incremental Realtime admin updates with a polling fallback, and an append-only change audit
- Finalized-winner CSV export with private contacts and winning amounts
- Ordered product queue with one active lot and separate participants and bids for every product
- Setup, loading, empty, error, reconnection, upcoming, active, and ended states
- Responsive participant and administrator interfaces
- Public `/presentation` screen, opened from administration in a new tab, with fullscreen support, the current event, synchronized timer, and a fixed leaderboard showing the top 10 or all winning places when there are more than 10

## Local setup

Requirements: Node.js 22+ and npm. Supabase is optional for the local demo.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Administration is at `http://localhost:3000/admin`.

For a shared room display, choose **Presentation view** in the admin header and select **Fullscreen** in the new tab. The screen follows event changes automatically and displays public participant names and highest bids without requiring registration. It always shows the top 10, or up to the configured number of winners when that exceeds 10, with no automatic page changes. Large lists scroll within the desktop leaderboard. Event images retain their full 16:9 slide format across all three views; the login artwork uses its original responsive layout. A periodic refresh also recovers missed event changes and bids. The shared local demo synchronizes with other tabs in the same browser.

For a standalone presentation preview with 12 sample bidders, open `/presentation?demo=true` in development. Add `&winners=12` to preview 12 winning places. This preview is independent of the shared demo and live auction, makes no Supabase requests, and is disabled in production.

In development, missing Supabase environment variables automatically enable local demo mode. It includes a live sample lot, participants, bids, working bid submission, and an editable administration page. Demo changes are stored in the browser and can be reset from either page. Production fails closed with a configuration screen unless `NEXT_PUBLIC_DEMO_MODE=true` is set intentionally.

Set `NEXT_PUBLIC_DEMO_MODE=true` to force the local demo while keeping Supabase credentials in `.env.local`.

To connect Supabase later, copy `.env.example` to `.env.local` (`Copy-Item .env.example .env.local` in PowerShell), fill in the project values, and restart the development server.

## Supabase setup

1. Create or select a Supabase project.
2. In **Authentication → Providers → Anonymous**, enable anonymous sign-ins. This is required: a participant's database record is bound to an anonymous Auth user, rather than trusting a participant ID sent by the browser.
3. Apply all files in [`supabase/migrations`](supabase/migrations) in filename order.
4. Optionally apply [`supabase/seed.sql`](supabase/seed.sql) to create the preview auction. Otherwise, configure the environment and create the first lot at `/admin`.

With the Supabase CLI linked to the project:

```bash
supabase db push
supabase db seed  # optional preview data
```

Alternatively, paste each migration into **SQL Editor** and run them in filename order. The migrations create the tables, queue order, constraints, RLS policies, RPC functions, grants, indexes, and Realtime publication entries. No additional Realtime policy step is required. In **Database → Pipelines**, verify `auctions`, `bids`, and `participants` appear in the `supabase_realtime` publication.

The migrations grant public read access only to auction display data, participant names, accepted bids, and the controlled leaderboard RPC. Email addresses, login throttling records, audit entries, and payment reconciliation live in the private schema. Browser roles cannot insert/update/delete auction data directly. `join_auction_with_contact`, `get_my_participant_with_contact`, `get_my_auction_identity_with_contact`, and `place_bid` are the participant RPCs used by the current client, and they are available only to authenticated users. After joining once, the browser reuses the verified anonymous session, name, and email to enter each following product lot automatically.

## Environment variables

Copy `.env.example` to `.env.local` and set:

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-safe | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe | Supabase publishable key (the legacy anon key also works) |
| `NEXT_PUBLIC_BATCHED_REALTIME` | Browser-safe | `true` enables private Broadcast batches after the migration and Cron checks; default `false` retains Postgres Changes |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Allows the protected admin API to manage auctions |
| `ADMIN_SECRET` | Server only | Administrator login secret; use at least 16 random characters |

Never prefix the service-role key or administrator secret with `NEXT_PUBLIC_`. Do not commit `.env.local`; secret-bearing `.env*` files are ignored.

## Create and run the product queue

1. Start the app and visit `/admin`.
2. Enter the value configured as `ADMIN_SECRET`. A randomized, signed, HTTP-only, same-site cookie is issued for eight hours. Five failed attempts from one address trigger a 15-minute database-backed block.
3. Enter the product name, description, optional PNG/JPEG image (up to 4 MB), reference starting price, number of winning bidders, and three-letter currency code, then add the product to the queue. Repeat this for every product. The server creates a public `product-images` Supabase Storage bucket on the first upload; browser clients never receive the server key or direct upload permission. Winner places are assigned to the highest bids from distinct participants, so one participant cannot occupy multiple winner places.
4. For bulk entry, choose **Download Excel template**, fill the `Events` sheet, and upload it with **Import Excel**. The columns cover the same event rules as the manual form plus an optional public HTTPS image URL. Blank rule cells use the form defaults. Rows are appended to the queue in spreadsheet order and always start as `upcoming`. The file is fully validated first, so one invalid row prevents the entire import instead of creating a partial queue.
5. Reorder or duplicate upcoming products as needed. Deletion is allowed only while a product is upcoming and has no registrations or bids.
6. Select a queued product and choose **Start this event** when bidding should open. Starting it atomically ends any previous active lot and shows everyone a synchronized 15-second countdown; bids are accepted only after it reaches zero. Choose **End bidding** to close it. Both actions require confirmation. While bidding is live, every event setting is read-only. Pricing, currency, winner count, and timer rules remain immutable after the event ends; descriptive content can then be corrected again.
7. For ended products, review the finalized winners and download the CSV report from **Export winners**.

The admin product cards and bid history show a donation total calculated in PostgreSQL. It sums the highest bid from each participant currently occupying a winning place. Ended events use their persisted winning amounts. Earlier increases by the same participant are not counted again. Participant emails are visible only in the protected admin bid history.

Every positive amount with at most two decimals, up to the database limit of `9,999,999,999.99`, is accepted while bidding is open. Bids may be below the starting price, below or equal to the current highest bid, or below a participant's previous bid. Every accepted submission is a separate database record. Each participant's highest accepted bid determines their rank; a lower follow-up does not withdraw or reduce an earlier bid. Ties use the earlier bid timestamp, then the bid ID. Identical bids from different participants are all accepted. The 300-millisecond per-participant repeat-submission protection remains in place.

Apply [`20261112081938_allow_any_positive_bid.sql`](supabase/migrations/20261112081938_allow_any_positive_bid.sql) to enable this rule in an existing database before deploying the updated client. Existing `minimum_increment` and `maximum_bid_difference` settings and Excel columns remain compatible with old records and templates, but no longer restrict bid amounts. They are hidden in the admin form; leave the corresponding optional Excel cells blank.
The public start countdown and the following auction timer both use the product's server-recorded start time. Every view calibrates against the same application-server time through `/api/auction-clock`, accounts for half the measured round trip, and advances with the browser's monotonic clock. Calibration repeats once per minute and on reconnect or visibility restoration, so incorrect device clocks do not shift the countdown. Bid entry waits for the first successful calibration. Reaching `00:00` on the auction timer does not reject bids or end the product; bidding remains active until an administrator chooses **End bidding**. PostgreSQL remains authoritative for accepting bids.

After an event ends, its final leaderboard remains publicly visible without requiring registration. The recent activity feed stays limited to 30 bids, while rank and winner status come from the complete database leaderboard.

When a page comes back online, becomes visible again, or rejoins the event queue channel, it reloads the queue before refreshing the current event. All public views reconcile every 15 seconds while visible, or every 10 seconds during recovery. Concurrent queue and dashboard requests are combined; newer Realtime changes are replayed over responses captured before those changes. At event end, the public views fetch a fresh final snapshot. A public view reports **Live** only after both necessary channels and its dashboard snapshot are ready; bid entry is disabled while it synchronizes.

All views process Realtime notifications in fixed 16-millisecond display windows. A burst is deduplicated and ranked as a group per window; continuous traffic never postpones the display deadline. New accepted bids remain visible while a snapshot request is pending, and notifications received during that request are replayed over its response. Administration uses the same complete public dashboard leaderboard for winning places and live donation totals. Its visible history stays limited to the latest 500 accepted bids, matching the existing database RPC; older winning bids remain part of the complete rankings and totals. Private contact details and finalized reports still come only from protected API reads, coalesced over one second. Initial same-event loads are deduplicated. Background reads do not overlap: updates arriving during a request schedule one follow-up. Rejoining, returning online, visibility restoration, and a 15-second fallback also refresh administration. The administrator's selected event, unsaved form edits and new-event form are preserved. Repeated currency/time formatting reuses formatters, and unchanged administration bid rows do not rerender.

### Batched live transport

The implementation is prepared and locally verified; it has not been activated in the existing hosted project. Apply [`20261112092653_batch_auction_broadcast.sql`](supabase/migrations/20261112092653_batch_auction_broadcast.sql) after all preceding migrations, including the any-positive-bid rule. It creates a private transactional outbox and the `auction-live-batches` Cron job. Once per second the job sends up to 1,000 public bid/name records together to the receive-only private topic `auction-live`. Failed database message inserts retain the queue for retry; overflow is delivered on later ticks. Every bid remains a separate database record. Event starts, ends and queue changes retain their low-volume Postgres Changes channel. Snapshots still recover notifications missed after a successful send.

Verify the job, private channel authorization and actual delivery on staging using [`LIVE_AUCTION_RUNBOOK.md`](LIVE_AUCTION_RUNBOOK.md), then set `NEXT_PUBLIC_BATCHED_REALTIME=true` and rebuild/redeploy. Next.js embeds this switch into the browser bundle at build time. Until then, the existing transport stays enabled. Returning the switch to `false` and rebuilding restores it without changing bid data.

All views automatically obtain or reuse an anonymous Auth session to receive the private stream, including presentation and administration. This creates no participant registration and sends no private contact data. Configure the relevant Auth limits for guests sharing one public venue IP. Connection setup failures retry automatically with increasing delays; the SDK handles established channel reconnects.

A participant sees their accepted RPC receipt immediately; other views normally update on the next one-second tick plus network/render latency. More than 1,000 queued records, failed sends or service overload increase that delay. The publisher limit is a notification limit, not a proven database bid-throughput guarantee. With 300 connected views and one batch per second, the bid/name stream produces about 300 WebSocket deliveries per second instead of one delivery per bid per view. Lifecycle traffic, connections, payload size, database work and hosting usage still count toward service limits. Bid RPCs and the Cron publisher run directly in Supabase; they do not require a Netlify function per bid.

The browser fixture check in `scripts/qa-realtime-bursts.mjs` runs against an isolated local production server and a headless Chromium debugging endpoint (`QA_ORIGIN` and `QA_DEBUG_ORIGIN`, default ports 3001 and 9228). It intercepts all Supabase traffic and administration API requests and writes results to `qa/realtime-burst-results.json`. For a build with batching enabled, set `QA_BATCHED_REALTIME=true`; `QA_RESULT_NAME` allows a separate result filename. This tests delivered-message processing and view convergence, without placing real bids or measuring hosted service capacity.

Realtime delivers updates with normal network latency; simultaneous rendering in the same millisecond on independent devices is not guaranteed. Periodic reconciliation repairs silently missed notifications when network requests succeed. Neither a disconnected device nor an overloaded service can be guaranteed to display the latest state until connectivity recovers.

## Test two participants

1. Start the auction from `/admin`.
2. Open `/` in a normal browser window and join with one name and email address.
3. Open `/` in a private/incognito window and join with a different name and email address. A separate browser profile is needed because an anonymous Auth session can have only one participant identity per auction.
4. Place a valid bid in one window. The other window should update without a refresh and show the new amount, participant, and server timestamp.
5. Submit a lower bid and the same amount from both participants. All should be saved, with consistent rankings in the bidder, admin and presentation views. Verify that a lower follow-up leaves the previous personal best in place. Then try an invalid amount, duplicate registration name, rapid double-clicks, and a bid after ending the auction; those should be rejected or deduplicated safely.

The auction row is locked inside `place_bid`, so acceptance is serialized with event finalization and repeat submissions. Competing participants do not invalidate each other's bid amounts.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run loadtest:auction -- --help
```

The tests cover currency parsing, live rankings, winner selection, database acceptance and batch recovery. The database tests apply all migrations to isolated PGlite PostgreSQL through `test-auction-database.ts`. Managed Supabase Auth, Realtime and Cron services are adapted, and unsupported pgcrypto/pg_cron extension declarations are omitted; application functions, triggers and RLS execute as real PostgreSQL. They verify persistence of low and equal bids, invalid amounts, permissions, registration, repeat protection, event boundaries, 300 bids in one public-only batch, overflow and silent send failures. Real multi-connection contention, Cron scheduling and hosted Realtime delivery still require a disposable Supabase staging project.

For the 300-participant rehearsal, production settings, acceptance criteria, and incident procedure, follow [`LIVE_AUCTION_RUNBOOK.md`](LIVE_AUCTION_RUNBOOK.md).

## Netlify deployment

The repository includes [`netlify.toml`](netlify.toml) with `npm run build`, Node.js 22, and the official Netlify Next.js runtime.

In **Netlify → Site configuration → Environment variables**, configure the four required connection/admin variables above for the Production context (and Deploy Previews if needed). Set the optional batching switch only after database verification. Trigger a new deploy after changing environment variables. The application uses the hosted Supabase project in production and has no dependency on a local server or local database.

For Supabase Auth, add the final Netlify domain under **Authentication → URL Configuration**. Anonymous sign-in itself does not redirect, but setting the project site URL now avoids surprises if other providers are added later.

## Security and production limitations

This is an MVP, not a real-money auction platform. Before accepting valuable or regulated bids, add verified user accounts, legal terms and consent, abuse/rate limiting, bot protection, audit-log retention, administrator roles with MFA, monitoring and alerting, backups/recovery tests, and integration tests against a staging database. Add an explicit confirmation step and auction-specific bid/cancellation rules where required by law.

Anonymous Auth binds actions to a browser session, but a participant can clear storage or use another browser to obtain another identity. Names and email addresses are self-reported and are not verified. The admin secret is a shared credential; rotate it if exposed and replace it with individual administrator accounts and role claims for multi-admin use. The service-role key is confined to server routes, but those routes should receive platform-level rate limiting before public launch.

The app manages an ordered product queue with exactly one active lot at a time. Supporting simultaneous auction rooms requires auction-specific routes and room selection. Automatic scheduled transitions are not included; start/end are admin actions, while the bid function still enforces any configured time bounds. Money uses two-decimal `numeric` values and a configurable ISO currency code; it does not handle currencies with unusual minor units.
