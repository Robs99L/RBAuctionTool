// Ephemeral Presence only, in a unique room; no Auth, auction or database writes.
import { createClient } from "@supabase/supabase-js";
import { readFile, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

const env = await readFile(new URL("../.env.local", import.meta.url), "utf8");
function setting(name) {
  return env.match(new RegExp(`^${name}=["']?([^\\s"']+)`, "m"))?.[1];
}
const url = setting("NEXT_PUBLIC_SUPABASE_URL");
const key = setting("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
assert(url && key, "Public Supabase configuration is required");
const room = `auction-online-qa-${crypto.randomUUID()}`;
const clients = [];
const channels = [];
const results = [];
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(check) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (check()) return;
    await pause(100);
  }
  throw new Error("Presence did not reach the expected state within 20 seconds");
}
async function join(browserKey) {
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  clients.push(client);
  const channel = client.channel(room, { config: { presence: { key: browserKey, enabled: true } } });
  channels.push(channel);
  channel.on("presence", { event: "sync" }, () => {});
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Presence subscription timed out")), 20_000);
    channel.subscribe(status => {
      if (status === "SUBSCRIBED") { clearTimeout(timeout); resolve(); }
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") { clearTimeout(timeout); reject(new Error(`Presence status: ${status}`)); }
    });
  });
  assert.equal(await channel.track({ online: true }), "ok");
}
try {
  await join("qa-browser-a");
  await join("qa-browser-a");
  await join("qa-browser-b");
  const observer = channels[2];
  await waitFor(() => Object.keys(observer.presenceState()).length === 2 && observer.presenceState()["qa-browser-a"]?.length === 2);
  results.push({ scenario: "Three real connections with two browser keys produce an online count of two", passed: true });
  await clients[0].removeChannel(channels[0]);
  await waitFor(() => Object.keys(observer.presenceState()).length === 2 && observer.presenceState()["qa-browser-a"]?.length === 1);
  results.push({ scenario: "Closing one of two tabs keeps the browser online", passed: true });
  await clients[1].removeChannel(channels[1]);
  await waitFor(() => Object.keys(observer.presenceState()).length === 1);
  results.push({ scenario: "Closing the last tab removes that browser from the online count", passed: true });
} finally {
  await Promise.all(clients.map(client => client.removeAllChannels()));
  await writeFile(new URL("../qa/online-presence-service-results.json", import.meta.url), JSON.stringify({
    date: new Date().toISOString(), mode: "Real hosted Presence in an isolated temporary topic; no Auth or database writes", results,
  }, null, 2) + "\n");
}
console.log(JSON.stringify({ passed: results.length, results }, null, 2));
