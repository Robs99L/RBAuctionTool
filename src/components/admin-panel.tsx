"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

import { formatMoney, formatTime } from "@/lib/format";
import type { Auction } from "@/lib/types";

type AdminBid = {
  id: string;
  amount: number;
  created_at: string;
  username: string;
};

type FormState = {
  title: string;
  description: string;
  imageUrl: string;
  startingPrice: string;
  minimumIncrement: string;
  currency: string;
};

const emptyForm: FormState = {
  title: "",
  description: "",
  imageUrl: "",
  startingPrice: "0",
  minimumIncrement: "1",
  currency: "EUR",
};

function extractParticipant(value: unknown) {
  if (Array.isArray(value)) return (value[0] as { username?: string } | undefined)?.username;
  return (value as { username?: string } | null)?.username;
}

export function AdminPanel() {
  const [checking, setChecking] = useState(true);
  const [configured, setConfigured] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    void fetch("/api/admin/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((data: { configured?: boolean; authenticated?: boolean }) => {
        setConfigured(Boolean(data.configured));
        setAuthenticated(Boolean(data.authenticated));
      })
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="panel h-80 animate-pulse" />;
  if (!configured) return <AdminNotConfigured />;
  if (!authenticated) return <AdminLogin onAuthenticated={() => setAuthenticated(true)} />;
  return <AuctionEditor onSignedOut={() => setAuthenticated(false)} />;
}

function AdminLogin({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function login(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/admin/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Sign-in failed.");
      setSecret("");
      onAuthenticated();
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Sign-in failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel mx-auto max-w-lg p-7 sm:p-10">
      <p className="text-xs font-bold uppercase tracking-[.16em] text-forest">Protected area</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">Auction administration</h1>
      <p className="mt-4 leading-7 text-ink/60">Enter the server-configured administrator secret to manage the live lot.</p>
      <form className="mt-7" onSubmit={login}>
        <label className="field-label" htmlFor="admin-secret">Administrator secret</label>
        <input
          id="admin-secret"
          type="password"
          className="field"
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          autoComplete="current-password"
          autoFocus
        />
        {error && <div className="notice notice-error mt-3" role="alert">{error}</div>}
        <button className="btn-primary mt-5 w-full" disabled={submitting || !secret}>
          {submitting ? "Authorizing…" : "Continue"}
        </button>
      </form>
    </section>
  );
}

function AuctionEditor({ onSignedOut }: { onSignedOut: () => void }) {
  const [auction, setAuction] = useState<Auction | null>(null);
  const [bids, setBids] = useState<AdminBid[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/auction", { cache: "no-store" });
      const data = (await response.json()) as {
        auction?: Auction | null;
        bids?: Array<Record<string, unknown>>;
        error?: string;
      };
      if (response.status === 401) {
        onSignedOut();
        return;
      }
      if (!response.ok) throw new Error(data.error ?? "Could not load the auction.");
      const current = data.auction ?? null;
      setAuction(current);
      if (current) {
        setForm({
          title: current.title,
          description: current.description,
          imageUrl: current.image_url ?? "",
          startingPrice: String(current.starting_price),
          minimumIncrement: String(current.minimum_increment),
          currency: current.currency,
        });
      }
      setBids((data.bids ?? []).map((bid) => ({
        id: String(bid.id),
        amount: Number(bid.amount),
        created_at: String(bid.created_at),
        username: extractParticipant(bid.participants) ?? "Unknown participant",
      })));
    } catch (loadError) {
      setMessage({ kind: "error", text: loadError instanceof Error ? loadError.message : "Could not load the auction." });
    } finally {
      setLoading(false);
    }
  }, [onSignedOut]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  function updateField(field: keyof FormState, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/auction", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: auction?.id,
          title: form.title,
          description: form.description,
          imageUrl: form.imageUrl,
          startingPrice: Number(form.startingPrice),
          minimumIncrement: Number(form.minimumIncrement),
          currency: form.currency,
        }),
      });
      const data = (await response.json()) as { auction?: Auction; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save the auction.");
      if (data.auction) setAuction(data.auction);
      setMessage({ kind: "success", text: auction ? "Auction details saved." : "Auction created." });
    } catch (saveError) {
      setMessage({ kind: "error", text: saveError instanceof Error ? saveError.message : "Could not save the auction." });
    } finally {
      setSaving(false);
    }
  }

  async function changeStatus(action: "start" | "end") {
    if (!auction || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/auction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: auction.id, action }),
      });
      const data = (await response.json()) as { auction?: Auction; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not update auction status.");
      if (data.auction) setAuction(data.auction);
      setMessage({ kind: "success", text: action === "start" ? "Auction is now live." : "Auction has ended." });
    } catch (statusError) {
      setMessage({ kind: "error", text: statusError instanceof Error ? statusError.message : "Could not update auction status." });
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    await fetch("/api/admin/session", { method: "DELETE" });
    onSignedOut();
  }

  if (loading) return <div className="panel h-[34rem] animate-pulse" />;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="panel p-6 sm:p-8">
        <div className="mb-7 flex items-start justify-between gap-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.16em] text-forest">Lot settings</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-.04em]">{auction ? "Edit auction" : "Create an auction"}</h1>
          </div>
          {auction && <span className="status-pill"><span className={`status-dot ${auction.status}`} />{auction.status}</span>}
        </div>

        <form onSubmit={save} className="space-y-5">
          <div>
            <label className="field-label" htmlFor="title">Product name</label>
            <input id="title" className="field" value={form.title} onChange={(event) => updateField("title", event.target.value)} maxLength={120} required />
          </div>
          <div>
            <label className="field-label" htmlFor="description">Description</label>
            <textarea id="description" className="field min-h-32 resize-y" value={form.description} onChange={(event) => updateField("description", event.target.value)} maxLength={4000} />
          </div>
          <div>
            <label className="field-label" htmlFor="image">Product image URL</label>
            <input id="image" type="url" className="field" value={form.imageUrl} onChange={(event) => updateField("imageUrl", event.target.value)} placeholder="https://…" />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="field-label" htmlFor="starting-price">Starting price</label>
              <input id="starting-price" type="number" min="0" step="0.01" className="field" value={form.startingPrice} onChange={(event) => updateField("startingPrice", event.target.value)} required />
            </div>
            <div>
              <label className="field-label" htmlFor="increment">Minimum step</label>
              <input id="increment" type="number" min="0.01" step="0.01" className="field" value={form.minimumIncrement} onChange={(event) => updateField("minimumIncrement", event.target.value)} required />
            </div>
            <div>
              <label className="field-label" htmlFor="currency">Currency</label>
              <input id="currency" className="field uppercase" value={form.currency} onChange={(event) => updateField("currency", event.target.value.toUpperCase())} minLength={3} maxLength={3} required />
            </div>
          </div>
          {message && <div className={`notice ${message.kind === "error" ? "notice-error" : "notice-success"}`} role="status">{message.text}</div>}
          <div className="flex flex-wrap items-center gap-3 border-t border-ink/10 pt-6">
            <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : auction ? "Save changes" : "Create auction"}</button>
            {auction && auction.status !== "active" && (
              <button type="button" className="btn-secondary" disabled={saving} onClick={() => void changeStatus("start")}>Start auction</button>
            )}
            {auction?.status === "active" && (
              <button type="button" className="btn-danger" disabled={saving} onClick={() => void changeStatus("end")}>End auction</button>
            )}
            <button type="button" className="ml-auto text-link" onClick={() => void signOut()}>Sign out</button>
          </div>
        </form>
      </section>

      <aside className="panel self-start p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.16em] text-ink/45">Audit view</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-[-.03em]">Bid history</h2>
          </div>
          <button className="text-link" onClick={() => void load()}>Refresh</button>
        </div>
        {bids.length && auction ? (
          <ol className="mt-5 divide-y divide-ink/10">
            {bids.map((bid) => (
              <li key={bid.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{bid.username}</p>
                  <p className="mt-0.5 text-xs text-ink/45">{formatTime(bid.created_at)}</p>
                </div>
                <strong className="text-sm tabular-nums">{formatMoney(bid.amount, auction.currency)}</strong>
              </li>
            ))}
          </ol>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-ink/15 p-7 text-center text-sm text-ink/50">No accepted bids yet.</div>
        )}
      </aside>
    </div>
  );
}

function AdminNotConfigured() {
  return (
    <section className="panel mx-auto max-w-xl p-7 sm:p-10">
      <p className="text-xs font-bold uppercase tracking-[.16em] text-coral">Configuration required</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">Set the administrator secret</h1>
      <p className="mt-4 leading-7 text-ink/60">Add an <code>ADMIN_SECRET</code> of at least 16 characters and the server-only <code>SUPABASE_SERVICE_ROLE_KEY</code> to the environment, then restart or redeploy.</p>
    </section>
  );
}
