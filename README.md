# RBAuctionTool

A responsive live-auction application built with Next.js, TypeScript, Tailwind CSS, Supabase PostgreSQL/Auth/Realtime, and Netlify. Participants join with an unverified display name, submit bids through an atomic database function, and receive accepted bids over a Supabase Realtime channel. A separate server-protected page manages the current lot.

## What is included

- Anonymous participant sessions persisted by the Supabase browser client
- Duplicate display-name prevention per auction
- Realtime bid history, highest bid, leading participant, and connection state
- Atomic bid acceptance that locks the auction, derives participant identity from `auth.uid()`, enforces status/time/minimum increment, and timestamps accepted bids in PostgreSQL
- Row Level Security with no browser access to insert bids or change auction settings
- Protected `/admin` page for creating/editing, starting, and ending an auction and viewing bid history
- Setup, loading, empty, error, reconnection, upcoming, active, and ended states
- Responsive participant and administrator interfaces

## Local setup

Requirements: Node.js 20+, npm, and a Supabase project.

```bash
npm install
cp .env.example .env.local
npm run dev
```

On PowerShell, use `Copy-Item .env.example .env.local` instead of `cp`.

Open `http://localhost:3000`. Administration is at `http://localhost:3000/admin`.

## Supabase setup

1. Create or select a Supabase project.
2. In **Authentication → Providers → Anonymous**, enable anonymous sign-ins. This is required: a participant's database record is bound to an anonymous Auth user, rather than trusting a participant ID sent by the browser.
3. Apply [`supabase/migrations/202610140001_live_auction.sql`](supabase/migrations/202610140001_live_auction.sql).
4. Optionally apply [`supabase/seed.sql`](supabase/seed.sql) to create the preview auction. Otherwise, configure the environment and create the first lot at `/admin`.

With the Supabase CLI linked to the project:

```bash
supabase db push
supabase db seed  # optional preview data
```

Alternatively, paste the migration into **SQL Editor** and run it once. The migration creates the tables, constraints, RLS policies, RPC functions, grants, indexes, and Realtime publication entries. No additional Realtime policy step is required. In **Database → Replication**, verify `auctions`, `bids`, and `participants` appear in the `supabase_realtime` publication.

The migration grants public read access only to auction display data, public participant fields, and accepted bids. Browser roles cannot insert/update/delete those tables directly. `join_auction`, `get_my_participant`, and `place_bid` are the only participant RPCs, and they are available only to authenticated users.

## Environment variables

Copy `.env.example` to `.env.local` and set:

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser-safe | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser-safe | Supabase publishable key (the legacy anon key also works) |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Allows the protected admin API to manage auctions |
| `ADMIN_SECRET` | Server only | Administrator login secret; use at least 16 random characters |

Never prefix the service-role key or administrator secret with `NEXT_PUBLIC_`. Do not commit `.env.local`; secret-bearing `.env*` files are ignored.

## Create and run the first auction

1. Start the app and visit `/admin`.
2. Enter the value configured as `ADMIN_SECRET`. A secure, HTTP-only, same-site cookie is issued for eight hours.
3. Enter the product name, description, image URL, starting price, minimum increment, and three-letter currency code, then create the lot.
4. Select **Start auction** when bidding should open. Select **End auction** to close it. These actions are checked again by the server route; hiding or showing the controls is not the authorization boundary.

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

The repository includes [`netlify.toml`](netlify.toml) with `npm run build` and Node.js 20. Modern Netlify projects detect Next.js and install the supported Next.js runtime automatically.

In **Netlify → Site configuration → Environment variables**, configure all four variables above for the Production context (and Deploy Previews if needed). Trigger a new deploy after changing environment variables. The application uses the hosted Supabase project in production and has no dependency on a local server or local database.

For Supabase Auth, add the final Netlify domain under **Authentication → URL Configuration**. Anonymous sign-in itself does not redirect, but setting the project site URL now avoids surprises if other providers are added later.

## Security and production limitations

This is an MVP, not a real-money auction platform. Before accepting valuable or regulated bids, add verified user accounts, legal terms and consent, abuse/rate limiting, bot protection, audit-log retention, administrator roles with MFA, monitoring and alerting, backups/recovery tests, and integration tests against a staging database. Add an explicit confirmation step and auction-specific bid/cancellation rules where required by law.

Anonymous Auth binds actions to a browser session, but a participant can clear storage or use another browser to obtain another identity. Display names remain unverified. The admin secret is a shared credential; rotate it if exposed and replace it with individual administrator accounts and role claims for multi-admin use. The service-role key is confined to server routes, but those routes should receive platform-level rate limiting before public launch.

The app manages the newest auction as the current lot. Supporting simultaneous rooms requires an auction selector or auction-specific route. Automatic scheduled transitions are not included; start/end are admin actions, while the bid function still enforces any configured time bounds. Money uses two-decimal `numeric` values and a configurable ISO currency code; it does not handle currencies with unusual minor units.
