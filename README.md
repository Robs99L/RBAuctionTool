# RBAuctionTool

A responsive live-auction application built with Next.js, TypeScript, Tailwind CSS, Supabase PostgreSQL/Auth/Realtime, and Netlify. Participants join with their name and email address, submit bids through an atomic database function, and receive accepted bids over a Supabase Realtime channel. A separate server-protected page manages an ordered queue of auction products and shows the donation total from every accepted bid per product.

## What is included

- Anonymous participant sessions persisted across every product lot by the Supabase browser client
- Duplicate display-name prevention per product lot
- Realtime bid history, highest bid, leading participant, and connection state
- Database-ranked leaderboard with one best bid per participant, personal rank, and final winner state
- A synchronized five-second public start countdown before bidding opens, followed by a configurable visual auction timer that remains display-only; closing stays a manual administrator action
- Atomic bid acceptance that locks the auction, derives participant identity from `auth.uid()`, enforces status/time/minimum increment, and timestamps accepted bids in PostgreSQL
- Row Level Security with no browser access to insert bids or change auction settings
- Protected `/admin` page for creating/editing, starting, and ending an auction, uploading product images, configuring how many distinct highest bidders win, and viewing ranked bid history
- Queue reordering, safe duplication/deletion, explicit start/end confirmations, Realtime admin refresh with a polling fallback, and an append-only change audit
- Finalized-winner CSV export with private contacts and winning amounts
- Ordered product queue with one active lot and separate participants and bids for every product
- Setup, loading, empty, error, reconnection, upcoming, active, and ended states
- Responsive participant and administrator interfaces

## Local setup

Requirements: Node.js 22+ and npm. Supabase is optional for the local demo.

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Administration is at `http://localhost:3000/admin`.

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
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Allows the protected admin API to manage auctions |
| `ADMIN_SECRET` | Server only | Administrator login secret; use at least 16 random characters |

Never prefix the service-role key or administrator secret with `NEXT_PUBLIC_`. Do not commit `.env.local`; secret-bearing `.env*` files are ignored.

## Create and run the product queue

1. Start the app and visit `/admin`.
2. Enter the value configured as `ADMIN_SECRET`. A randomized, signed, HTTP-only, same-site cookie is issued for eight hours. Five failed attempts from one address trigger a 15-minute database-backed block.
3. Enter the product name, description, optional PNG/JPEG image (up to 4 MB), starting price, minimum increment, optional maximum increase, number of winning bidders, and three-letter currency code, then add the product to the queue. The maximum increase limits how far one bid may jump above the current highest bid; leave it blank for no limit. Repeat this for every product. The server creates a public `product-images` Supabase Storage bucket on the first upload; browser clients never receive the server key or direct upload permission. Winner places are assigned to the highest bids from distinct participants, so one participant cannot occupy multiple winner places.
4. Reorder or duplicate upcoming products as needed. Deletion is allowed only while a product is upcoming and has no registrations or bids.
5. Select a queued product and choose **Start this product** when bidding should open. Starting it atomically ends any previous active lot and shows everyone a synchronized five-second countdown; bids are accepted only after it reaches zero. Choose **End bidding** to close it. Both actions require confirmation. While bidding is live, every event setting is read-only. Pricing, currency, winner count, and timer rules remain immutable after the event ends; descriptive content can then be corrected again.
6. For ended products, review the finalized winners and download the CSV report from **Export winners**.

The admin product cards and bid history show a donation total calculated in PostgreSQL. It is the sum of every accepted bid for that product, including repeated increases by the same participant. Participant emails are visible only in the protected admin bid history.

The first acceptable bid is `starting price + minimum increment`. Every later bid from a participant who is not leading must be at least `current highest bid + minimum increment`; the current leader may raise their own bid by one cent or more. If a maximum increase is configured, no bid may exceed `current highest bid + maximum increase` (or `starting price + maximum increase` for the first bid).
The public start countdown and the following auction timer both use the product's server-recorded start time. Reaching `00:00` on the auction timer does not reject bids or end the product; bidding remains active until an administrator chooses **End bidding**.

After an event ends, its final leaderboard remains publicly visible without requiring registration. The recent activity feed stays limited to 30 bids, while rank and winner status come from the complete database leaderboard.

## Test two participants

1. Start the auction from `/admin`.
2. Open `/` in a normal browser window and join with one name and email address.
3. Open `/` in a private/incognito window and join with a different name and email address. A separate browser profile is needed because an anonymous Auth session can have only one participant identity per auction.
4. Place a valid bid in one window. The other window should update without a refresh and show the new amount, participant, and server timestamp.
5. Try the same name in another window, a value below the shown minimum, rapid double-clicks, and a bid after ending the auction. Each should be rejected or deduplicated safely.

The auction row is locked inside `place_bid`, so two simultaneous calls are serialized. The second transaction sees the first accepted amount and must meet the newly calculated minimum.

## Checks

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

The unit tests cover currency parsing and minimum-bid calculation. The authoritative validation and concurrency boundary live in PostgreSQL and should also be exercised against a disposable Supabase project before release.

## Netlify deployment

The repository includes [`netlify.toml`](netlify.toml) with `npm run build`, Node.js 22, and the official Netlify Next.js runtime.

In **Netlify → Site configuration → Environment variables**, configure all four variables above for the Production context (and Deploy Previews if needed). Trigger a new deploy after changing environment variables. The application uses the hosted Supabase project in production and has no dependency on a local server or local database.

For Supabase Auth, add the final Netlify domain under **Authentication → URL Configuration**. Anonymous sign-in itself does not redirect, but setting the project site URL now avoids surprises if other providers are added later.

## Security and production limitations

This is an MVP, not a real-money auction platform. Before accepting valuable or regulated bids, add verified user accounts, legal terms and consent, abuse/rate limiting, bot protection, audit-log retention, administrator roles with MFA, monitoring and alerting, backups/recovery tests, and integration tests against a staging database. Add an explicit confirmation step and auction-specific bid/cancellation rules where required by law.

Anonymous Auth binds actions to a browser session, but a participant can clear storage or use another browser to obtain another identity. Names and email addresses are self-reported and are not verified. The admin secret is a shared credential; rotate it if exposed and replace it with individual administrator accounts and role claims for multi-admin use. The service-role key is confined to server routes, but those routes should receive platform-level rate limiting before public launch.

The app manages an ordered product queue with exactly one active lot at a time. Supporting simultaneous auction rooms requires auction-specific routes and room selection. Automatic scheduled transitions are not included; start/end are admin actions, while the bid function still enforces any configured time bounds. Money uses two-decimal `numeric` values and a configurable ISO currency code; it does not handle currencies with unusual minor units.
