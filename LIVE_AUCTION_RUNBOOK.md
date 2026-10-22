# Live auction runbook (300 participants)

Use a separate Supabase staging project for rehearsal. Never run the automated load test against the production event.

## One-time production setup

1. Use Supabase Pro and Netlify Pro. In Supabase Pro, disable the spend cap or request adequate Realtime limits; the spend-capped Pro limit is too low for repeated fan-out to 300 clients.
2. Under **Authentication → Rate Limits**, set **Anonymous sign-ins** to at least `600` per hour. The bucket is per public IP, so this is required when all guests share the venue network.
3. Enable anonymous sign-ins. Consider CAPTCHA or an upstream venue-only access rule to offset the higher sign-in allowance.
4. Apply every migration, including `20261022075657_optimize_live_auction_scale.sql` and `20261022183551_extend_auction_start_countdown.sql`.
5. Confirm `auctions`, `bids`, and `participants` are in **Database → Pipelines → Realtime**.
6. Run Supabase Security, Performance, and Health Advisors and resolve every error-level finding.
7. Configure Production environment variables in Netlify and redeploy after changing them.

## Staging rehearsal

Prepare PowerShell environment variables for the disposable staging project:

```powershell
$env:LOAD_TEST_CONFIRM = "staging-only"
$env:LOAD_TEST_SUPABASE_URL = "https://STAGING_PROJECT.supabase.co"
$env:LOAD_TEST_PUBLISHABLE_KEY = "STAGING_PUBLISHABLE_KEY"
$env:LOAD_TEST_SERVICE_ROLE_KEY = "STAGING_SERVICE_ROLE_KEY"
$env:LOAD_TEST_USERS = "300"
$env:LOAD_TEST_BID_ROUNDS = "3"
npm run loadtest:auction
```

The test creates one disposable lot and anonymous users, establishes all Realtime connections, submits concurrent competing bids, checks that exactly one bid per round wins the database race, measures p50/p95/p99 latency, verifies at least 99% Realtime delivery, and removes the created auction and Auth users. The append-only auction audit records intentionally remain.

Acceptance criteria:

- 300/300 registrations and Realtime subscriptions succeed from one source IP.
- No Auth `429`, Data API `5xx`, Realtime disconnect, or database timeout occurs.
- Exactly one identical competing bid is accepted per round.
- Bid RPC p95 is below 1 second and p99 below 2 seconds.
- Realtime delivery is at least 99%; every reconnect converges through a fresh dashboard snapshot.
- Database CPU remains below 70% and database connections below 70% of the plan limit.

Repeat once with `LOAD_TEST_USERS=400` for operational headroom. Increase `LOAD_TEST_BID_ROUNDS` only after verifying the project's Realtime message allowance.

## Event-day checks

- Upload every product image in advance; uploads are converted to WebP and capped at 500 KB.
- Open the participant page on the venue Wi-Fi and verify registration, one test bid, live updates, and reconnect after airplane mode.
- Keep Supabase Reports open for Database, Auth, Data API, and Realtime; keep Netlify Functions logs open for administrator actions.
- Log in to `/admin` at least 15 minutes before the auction to avoid a cold operational start.
- Keep a second administrator device and the Supabase dashboard available.
- Do not deploy, migrate, edit rate limits, or rotate keys during the event.

## Incident response

- If Realtime drops, bidding remains authoritative in PostgreSQL. Clients resynchronize automatically on reconnect or when returning to the tab.
- If bids time out, pause verbally, leave the lot active, check database CPU/locks and Realtime logs, then continue only after a successful test bid.
- If the administrator UI is unavailable, do not change auction rows manually unless the operator has rehearsed the exact recovery procedure on staging.
- End the auction only after the last accepted bid is visible on the administrator device.
