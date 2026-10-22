import { performance } from "node:perf_hooks";

import { createClient } from "@supabase/supabase-js";

if (process.argv.includes("--help")) {
  console.log(`Usage: npm run loadtest:auction

Required environment variables:
  LOAD_TEST_CONFIRM=staging-only
  LOAD_TEST_SUPABASE_URL=https://<staging-project>.supabase.co
  LOAD_TEST_PUBLISHABLE_KEY=<staging publishable key>
  LOAD_TEST_SERVICE_ROLE_KEY=<staging service role key>

Optional:
  LOAD_TEST_USERS=300
  LOAD_TEST_BID_ROUNDS=3
  LOAD_TEST_ROUND_INTERVAL_MS=1000`);
  process.exit(0);
}

const confirmation = process.env.LOAD_TEST_CONFIRM;
const url = process.env.LOAD_TEST_SUPABASE_URL;
const publishableKey = process.env.LOAD_TEST_PUBLISHABLE_KEY;
const serviceRoleKey = process.env.LOAD_TEST_SERVICE_ROLE_KEY;
const userCount = Number(process.env.LOAD_TEST_USERS ?? 300);
const bidRounds = Number(process.env.LOAD_TEST_BID_ROUNDS ?? 3);
const roundIntervalMs = Number(process.env.LOAD_TEST_ROUND_INTERVAL_MS ?? 1000);

if (confirmation !== "staging-only") {
  throw new Error("Refusing to run: set LOAD_TEST_CONFIRM=staging-only for a disposable staging project.");
}
if (!url || !publishableKey || !serviceRoleKey) {
  throw new Error("Missing staging Supabase URL, publishable key, or service-role key.");
}
if (!Number.isInteger(userCount) || userCount < 2 || userCount > 500) {
  throw new Error("LOAD_TEST_USERS must be an integer between 2 and 500.");
}
if (!Number.isInteger(bidRounds) || bidRounds < 1 || bidRounds > 20) {
  throw new Error("LOAD_TEST_BID_ROUNDS must be an integer between 1 and 20.");
}

const service = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const runId = `${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
const participants = [];
let auctionId = null;
let bidMessages = 0;
let participantMessages = 0;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function percentile(values, fraction) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

async function subscribe(client, index) {
  const channel = client
    .channel(`load-test:${runId}:${index}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "bids", filter: `auction_id=eq.${auctionId}` },
      () => { bidMessages += 1; },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "participants", filter: `auction_id=eq.${auctionId}` },
      () => { participantMessages += 1; },
    );

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Realtime subscribe timeout for user ${index}.`)), 15_000);
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve();
      }
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        clearTimeout(timeout);
        reject(new Error(`Realtime subscribe failed for user ${index}: ${status}.`));
      }
    });
  });
  return channel;
}

async function createParticipant(index) {
  const client = createClient(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const startedAt = performance.now();
  const { data: authData, error: authError } = await client.auth.signInAnonymously();
  if (authError || !authData.user) throw authError ?? new Error(`No user returned for ${index}.`);
  const entry = {
    client,
    channel: null,
    userId: authData.user.id,
    registrationMs: 0,
  };
  participants.push(entry);

  const { error: joinError } = await client.rpc("join_auction_with_contact", {
    p_auction_id: auctionId,
    p_username: `Load Test ${runId} ${String(index).padStart(3, "0")}`,
    p_email: `load-${runId}-${index}@example.invalid`,
  });
  if (joinError) throw joinError;
  entry.channel = await subscribe(client, index);
  entry.registrationMs = performance.now() - startedAt;
  return entry;
}

async function cleanUp() {
  await Promise.allSettled(participants.map(({ client }) => client.removeAllChannels()));

  if (auctionId) {
    const { error } = await service.from("auctions").delete().eq("id", auctionId);
    if (error) console.error("Could not delete the load-test auction:", error.message);
  }

  for (let offset = 0; offset < participants.length; offset += 10) {
    const batch = participants.slice(offset, offset + 10);
    await Promise.allSettled(batch.map(({ userId }) => service.auth.admin.deleteUser(userId)));
  }
}

try {
  const { data: createdAuction, error: createError } = await service
    .from("auctions")
    .insert({
      title: `[LOAD TEST] ${runId}`,
      description: "Disposable automated concurrency test.",
      starting_price: 0,
      minimum_increment: 1,
      maximum_bid_difference: null,
      winner_count: 1,
      timer_duration_seconds: 120,
      currency: "EUR",
      status: "upcoming",
    })
    .select("id, starting_price, minimum_increment")
    .single();
  if (createError) throw createError;
  auctionId = createdAuction.id;

  console.log(`Registering and connecting ${userCount} users against ${url} ...`);
  const registrationStartedAt = performance.now();
  await Promise.all(
    Array.from({ length: userCount }, (_, index) => createParticipant(index + 1)),
  );
  const registrationDurationMs = performance.now() - registrationStartedAt;
  const registrationLatencies = participants.map(({ registrationMs }) => registrationMs);

  const { data: activatedRows, error: activationError } = await service.rpc("activate_auction", {
    p_auction_id: auctionId,
  });
  if (activationError) throw activationError;
  const startsAt = new Date(activatedRows?.[0]?.starts_at ?? Date.now()).getTime();
  await wait(Math.max(0, startsAt - Date.now()) + 150);

  const bidLatencies = [];
  let acceptedBids = 0;
  for (let round = 1; round <= bidRounds; round += 1) {
    const { data: highestRows, error: highestError } = await service
      .from("bids")
      .select("amount")
      .eq("auction_id", auctionId)
      .order("amount", { ascending: false })
      .limit(1);
    if (highestError) throw highestError;
    const amount = Number(highestRows?.[0]?.amount ?? createdAuction.starting_price)
      + Number(createdAuction.minimum_increment);

    const results = await Promise.all(participants.map(async ({ client }) => {
      const startedAt = performance.now();
      const result = await client.rpc("place_bid", { p_auction_id: auctionId, p_amount: amount });
      bidLatencies.push(performance.now() - startedAt);
      return result;
    }));
    const acceptedThisRound = results.filter(({ error }) => !error).length;
    if (acceptedThisRound !== 1) {
      throw new Error(`Expected exactly one accepted bid in round ${round}, received ${acceptedThisRound}.`);
    }
    acceptedBids += acceptedThisRound;
    await wait(roundIntervalMs);
  }

  const expectedBidMessages = userCount * acceptedBids;
  const deliveryDeadline = Date.now() + 15_000;
  while (bidMessages < expectedBidMessages && Date.now() < deliveryDeadline) await wait(100);

  const deliveryRatio = expectedBidMessages ? bidMessages / expectedBidMessages : 1;
  const report = {
    users: userCount,
    bidRounds,
    registrationDurationMs: Math.round(registrationDurationMs),
    registrationP50Ms: Math.round(percentile(registrationLatencies, 0.5)),
    registrationP95Ms: Math.round(percentile(registrationLatencies, 0.95)),
    registrationP99Ms: Math.round(percentile(registrationLatencies, 0.99)),
    bidP50Ms: Math.round(percentile(bidLatencies, 0.5)),
    bidP95Ms: Math.round(percentile(bidLatencies, 0.95)),
    bidP99Ms: Math.round(percentile(bidLatencies, 0.99)),
    acceptedBids,
    bidMessages,
    participantMessages,
    realtimeDeliveryPercent: Number((deliveryRatio * 100).toFixed(2)),
  };
  console.log(JSON.stringify(report, null, 2));

  if (deliveryRatio < 0.99) {
    throw new Error(`Realtime delivery was ${(deliveryRatio * 100).toFixed(2)}%; expected at least 99%.`);
  }
} finally {
  console.log("Cleaning up disposable load-test data ...");
  await cleanUp();
}
