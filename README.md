# RBAuctionTool

A responsive live-auction application built with Next.js, TypeScript, Tailwind CSS, Supabase PostgreSQL/Auth/Realtime, and Netlify. Participants join with an unverified display name, submit bids through an atomic database function, and receive accepted bids over a Supabase Realtime channel. A separate server-protected page manages an ordered queue of auction products.

## What is included

- Anonymous participant sessions persisted across every product lot by the Supabase browser client
- Duplicate display-name prevention per product lot
- Realtime bid history, highest bid, leading participant, and connection state
- Atomic bid acceptance that locks the auction, derives participant identity from `auth.uid()`, enforces status/time/minimum increment, and timestamps accepted bids in PostgreSQL
- Row Level Security with no browser access to insert bids or change auction settings
- Protected `/admin` page for creating/editing, starting, and ending an auction, uploading product images, configuring how many distinct highest bidders win, and viewing ranked bid history
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

When no Supabase environment variables are configured, the app automatically starts in local demo mode. It includes a live sample lot, participants, bids, working bid submission, and an editable administration page. Demo changes are stored in the browser and can be reset from either page.

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

The migration grants public read access only to auction display data, public participant fields, and accepted bids. Browser roles cannot insert/update/delete those tables directly. `join_auction`, `get_my_participant`, `get_my_auction_identity`, and `place_bid` are the only participant RPCs, and they are available only to authenticated users. After joining once, the browser reuses the verified anonymous session and display name to enter each following product lot automatically.

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
2. Enter the value configured as `ADMIN_SECRET`. A secure, HTTP-only, same-site cookie is issued for eight hours.
3. Enter the product name, description, optional PNG/JPEG image (up to 4 MB), starting price, minimum increment, number of winning bidders, and three-letter currency code, then add the product to the queue. Repeat this for every product. The server creates a public `product-images` Supabase Storage bucket on the first upload; browser clients never receive the server key or direct upload permission. Winner places are assigned to the highest bids from distinct participants, so one participant cannot occupy multiple winner places.
4. Select a queued product and choose **Start this product** when bidding should open. Starting it atomically ends any previous active lot. Choose **End bidding** to close it. These actions are checked again by the server route; hiding or showing the controls is not the authorization boundary.

The first acceptable bid is `starting price + minimum increment`. Every later bid must be at least `current highest bid + minimum increment`.

## Test two participants

1. Start the auction from `/admin`.
2. Open `/` in a normal browser window and join with one display name.
3. Open `/` in a private/incognito window and join with a different display name. A separate browser profile is needed because an anonymous Auth session can have only one participant identity per auction.
4. Place a valid bid in one window. The other window should update without a refresh and show the new amount, participant, and server timestamp.
5. Try the same display name in another window, a value below the shown minimum, rapid double-clicks, and a bid after ending the auction. Each should be rejected or deduplicated safely.

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

Anonymous Auth binds actions to a browser session, but a participant can clear storage or use another browser to obtain another identity. Display names remain unverified. The admin secret is a shared credential; rotate it if exposed and replace it with individual administrator accounts and role claims for multi-admin use. The service-role key is confined to server routes, but those routes should receive platform-level rate limiting before public launch.

The app manages an ordered product queue with exactly one active lot at a time. Supporting simultaneous auction rooms requires auction-specific routes and room selection. Automatic scheduled transitions are not included; start/end are admin actions, while the bid function still enforces any configured time bounds. Money uses two-decimal `numeric` values and a configurable ISO currency code; it does not handle currencies with unusual minor units.
