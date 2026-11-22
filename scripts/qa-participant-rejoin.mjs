// Local browser fixtures only: never sends real Auth, email or auction writes.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const origin = process.env.QA_ORIGIN || "http://localhost:3000";
const debugOrigin = process.env.QA_DEBUG_ORIGIN || "http://localhost:9230";
assert(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin));
assert(/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(debugOrigin));
const env = await readFile(new URL("../.env.local", import.meta.url), "utf8");
const supabaseUrl = env.match(/^NEXT_PUBLIC_SUPABASE_URL=["']?([^\s"']+)/m)?.[1];
assert(supabaseUrl);
const storageKey = `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
class CDP {
  constructor(socket) {
    this.socket = socket; this.next = 0; this.pending = new Map(); this.handlers = new Map();
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data);
      if (message.id) {
        const call = this.pending.get(message.id); this.pending.delete(message.id);
        if (message.error) call?.reject(new Error(JSON.stringify(message.error))); else call?.resolve(message.result);
      } else for (const handler of this.handlers.get(message.method) || []) handler(message.params);
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
    const result = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  }
}
function installFixture(config) {
  localStorage.clear();
  if (config.expiredSession) localStorage.setItem(config.storageKey, JSON.stringify(config.expiredSession));
  const RealSocket = window.WebSocket;
  window.WebSocket = class extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3;
    constructor(url, protocols) {
      super();
      if (new URL(url).hostname !== config.supabaseHost) return new RealSocket(url, protocols);
      this.readyState = 0; this.channels = new Map();
      setTimeout(() => { this.readyState = 1; this.emit("open", new Event("open")); }, 0);
    }
    emit(type, event) { this[`on${type}`]?.(event); this.dispatchEvent(event); }
    message(data) { this.emit("message", new MessageEvent("message", { data: JSON.stringify(data) })); }
    send(raw) {
      const [join, ref, topic, event, payload] = JSON.parse(raw);
      if (event === "phx_join") {
        const bindings = (payload.config?.postgres_changes || []).map((binding, i) => ({ ...binding, id: i + 1 }));
        this.channels.set(topic, payload.config?.presence?.key);
        setTimeout(() => this.message([join, ref, topic, "phx_reply", { status: "ok", response: { postgres_changes: bindings } }]), 0);
      } else {
        setTimeout(() => this.message([join, ref, topic, "phx_reply", { status: "ok", response: {} }]), 0);
        if (event === "presence") setTimeout(() => this.message([join, null, topic, "presence_state", {
          [this.channels.get(topic)]: { metas: [{ phx_ref: "fixture", online: true }] },
        }]), 0);
      }
    }
    close() { this.readyState = 3; this.emit("close", new CloseEvent("close")); }
  };
}
const auction = { id: "00000000-0000-4000-8000-000000000001", title: "Rejoin fixture", description: "Local session recovery check", image_url: null,
  starting_price: 10, minimum_increment: 1, maximum_bid_difference: null, winner_count: 1, timer_duration_seconds: 120,
  currency: "EUR", status: "active", starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: null, sort_order: 1 };
const person = { id: "20000000-0000-4000-8000-000000000001", auction_id: auction.id, username: "Mia Keller", email: "mia@example.invalid", created_at: "2026-11-16T12:00:00.000Z" };
const savedBid = { id: "30000000-0000-4000-8000-000000000001", auction_id: auction.id, participant_id: person.id, amount: 100, username: person.username, created_at: "2026-11-16T12:01:00.000Z" };
function session(id) {
  const user = { id, aud: "authenticated", role: "authenticated", is_anonymous: true, app_metadata: {}, user_metadata: {} };
  const expires = Math.floor(Date.now() / 1000) + 3600;
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify({ sub: id, exp: expires })).toString("base64url")}.fixture`;
  return { access_token: token, refresh_token: "fixture-refresh", token_type: "bearer", expires_in: 3600, expires_at: expires, user };
}
const oldSession = session("10000000-0000-4000-8000-000000000001");
const newSession = session("10000000-0000-4000-8000-000000000002");
const browser = await CDP.connect((await (await fetch(`${debugOrigin}/json/version`)).json()).webSocketDebuggerUrl);
const contexts = []; const results = []; const failures = [];
async function checkBrowser(expired) {
  auction.status = "active"; auction.ends_at = null;
  const { browserContextId } = await browser.call("Target.createBrowserContext"); contexts.push(browserContextId);
  const { targetId } = await browser.call("Target.createTarget", { url: "about:blank", browserContextId });
  const target = (await (await fetch(`${debugOrigin}/json/list`)).json()).find(item => item.id === targetId);
  const page = await CDP.connect(target.webSocketDebuggerUrl);
  let registered = false; let anonymousSignins = 0; let joinRequests = 0; let lostAgain = false; const bids = [{ ...savedBid }];
  await page.call("Runtime.enable"); await page.call("Page.enable");
  await page.call("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  page.on("Runtime.exceptionThrown", event => failures.push({ error: event.exceptionDetails.exception?.description || event.exceptionDetails.text }));
  await page.call("Page.addScriptToEvaluateOnNewDocument", { source: `(${installFixture})(${JSON.stringify({ storageKey, supabaseHost: new URL(supabaseUrl).hostname, expiredSession: expired ? oldSession : null })})` });
  await page.call("Fetch.enable", { patterns: [{ urlPattern: `${supabaseUrl}/*` }] });
  page.on("Fetch.requestPaused", async ({ requestId, request }) => {
    try {
      const url = new URL(request.url); let body; let status = 200;
      if (request.method === "OPTIONS") { status = 204; body = null; }
      else if (url.pathname === "/rest/v1/auctions") body = [auction];
      else if (url.pathname === "/auth/v1/user") {
        if (request.headers.Authorization?.includes(oldSession.access_token) || request.headers.authorization?.includes(oldSession.access_token)) {
          status = 401; body = { code: "user_not_found", msg: "Session is no longer valid" };
        } else body = newSession.user;
      } else if (url.pathname === "/auth/v1/signup") { anonymousSignins++; body = newSession; }
      else if (url.pathname === "/auth/v1/logout") body = {};
      else if (url.pathname.endsWith("/get_my_participant_with_contact")) body = registered ? [person] : [];
      else if (url.pathname.endsWith("/get_my_auction_identity_with_contact")) body = registered ? [{ username: person.username, email: person.email }] : [];
      else if (url.pathname.endsWith("/join_auction_with_contact")) {
        joinRequests++; const input = JSON.parse(request.postData);
        assert.equal(input.p_auction_id, auction.id);
        if (input.p_username.toLowerCase() === person.username.toLowerCase() && input.p_email === person.email) { registered = true; body = [person]; }
        else { status = 400; body = { code: "P0001", message: "That name is already in use for this auction." }; }
      } else if (url.pathname.endsWith("/get_auction_dashboard")) body = { auction, participant_count: 1,
        participants: [{ id: person.id, auction_id: auction.id, username: person.username }], bids,
        leaderboard: [{ ...bids[bids.length - 1], bid_id: bids[bids.length - 1].id, bidder_rank: 1, is_winner: true, is_final: auction.status === "ended" }] };
      else if (url.pathname.endsWith("/place_bid")) {
        if (lostAgain) { registered = false; status = 400; body = { code: "P0001", message: "Join the auction before placing a bid." }; }
        else {
          assert(registered); assert.equal(auction.status, "active"); const amount = Number(JSON.parse(request.postData).p_amount);
          const bid = { ...savedBid, id: crypto.randomUUID(), amount, created_at: new Date().toISOString() }; bids.push(bid);
          body = [{ bid_id: bid.id, amount, created_at: bid.created_at, username: person.username }];
        }
      } else throw new Error(`Unexpected Supabase request (including forbidden emails): ${request.method} ${url.pathname}`);
      await page.call("Fetch.fulfillRequest", { requestId, responseCode: status, responseHeaders: [
        { name: "Content-Type", value: "application/json" }, { name: "Access-Control-Allow-Origin", value: origin },
        { name: "Access-Control-Allow-Methods", value: "GET,POST,OPTIONS" }, { name: "Access-Control-Allow-Headers", value: "*" },
      ], body: body === null ? "" : Buffer.from(JSON.stringify(body)).toString("base64") });
    } catch (error) {
      failures.push({ error: error.message }); await page.call("Fetch.failRequest", { requestId, errorReason: "BlockedByClient" }).catch(() => {});
    }
  });
  async function waitFor(expression) {
    const start = Date.now();
    while (Date.now() - start < 30_000) { if (await page.evaluate(expression)) return; await pause(100); }
    throw new Error(`Timeout: ${expression}; ${await page.evaluate("document.body.innerText")}`);
  }
  async function fill(selector, value) {
    await page.evaluate(`(() => { const input = document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  }
  async function join(email) {
    await waitFor("Boolean(document.querySelector('#username'))");
    await fill("#username", "  MIA KELLER  "); await fill("#email", email);
    await page.evaluate("document.querySelector('#username').form.requestSubmit()");
  }
  try {
    await page.call("Page.navigate", { url: origin });
    await join("wrong@example.invalid");
    await waitFor("document.body.innerText.includes('That name is already in use')");
    assert.equal(bids.length, 1); assert(!registered);
    await join(" MIA@EXAMPLE.INVALID ");
    await waitFor("document.querySelector('#bid-amount')?.disabled === false");
    assert.equal(anonymousSignins, 1); assert.equal(joinRequests, 2); assert.deepEqual(bids[0], savedBid);
    await waitFor("document.body.innerText.includes('You are ranked #1.') && document.querySelector('ol[aria-label] li')?.innerText.includes('Mia Keller')");
    assert.equal(await page.evaluate("document.querySelector('#bid-starting-price strong')?.textContent"), new Intl.NumberFormat("en-US", { style: "currency", currency: auction.currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(auction.starting_price));
    assert(await page.evaluate("!/€|\\bEUR\\b/.test(document.body.innerText.replace(document.querySelector('#bid-starting-price').innerText, '')) && !/recent activit/i.test(document.body.innerText)"));
    await fill("#bid-amount", "150"); await page.evaluate("document.querySelector('#bid-amount').form.requestSubmit()");
    await waitFor("document.body.innerText.includes('Your bid has been accepted.')");
    assert.equal(bids.length, 2); assert.equal(bids[1].participant_id, person.id);
    lostAgain = true;
    await fill("#bid-amount", "200"); await page.evaluate("document.querySelector('#bid-amount').form.requestSubmit()");
    await waitFor("Boolean(document.querySelector('#username'))");
    assert.equal(bids.length, 2);
    lostAgain = false;
    await join(person.email); await waitFor("document.querySelector('#bid-amount')?.disabled === false");
    assert.equal(bids.length, 2); assert.equal(anonymousSignins, 1);
    await page.evaluate(`(() => { localStorage.removeItem(${JSON.stringify(storageKey)}); const channel = new BroadcastChannel(${JSON.stringify(storageKey)}); channel.postMessage({ event: 'SIGNED_OUT', session: null }); channel.close(); })()`);
    await waitFor("Boolean(document.querySelector('#username'))");
    await join(person.email); await waitFor("document.querySelector('#bid-amount')?.disabled === false");
    assert.equal(bids.length, 2); assert.equal(anonymousSignins, 2);
    assert(await page.evaluate("document.documentElement.scrollWidth <= innerWidth"));
    const screenshot = await page.call("Page.captureScreenshot", { format: "png" });
    await writeFile(new URL(`../qa/participant-rejoin-${expired ? 'invalid-session' : 'lost-storage'}.png`, import.meta.url), Buffer.from(screenshot.data, "base64"));
    results.push({ scenario: expired ? "Invalid stored session is cleared and rejoined" : "Lost Auth storage is rejoined", passed: true,
      checks: ["wrong email rejected", "same original participant and bid", "new bids use original participant", "second session loss returns registration and can rejoin", "Auth sign-out returns registration and creates a new session on rejoin", "starting price visible; bid amounts and recent activities remain hidden", "no horizontal mobile overflow", "no email requests"] });
    auction.status = "ended"; auction.ends_at = new Date().toISOString();
    await page.call("Page.navigate", { url: origin });
    await waitFor("Array.from(document.querySelectorAll('button')).some(button => button.textContent.includes('Rejoin to see your result'))");
    await page.evaluate("Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('Rejoin to see your result')).click()");
    await join(person.email);
    await waitFor("Boolean(document.querySelector('[role=dialog]')) && document.querySelector('#bid-amount')?.disabled === true");
    assert(await page.evaluate("document.querySelector('[role=dialog]').innerText.includes('You won!') && /€|\\bEUR\\b/.test(document.querySelector('[role=dialog]').innerText)"));
    assert.equal(bids.length, 2);
    const finalScreenshot = await page.call("Page.captureScreenshot", { format: "png" });
    await writeFile(new URL(`../qa/participant-rejoin-${expired ? 'invalid-session' : 'lost-storage'}-final.png`, import.meta.url), Buffer.from(finalScreenshot.data, "base64"));
    results.push({ scenario: `Rejoin after event end (${expired ? 'invalid session' : 'lost storage'})`, passed: true,
      checks: ["public final results remain accessible", "existing participant can rejoin", "personal winner result and final EUR amount appear", "bidding stays disabled", "existing bids unchanged", "no email requests"] });
  } finally { page.socket.close(); }
}
try { await checkBrowser(false); await checkBrowser(true); assert.equal(failures.length, 0, JSON.stringify(failures)); }
catch (error) { failures.push({ error: error.stack || error.message }); throw error; }
finally {
  await writeFile(new URL("../qa/participant-rejoin-results.json", import.meta.url), JSON.stringify({ date: new Date().toISOString(), mode: "Isolated local HTTP/Realtime fixtures; no hosted writes or emails", results, failures }, null, 2) + "\n");
  for (const browserContextId of contexts) await browser.call("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
  browser.socket.close();
}
console.log(JSON.stringify({ results, failures }, null, 2));
