# Live auction runbook (300 participants)

Use a separate Supabase staging project for rehearsal. Never run the automated load test against the production event.

The batch transport and rehearsal tooling are implemented locally. The hosted project has not received the new migrations, and batching remains disabled until the activation checks below succeed. Hundreds of concurrent bids have not yet been validated against hosted Supabase.

## One-time production setup

1. Use Supabase Pro. Disable the spend cap or obtain adequate project-specific Realtime limits; without a cap, additional usage can incur charges. Published defaults are 500 connections / 500 messages per second with a cap, versus 10,000 / 2,500 without one. A 300-view one-second batch stream uses about 300 deliveries per second, but starts/ends and reconnects need headroom. Verify the actual project limits. Check the database compute separately: an existing Nano instance may remain after upgrading the plan. Use at least Micro as the rehearsal starting point and size it from measured CPU, locks and RPC latency. Select the Netlify plan from actual traffic, bandwidth and function usage; this implementation does not require Netlify Pro solely because hundreds of bids arrive directly in Supabase.
2. Under **Authentication → Rate Limits**, set **Anonymous sign-ins** to at least `600` per hour per public venue IP, including presentation/admin sessions and reconnect headroom. Also inspect the sign-up/sign-in bucket used by `/auth/v1/user` and the `/auth/v1/token` refresh bucket: defaults of 30 and 150 requests per five minutes can block session checks for a room sharing one IP. Raising the anonymous limit alone does not change these buckets. Verify the effective burst capacity with the planned arrival/reload pattern; seek higher project limits or stagger entry if necessary.
3. Enable anonymous sign-ins. Consider CAPTCHA or an upstream venue-only access rule to offset the higher sign-in allowance.
4. Apply every migration in filename order, including `20261022075657_optimize_live_auction_scale.sql`, `20261022183551_extend_auction_start_countdown.sql`, `20261112081938_allow_any_positive_bid.sql` and `20261112092653_batch_auction_broadcast.sql`. A project dashboard URL or service-role API key alone cannot apply SQL migrations; use SQL Editor or an authorized CLI/database connection.
5. Confirm `auctions`, `bids`, and `participants` are in **Database → Pipelines → Realtime**.
6. Run Supabase Security, Performance, and Health Advisors and resolve every error-level finding.
7. Complete the batch activation checks below, configure Production environment variables in Netlify, set `NEXT_PUBLIC_BATCHED_REALTIME=true`, and redeploy. This flag is embedded at build time. Until the checks pass, leave it `false`.

## Batch activation checks

The migration enables `pg_cron`, queues bid/participant INSERTs in a private outbox, and schedules one private Broadcast per second with at most 1,000 records. No browser role can read the queue, execute the publisher or send messages to `auction-live`. All receiving views use an anonymous authenticated session; this is independent of participant registration.

Run these read-only checks in SQL Editor after applying the migration:

```sql
select jobid, jobname, schedule, command, active
from cron.job where jobname = 'auction-live-batches';

select status, return_message, start_time, end_time
from cron.job_run_details
where jobid in (select jobid from cron.job where jobname = 'auction-live-batches')
order by start_time desc limit 10;

select count(*) as pending_records,
       min(queued_at) as oldest_pending_record
from private.auction_live_outbox;
```

Expect one active job scheduled for `1 second`, successful executions, and a queue that drains during rehearsal. A successful Cron status alone does not prove publication: `realtime.send` can warn without throwing. The publisher checks that its message was inserted and retains the queue otherwise. Inspect Realtime logs and queue age if publication stalls. Supabase creates message partitions when WebSocket clients connect, so establish the private channel before checking actual sends.

In staging, verify that every view receives `auction_batch` on private topic `auction-live`, with protocol 1 and public fields only. No bid/participant Postgres Changes subscriptions should remain in the enabled client. Verify event changes, final winners, delayed snapshots and reconnect recovery. Run Security/Performance Advisors against the actual managed database; the local adapters do not verify managed service configuration.

Expected freshness is the next one-second publication tick plus network/render latency; a bidder's own RPC receipt is immediate. Above 1,000 queued records per tick, overflow waits for subsequent ticks. This is a publisher ceiling, not a measured bid acceptance rate. Reaching the visual auction timer's zero still does not close bidding; the administrator ends it manually. To revert the transport, set `NEXT_PUBLIC_BATCHED_REALTIME=false` and rebuild/redeploy; the database bid rules stay unchanged.

## Staging rehearsal

Prepare PowerShell environment variables for the disposable staging project:

```powershell
$env:LOAD_TEST_CONFIRM = "staging-only"
$env:LOAD_TEST_SUPABASE_URL = "https://STAGING_PROJECT.supabase.co"
$env:LOAD_TEST_PUBLISHABLE_KEY = "STAGING_PUBLISHABLE_KEY"
$env:LOAD_TEST_SERVICE_ROLE_KEY = "STAGING_SERVICE_ROLE_KEY"
$env:LOAD_TEST_USERS = "300"
$env:LOAD_TEST_BID_ROUNDS = "3"
$env:LOAD_TEST_BATCHED_REALTIME = "true"
npm run loadtest:auction
```

The test creates one disposable lot and anonymous users, establishes all Realtime connections, submits concurrent identical bids and lower follow-up bids, checks that every participant's bid is accepted each round, measures RPC p50/p95/p99 latency, verifies at least 99% Realtime delivery, and removes the created auction and Auth users. The append-only auction audit records intentionally remain. Its report separates distinct delivered bid records from received batch messages. With 300 participants and three rounds, 900 accepted bids imply 270,000 delivered bid records, carried in far fewer WebSocket batches. Exact batch count depends on arrival timing; measure it rather than assuming each round takes one tick. Omit the batching flag only when intentionally comparing the legacy raw transport, which sends approximately 270,000 individual bid messages for those rounds.

The script covers anonymous registration and bid RPCs; it does not exercise the browser's `/auth/v1/user` checks, token refresh, page assets, lifecycle subscriptions or DOM rendering. Pair it with a venue-IP browser rehearsal and project monitoring. A successful local fixture run does not establish hosted capacity.

Acceptance criteria:

- 300/300 registrations and Realtime subscriptions succeed from one source IP.
- No Auth `429`, Data API `5xx`, Realtime disconnect, or database timeout occurs.
- Every participant's identical or lower bid is accepted per round and stored separately. Rankings still use each participant's highest bid.
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
