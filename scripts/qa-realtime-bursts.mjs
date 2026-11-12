// Read-only browser fixtures. All Supabase traffic and admin APIs are intercepted.
// Start an isolated build and headless Chromium with remote debugging before running.
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";

const origin = process.env.QA_ORIGIN || "http://localhost:3001";
const debugOrigin = process.env.QA_DEBUG_ORIGIN || "http://localhost:9228";
const resultName = process.env.QA_RESULT_NAME || "realtime-burst-results";
const batchedRealtime = process.env.QA_BATCHED_REALTIME === "true";
if (!/^[a-z0-9-]+$/.test(resultName)) throw new Error("QA result name must contain lowercase letters, numbers or hyphens");
if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) throw new Error("QA requires a local server");
const env = await readFile(new URL("../.env.local", import.meta.url), "utf8");
const supabaseUrl = env.match(/^NEXT_PUBLIC_SUPABASE_URL=["']?([^\s"']+)/m)?.[1];
assert(supabaseUrl, "Supabase public URL required to intercept its requests");
const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 0; this.pending = new Map(); this.handlers = new Map();
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const call = this.pending.get(message.id); this.pending.delete(message.id);
        if (message.error) call?.reject(new Error(JSON.stringify(message.error)));
        else call?.resolve(message.result);
      } else for (const fn of this.handlers.get(message.method) || []) fn(message.params);
    });
  }
  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => { socket.addEventListener("open", resolve, { once: true }); socket.addEventListener("error", reject, { once: true }); });
    return new CDP(socket);
  }
  on(event, fn) { this.handlers.set(event, [...(this.handlers.get(event) || []), fn]); }
  call(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.next; this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const { result, exceptionDetails } = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (exceptionDetails) throw new Error(exceptionDetails.text + ": " + result.description);
    return result.value;
  }
}

const auction = {
  id: "00000000-0000-4000-8000-000000000001", title: "QA simultaneous bids", description: "Local simulated bids", image_url: null,
  starting_price: 500, minimum_increment: 25, maximum_bid_difference: 100, winner_count: 12, timer_duration_seconds: 120,
  currency: "EUR", status: "active", starts_at: new Date(Date.now() - 30_000).toISOString(), ends_at: null, sort_order: 0,
  created_at: new Date().toISOString(),
};
const participants = Array.from({ length: 300 }, (_, i) => ({
  id: `10000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, auction_id: auction.id,
  username: `QA Bidder ${String(i).padStart(3, "0")}`, email: `qa${i}@example.invalid`, created_at: auction.created_at,
}));
let bids = [];
let adminDelay = 0;
let dashboardDelay = 0;
let adminReads = 0;
let activeAdminReads = 0;
let peakAdminReads = 0;
const rows = () => {
  const best = new Map();
  for (const bid of bids) {
    const old = best.get(bid.participant_id);
    if (!old || bid.amount > old.amount || (bid.amount === old.amount && (bid.created_at < old.created_at || (bid.created_at === old.created_at && bid.id < old.id)))) best.set(bid.participant_id, bid);
  }
  return [...best.values()].sort((a, b) => b.amount - a.amount || a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    .map((bid, i) => ({ ...bid, bid_id: bid.id, bidder_rank: i + 1, is_winner: i < auction.winner_count, is_final: auction.status === "ended" }));
};
function dashboard() {
  return { auction: { ...auction }, participants: participants.map(person => ({ id: person.id, auction_id: person.auction_id, username: person.username })), participant_count: participants.length,
    bids: [...bids].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).slice(0, 30), leaderboard: rows() };
}
function adminSnapshot() {
  const winners = rows().slice(0, auction.winner_count);
  return { auctions: [{ ...auction }], auction: { ...auction }, bids: [...bids].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id)).slice(0, 500), dashboard: dashboard(),
    donationTotals: [{ auction_id: auction.id, title: auction.title, currency: "EUR", sort_order: 0, bid_count: winners.length,
      total_bid_amount: winners.reduce((sum, row) => sum + row.amount, 0) }],
    winnerReport: auction.status === "ended" ? winners.map(row => ({
      auction_id: auction.id, title: auction.title, sort_order: 0, winner_rank: row.bidder_rank,
      participant_id: row.participant_id, username: row.username, email: row.email,
      winning_amount: row.amount, currency: "EUR", finalized_at: auction.ends_at,
      payment_status: "pending", paid_at: null,
    })) : [] };
}

// Uses the actual Supabase v2 wire protocol and binding IDs, with no network socket.
function installFixtures(config) {
  localStorage.clear();
  if (config.person || config.batchedRealtime) {
    const user = { id: config.person?.id ?? "90000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {} };
    const token = `${btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${btoa(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600 }))}.dummy`;
    localStorage.setItem(config.storageKey, JSON.stringify({ access_token: token, refresh_token: "qa-refresh", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user }));
  }
  const realSocket = window.WebSocket;
  const sockets = [];
  class FixtureSocket extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url, protocols) {
      super();
      if (!String(url).includes("supabase.co")) return new realSocket(url, protocols);
      this.url = url; this.readyState = 0; this.channels = new Map(); sockets.push(this);
      setTimeout(() => { this.readyState = 1; this.emit("open", new Event("open")); }, 0);
    }
    emit(type, event) { this[`on${type}`]?.(event); this.dispatchEvent(event); }
    message(value) { this.emit("message", new MessageEvent("message", { data: JSON.stringify(value) })); }
    send(raw) {
      const [join, ref, topic, event, payload] = JSON.parse(raw);
      if (event === "phx_join") {
        const bindings = (payload.config?.postgres_changes || []).map((binding, i) => ({ ...binding, id: i + 1 }));
        this.channels.set(topic, { join, bindings });
        setTimeout(() => this.message([join, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: bindings } }]), 0);
      } else if (event === "heartbeat" || event === "phx_leave") {
        if (event === "phx_leave") this.channels.delete(topic);
        setTimeout(() => this.message([join, ref, topic, "phx_reply", { status: "ok", response: {} }]), 0);
      }
    }
    close() { this.readyState = 3; this.emit("close", new CloseEvent("close")); }
  }
  window.WebSocket = FixtureSocket;
  window.__qaSockets = () => sockets.map(socket => ({ state: socket.readyState, channels: [...socket.channels.keys()] }));
  window.__qaRawBidSubscriptions = () => sockets.filter(socket => socket.readyState === 1)
    .flatMap(socket => [...socket.channels.values()]).flatMap(channel => channel.bindings)
    .filter(binding => binding.table === 'bids' || binding.table === 'participants').length;
  window.__qaBatchCount = 0;
  const pending = new Map();
  let timer = null;
  function flush() {
    timer = null;
    const entries = [...pending.values()].slice(0, 1000);
    for (const entry of entries) pending.delete(entry.kind + ':' + entry.record.id);
    if (entries.length) {
      const payload = { protocol: 1, batch_id: crypto.randomUUID(), events: entries };
      for (const socket of sockets) for (const [topic, channel] of socket.channels) {
        if (socket.readyState !== 1 || topic !== 'realtime:auction-live') continue;
        window.__qaBatchCount++;
        socket.message([channel.join, null, topic, 'broadcast', { event: 'auction_batch', payload }]);
      }
    }
    if (pending.size) timer = setTimeout(flush, 1000);
  }
  window.__qaEmit = events => {
    window.__qaStart = performance.now();
    if (config.batchedRealtime) {
      for (const event of events) {
        if (event.table !== 'bids' && event.table !== 'participants') continue;
        const source = event.record;
        const kind = event.table === 'bids' ? 'bid' : 'participant';
        const record = kind === 'bid'
          ? { id: source.id, auction_id: source.auction_id, participant_id: source.participant_id, amount: source.amount, created_at: source.created_at }
          : { id: source.id, auction_id: source.auction_id, username: source.username };
        pending.set(kind + ':' + source.id, { kind, record });
      }
      if (pending.size && timer === null) timer = setTimeout(flush, 1000);
    }
    for (const event of events) for (const socket of sockets) for (const [topic, channel] of socket.channels) {
      const ids = channel.bindings.filter(binding => binding.table === event.table && (binding.event === "*" || binding.event === event.type) &&
        (!binding.filter || binding.filter === `auction_id=eq.${event.record.auction_id}`)).map(binding => binding.id);
      if (!ids.length) continue;
      const columns = Object.keys(event.record).map(name => ({ name, type: name === "amount" ? "numeric" : "text" }));
      socket.message([channel.join, null, topic, "postgres_changes", { ids, data: {
        schema: "public", table: event.table, type: event.type, commit_timestamp: new Date().toISOString(), columns,
        record: event.record, old_record: {}, errors: null,
      } }]);
    }
    window.__qaDeliveryMs = performance.now() - window.__qaStart;
  };
  window.__qaMark = expected => {
    const observer = new MutationObserver(() => {
      if (document.body.innerText.includes(expected)) { window.__qaVisibleMs = performance.now() - window.__qaStart; observer.disconnect(); }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
  };
}

const browser = await CDP.connect((await (await fetch(`${debugOrigin}/json/version`)).json()).webSocketDebuggerUrl);
const pages = [];
const failures = [];
const results = [];
const submittedBids = [];
async function createPage(name, path, person) {
  const { browserContextId } = await browser.call("Target.createBrowserContext");
  const { targetId } = await browser.call("Target.createTarget", { url: "about:blank", browserContextId });
  const target = (await (await fetch(`${debugOrigin}/json/list`)).json()).find(item => item.id === targetId);
  const page = await CDP.connect(target.webSocketDebuggerUrl);
  pages.push({ name, page, browserContextId });
  await page.call("Runtime.enable"); await page.call("Page.enable");
  await page.call("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
  await page.call("Emulation.setLocaleOverride", { locale: "en-US" });
  page.on("Runtime.exceptionThrown", event => failures.push({ view: name, error: event.exceptionDetails.text, description: event.exceptionDetails.exception?.description }));
  await page.call("Page.addScriptToEvaluateOnNewDocument", { source: `(${installFixtures})(${JSON.stringify({ person, storageKey, batchedRealtime })})` });
  await page.call("Fetch.enable", { patterns: [{ urlPattern: "*supabase.co*" }, { urlPattern: `${origin}/api/admin/*` }] });
  page.on("Fetch.requestPaused", async ({ requestId, request }) => {
    try {
      const url = new URL(request.url);
      let body; let delay = 0; let admin = false;
      if (request.method === "OPTIONS") body = null;
      else if (url.pathname === "/api/admin/session") body = { configured: true, authenticated: true };
      else if (url.pathname === "/api/admin/auction") {
        admin = true; adminReads++; activeAdminReads++; peakAdminReads = Math.max(peakAdminReads, activeAdminReads);
        body = adminSnapshot(); delay = adminDelay;
      } else if (url.pathname === "/rest/v1/auctions") body = [{ ...auction }];
      else if (url.pathname.endsWith("/get_auction_dashboard")) { body = dashboard(); delay = dashboardDelay; }
      else if (url.pathname.endsWith("/place_bid")) {
        assert(person, "Only registered bidder contexts may submit");
        const input = JSON.parse(request.postData);
        assert.equal(input.p_auction_id, auction.id);
        const amount = Number(input.p_amount);
        assert(Number.isFinite(amount) && amount > 0 && amount <= 9999999999.99);
        assert(Math.abs(amount * 100 - Math.round(amount * 100)) < 1e-8);
        assert.equal(auction.status, "active");
        const record = { id: crypto.randomUUID(), auction_id: auction.id, participant_id: person.id,
          amount, created_at: new Date(Math.max(Date.now(), ...bids.map(bid => new Date(bid.created_at).getTime())) + 1).toISOString(),
          username: person.username, email: person.email };
        bids.push(record); submittedBids.push(record);
        body = [{ bid_id: record.id, amount, created_at: record.created_at, username: record.username }];
        await emit([{ table: "bids", type: "INSERT", record }]);
      }
      else if (url.pathname.endsWith("/get_my_participant_with_contact")) body = person ? [{ ...person, auction_id: auction.id }] : [];
      else if (url.pathname.endsWith("/get_my_auction_identity_with_contact")) body = person ? [person] : [];
      else if (url.pathname === "/auth/v1/user") body = { id: person?.id ?? "90000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {} };
      else throw new Error(`Unmocked request: ${request.method} ${url.pathname}`);
      if (delay) await pause(delay);
      if (admin) activeAdminReads--;
      await page.call("Fetch.fulfillRequest", { requestId, responseCode: request.method === "OPTIONS" ? 204 : 200,
        responseHeaders: [{ name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: "*" },
          { name: "Access-Control-Allow-Methods", value: "GET,POST,PUT,DELETE,OPTIONS" }, { name: "Access-Control-Allow-Headers", value: "*" }],
        body: body === null ? "" : Buffer.from(JSON.stringify(body)).toString("base64") });
    } catch (error) {
      failures.push({ view: name, error: error.message });
      await page.call("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => undefined);
    }
  });
  await page.call("Page.navigate", { url: origin + path });
  return page;
}
async function waitFor(check, message, timeout = 15_000) {
  const start = performance.now();
  while (performance.now() - start < timeout) { if (await check()) return; await pause(50); }
  const state = await all("({text:document.body.innerText.slice(0,1500),sockets:window.__qaSockets?.()})");
  throw new Error(`Timed out: ${message}; ${JSON.stringify(state)}`);
}
const all = expression => Promise.all(pages.map(({ page }) => page.evaluate(expression)));
async function emit(events) { await all(`window.__qaEmit(${JSON.stringify(events)})`); }
function bid(i, amount = i + 100) {
  const person = participants[i % participants.length];
  return { id: `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, auction_id: auction.id, participant_id: person.id,
    amount, created_at: new Date(Date.now() + i).toISOString(), username: person.username, email: person.email };
}
const money = amount => new Intl.NumberFormat("en-US", { style: "currency", currency: "EUR", minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);

try {
  await createPage("presentation", "/presentation");
  await createPage("admin", "/admin");
  await createPage("bidder1", "/", participants[0]);
  await createPage("bidder2", "/", participants[1]);
  await waitFor(async () => (await all("/\\blive\\b/i.test(document.body.innerText)")).every(Boolean), "all pages synchronized");
  await waitFor(async () => (await Promise.all(pages.slice(2).map(({ page }) => page.evaluate("!!document.querySelector('#bid-amount') && !document.querySelector('#bid-amount').disabled")))).every(Boolean), "both bidder sessions ready");
  results.push({ scenario: "Four independent browser contexts load the same active auction and become live", passed: true });
  if (batchedRealtime) {
    assert((await all("window.__qaRawBidSubscriptions() === 0")).every(Boolean));
    results.push({ scenario: "All four views use the shared private Broadcast with zero raw bid/name subscriptions", passed: true });
  }

  // Force a snapshot captured before the burst to finish much later.
  adminDelay = 2_000; dashboardDelay = 2_000;
  await all("window.dispatchEvent(new Event('online'))");
  await pause(200);
  const burst = Array.from({ length: 1_000 }, (_, i) => bid(i));
  bids.push(...burst);
  const highest = money(1099);
  await all(`window.__qaMark(${JSON.stringify(highest)})`);
  const events = [...burst].reverse().flatMap(record => [0, 1].map(() => ({ table: "bids", type: "INSERT", record })));
  await emit(events);
  await waitFor(async () => (await all(`document.body.innerText.includes(${JSON.stringify(highest)})`)).every(Boolean), "burst visible during pending stale reads", 1_800);
  const timing = await all("({deliveryMs:window.__qaDeliveryMs,visibleMs:window.__qaVisibleMs})");
  assert(timing.every(item => Number.isFinite(item.visibleMs) && item.visibleMs < 1_800), "all updates must precede stale snapshot completion");
  results.push({ scenario: "1,000 bids / 2,000 shuffled duplicated notifications per view appear before two-second stale snapshots finish", passed: true,
    timing: pages.map(({ name }, i) => ({ view: name, ...timing[i] })) });
  await pause(2_200);
  assert((await all(`document.body.innerText.includes(${JSON.stringify(highest)})`)).every(Boolean));
  const presentation = pages[0].page;
  const admin = pages[1].page;
  const actualTop = await presentation.evaluate("Array.from(document.querySelectorAll('ol[aria-label] li')).map(row=>row.querySelector('div strong').textContent)");
  assert.deepEqual(actualTop, rows().slice(0, 12).map(row => row.username));
  assert.equal(await admin.evaluate("document.querySelector('aside ol').children.length"), 500);
  for (const { page } of pages.slice(2)) {
    assert.equal(await page.evaluate("Array.from(document.querySelectorAll('h2')).find(h=>h.textContent==='Leaderboard').closest('section').querySelectorAll('ol li').length"), 300);
  }
  results.push({ scenario: "After stale responses: presentation Top 12, full 300-person bidder ranking and latest 500 admin history rows agree", passed: true });

  const beforeReads = adminReads;
  adminDelay = 600; dashboardDelay = 0;
  for (let round = 0; round < 20; round++) {
    const group = Array.from({ length: 50 }, (_, j) => bid(1_000 + round * 50 + j));
    bids.push(...group);
    await emit(group.map(record => ({ table: "bids", type: "INSERT", record })));
    await pause(50);
  }
  await waitFor(async () => (await all(`document.body.innerText.includes(${JSON.stringify(money(2099))})`)).every(Boolean), "continuous traffic convergence");
  await pause(1_800);
  assert.equal(peakAdminReads, 1);
  assert.equal(await admin.evaluate("document.querySelector('aside ol').children.length"), 500);
  const winningNames = await admin.evaluate("Array.from(document.querySelectorAll('aside ol li')).filter(li=>li.innerText.includes('Winner #')).map(li=>li.querySelector('p span').textContent)");
  assert.deepEqual(winningNames.sort(), rows().slice(0, 12).map(row => row.username).sort());
  results.push({ scenario: "Another 1,000 bids in a sustained stream: all views converge, no overlapping protected reads, same 12 winners", passed: true,
    protectedReads: adminReads - beforeReads, peakConcurrentReads: peakAdminReads });

  const singleBidder = Array.from({ length: 600 }, (_, j) => ({ ...bid(3_000 + j), participant_id: participants[1].id, username: participants[1].username, email: participants[1].email }));
  bids.push(...singleBidder);
  await emit(singleBidder.map(record => ({ table: "bids", type: "INSERT", record })));
  await pause(2_000);
  const donation = money(rows().slice(0, 12).reduce((sum, row) => sum + row.amount, 0));
  assert(await admin.evaluate(`document.body.innerText.includes(${JSON.stringify(donation)})`));
  assert.equal(await admin.evaluate("document.querySelector('aside ol').children.length"), 500);
  assert.deepEqual(await presentation.evaluate("Array.from(document.querySelectorAll('ol[aria-label] li')).map(row=>row.querySelector('div strong').textContent)"), rows().slice(0, 12).map(row => row.username));
  results.push({ scenario: "600 consecutive bids by one participant: older winning bidders remain ranked and the admin donation total includes winners absent from its 500 recent rows", passed: true });

  // Exercise the real input form and RPC path. The database tests separately
  // verify PostgreSQL acceptance; this fixture verifies all view updates.
  adminDelay = 0;
  const beforeLower = rows().map(row => ({ id: row.bid_id, amount: row.amount }));
  async function submitFrom(contexts, amount) {
    await Promise.all(contexts.map(({ page }) => page.evaluate(`(() => {
      const input = document.querySelector('#bid-amount');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(amount))});
      input.dispatchEvent(new Event('input', { bubbles: true }));
    })()`)));
    await Promise.all(contexts.map(({ page }) => page.evaluate("document.querySelector('#bid-amount').closest('form').requestSubmit()")));
    await waitFor(async () => (await Promise.all(contexts.map(({ page }) => page.evaluate(`document.body.innerText.includes(${JSON.stringify(`Bid accepted at ${money(amount)}.`)})`)))).every(Boolean), "bid receipts");
  }
  await submitFrom(pages.slice(2), 50);
  await submitFrom([pages[2]], 0.01);
  assert.deepEqual(submittedBids.map(record => record.amount), [50, 50, 0.01]);
  assert.deepEqual(rows().map(row => ({ id: row.bid_id, amount: row.amount })), beforeLower);
  await waitFor(async () => await admin.evaluate("document.querySelector('aside ol').innerText.includes('€0.01')"), "lower bid in admin history");
  assert.deepEqual(await presentation.evaluate("Array.from(document.querySelectorAll('ol[aria-label] li')).map(row=>row.querySelector('div strong').textContent)"), rows().slice(0, 12).map(row => row.username));
  results.push({ scenario: "Both real bidder forms accept identical €50 bids below the €500 opening price and leader; a €0.01 follow-up is also saved while personal bests and all rankings remain unchanged", passed: true });
  await submitFrom([pages[2]], 8000);
  await waitFor(async () => (await all(`document.body.innerText.includes(${JSON.stringify(money(8000))})`)).every(Boolean), "bid above old maximum visible in all views");
  assert.equal(submittedBids.at(-1).amount, 8000);
  assert.deepEqual(await presentation.evaluate("Array.from(document.querySelectorAll('ol[aria-label] li')).map(row=>row.querySelector('div strong').textContent)"), rows().slice(0, 12).map(row => row.username));
  results.push({ scenario: "A real bidder form accepts €8,000 above the old maximum increase; all four views update to the new leader", passed: true });
  const missed = { ...bid(4_000, 9000), username: participants[100].username, participant_id: participants[100].id };
  bids.push(missed);
  await all("window.dispatchEvent(new Event('online'))");
  await waitFor(async () => (await all(`document.body.innerText.includes(${JSON.stringify(money(9000))})`)).every(Boolean), "missed notification repaired by snapshots");
  results.push({ scenario: "A missed live notification is repaired from the common server snapshot in all four views", passed: true });

  auction.winner_count = 15;
  await emit([{ table: "auctions", type: "UPDATE", record: { ...auction } }]);
  await waitFor(async () => await presentation.evaluate("document.querySelectorAll('ol[aria-label] li').length===15"), "winner count update");
  results.push({ scenario: "Realtime winner-count update expands presentation to Top 15", passed: true });
  adminDelay = 2_000; dashboardDelay = 2_000;
  await all("window.dispatchEvent(new Event('online'))");
  await pause(200);
  auction.status = "ended"; auction.ends_at = new Date().toISOString();
  await emit([{ table: "auctions", type: "UPDATE", record: { ...auction } }]);
  await waitFor(async () => await presentation.evaluate("document.body.innerText.includes('Final leaderboard')"), "immediate final state");
  assert((await Promise.all(pages.slice(2).map(({ page }) => page.evaluate("document.querySelector('#bid-amount').disabled")))).every(Boolean));
  await pause(2_500);
  assert(await presentation.evaluate("document.body.innerText.includes('Final leaderboard')"));
  assert(await admin.evaluate("!Array.from(document.querySelectorAll('button')).some(button=>button.textContent==='End bidding')"));
  results.push({ scenario: "Event end immediately disables both bidder forms and survives older active snapshots in all views", passed: true });
  // New-event forms must stay selected while unrelated live traffic keeps arriving.
  await admin.evaluate("Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Add event').click()");
  await emit([{ table: "bids", type: "INSERT", record: bid(2_001) }]);
  await pause(1_500);
  assert(await admin.evaluate("!document.body.innerText.includes('Edit event')"));
  results.push({ scenario: "An unsaved new-event form remains selected during unrelated live traffic", passed: true });
  assert.equal(failures.length, 0, JSON.stringify(failures));
} catch (error) {
  failures.push({ error: error.stack ?? error.message });
  throw error;
} finally {
  await writeFile(new URL(`../qa/${resultName}.json`, import.meta.url), JSON.stringify({
    date: new Date().toISOString(), mode: "Isolated local production browser, HTTP/Realtime fixtures; no Supabase writes or real service load test", batchedRealtime, results, failures,
  }, null, 2) + "\n");
  for (const { page, browserContextId } of pages) {
    await browser.call("Target.disposeBrowserContext", { browserContextId }).catch(() => undefined);
    page.socket.close();
  }
  browser.socket.close();
}
console.log(JSON.stringify({ passed: results.length, failures, results }, null, 2));
