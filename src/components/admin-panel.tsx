"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { AuctionTimer } from "@/components/auction-timer";
import { orderAuctions, selectCurrentAuction } from "@/lib/auction-queue";
import { selectWinningBids } from "@/lib/auction-winners";
import { summarizeDonations, type DonationTotal } from "@/lib/donation-summary";
import {
  clearDemoParticipantId,
  createDemoAuctionState,
  DEMO_STATE_KEY,
  loadDemoAuctionState,
  saveDemoAuctionState,
  type DemoAuctionState,
} from "@/lib/demo-auction";
import { formatMoney, formatTime } from "@/lib/format";
import type { Auction } from "@/lib/types";

type AdminBid = {
  id: string;
  participant_id: string;
  amount: number;
  created_at: string;
  username: string;
  email: string;
};

type FormState = {
  title: string;
  description: string;
  imageUrl: string;
  startingPrice: string;
  minimumIncrement: string;
  maximumDifference: string;
  winnerCount: string;
  currency: string;
};

type Message = { kind: "error" | "success"; text: string } | null;

const PRODUCT_IMAGE_MAX_BYTES = 4 * 1024 * 1024;
const DEMO_IMAGE_MAX_BYTES = 1024 * 1024;
const PRODUCT_IMAGE_TYPES = ["image/png", "image/jpeg"];

const emptyForm: FormState = {
  title: "",
  description: "",
  imageUrl: "",
  startingPrice: "0",
  minimumIncrement: "1",
  maximumDifference: "",
  winnerCount: "1",
  currency: "EUR",
};

function formFromAuction(auction: Auction): FormState {
  return {
    title: auction.title,
    description: auction.description,
    imageUrl: auction.image_url ?? "",
    startingPrice: String(auction.starting_price),
    minimumIncrement: String(auction.minimum_increment),
    maximumDifference: auction.maximum_bid_difference == null
      ? ""
      : String(auction.maximum_bid_difference),
    winnerCount: String(auction.winner_count),
    currency: auction.currency,
  };
}

function normalizedAuction(auction: Auction): Auction {
  return {
    ...auction,
    starting_price: Number(auction.starting_price),
    minimum_increment: Number(auction.minimum_increment),
    maximum_bid_difference: auction.maximum_bid_difference == null
      ? null
      : Number(auction.maximum_bid_difference),
    winner_count: Number(auction.winner_count ?? 1),
    sort_order: Number(auction.sort_order),
  };
}

function mapAdminBids(rows: Array<Record<string, unknown>> = []): AdminBid[] {
  return rows.map((bid) => ({
    id: String(bid.id),
    participant_id: String(bid.participant_id),
    amount: Number(bid.amount),
    created_at: String(bid.created_at),
    username: String(bid.username ?? "Unknown participant"),
    email: String(bid.email ?? ""),
  }));
}

function mapDonationTotals(rows: Array<Record<string, unknown>> = []): DonationTotal[] {
  return rows.map((row) => ({
    auction_id: String(row.auction_id),
    title: String(row.title),
    currency: String(row.currency),
    sort_order: Number(row.sort_order),
    bid_count: Number(row.bid_count),
    total_bid_amount: Number(row.total_bid_amount),
  }));
}

function fileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error ?? new Error("Could not read the image.")));
    reader.readAsDataURL(file);
  });
}

export function AdminPanel() {
  const demoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true" || !(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
  return demoMode ? <DemoAuctionEditor /> : <ConnectedAdminPanel />;
}

function ConnectedAdminPanel() {
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
      <p className="mt-4 leading-7 text-ink/60">Enter the server-configured administrator secret to manage the product queue.</p>
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
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [auction, setAuction] = useState<Auction | null>(null);
  const [bids, setBids] = useState<AdminBid[]>([]);
  const [donationTotals, setDonationTotals] = useState<DonationTotal[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(async (auctionId?: string) => {
    try {
      const query = auctionId ? `?auctionId=${encodeURIComponent(auctionId)}` : "";
      const response = await fetch(`/api/admin/auction${query}`, { cache: "no-store" });
      const data = (await response.json()) as {
        auctions?: Auction[];
        auction?: Auction | null;
        bids?: Array<Record<string, unknown>>;
        donationTotals?: Array<Record<string, unknown>>;
        error?: string;
      };
      if (response.status === 401) {
        onSignedOut();
        return;
      }
      if (!response.ok) throw new Error(data.error ?? "Could not load the product queue.");
      const nextAuctions = orderAuctions((data.auctions ?? []).map(normalizedAuction));
      const selected = data.auction ? normalizedAuction(data.auction) : null;
      setAuctions(nextAuctions);
      setAuction(selected);
      setForm(selected ? formFromAuction(selected) : emptyForm);
      setBids(mapAdminBids(data.bids));
      setDonationTotals(mapDonationTotals(data.donationTotals));
    } catch (loadError) {
      setMessage({
        kind: "error",
        text: loadError instanceof Error ? loadError.message : "Could not load the product queue.",
      });
    } finally {
      setLoading(false);
    }
  }, [onSignedOut]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    const creating = !auction;
    try {
      const payload = new FormData(event.currentTarget);
      if (auction) payload.set("id", auction.id);
      const response = await fetch("/api/admin/auction", {
        method: "PUT",
        body: payload,
      });
      const data = (await response.json()) as { auction?: Auction; error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not save the product.");
      if (data.auction) await load(data.auction.id);
      setMessage({ kind: "success", text: creating ? "Product added to the queue." : "Product details saved." });
    } catch (saveError) {
      setMessage({ kind: "error", text: saveError instanceof Error ? saveError.message : "Could not save the product." });
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
      if (!response.ok) throw new Error(data.error ?? "Could not update the auction status.");
      await load(auction.id);
      setMessage({ kind: "success", text: action === "start" ? "This product is now live." : "Bidding for this product has ended." });
    } catch (statusError) {
      setMessage({ kind: "error", text: statusError instanceof Error ? statusError.message : "Could not update the auction status." });
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
    <AuctionManagerView
      auctions={auctions}
      auction={auction}
      bids={bids}
      donationTotals={donationTotals}
      form={form}
      message={message}
      saving={saving}
      onFormChange={setForm}
      onSelect={(id) => void load(id)}
      onNew={() => {
        setAuction(null);
        setForm(emptyForm);
        setBids([]);
        setMessage(null);
      }}
      onSave={save}
      onStatusChange={(action) => void changeStatus(action)}
      onRefresh={() => void load(auction?.id)}
      onSignOut={() => void signOut()}
    />
  );
}

function DemoAuctionEditor() {
  const [demoState, setDemoState] = useState<DemoAuctionState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [message, setMessage] = useState<Message>(null);

  const selected = useMemo(
    () => demoState?.auctions.find((item) => item.id === selectedId) ?? null,
    [demoState, selectedId],
  );
  const bids = useMemo(
    () => selected && demoState
      ? demoState.bids
        .filter((bid) => bid.auction_id === selected.id)
        .map((bid) => ({
          ...bid,
          email: demoState.participants.find((participant) => participant.id === bid.participant_id)?.email ?? "",
        }))
      : [],
    [demoState, selected],
  );
  const donationTotals = useMemo(
    () => demoState ? summarizeDonations(demoState.auctions, demoState.bids) : [],
    [demoState],
  );

  const load = useCallback((preferredId?: string) => {
    const next = loadDemoAuctionState();
    const current = next.auctions.find((item) => item.id === preferredId) ?? selectCurrentAuction(next.auctions);
    setDemoState(next);
    setSelectedId(current?.id ?? null);
    setForm(current ? formFromAuction(current) : emptyForm);
    saveDemoAuctionState(next);
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => load(), 0);
    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key === DEMO_STATE_KEY) load(selectedId ?? undefined);
    };
    window.addEventListener("storage", syncAcrossTabs);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("storage", syncAcrossTabs);
    };
  }, [load, selectedId]);

  const commitState = useCallback((next: DemoAuctionState) => {
    setDemoState(next);
    saveDemoAuctionState(next);
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!demoState) return;
    setMessage(null);
    const startingPrice = Number(form.startingPrice);
    const minimumIncrement = Number(form.minimumIncrement);
    const maximumDifference = form.maximumDifference.trim() === ""
      ? null
      : Number(form.maximumDifference);
    const winnerCount = Number(form.winnerCount);
    if (
      !Number.isFinite(startingPrice) ||
      startingPrice < 0 ||
      !Number.isFinite(minimumIncrement) ||
      minimumIncrement <= 0 ||
      (maximumDifference !== null && (
        !Number.isFinite(maximumDifference) ||
        maximumDifference < minimumIncrement
      )) ||
      !Number.isSafeInteger(winnerCount) ||
      winnerCount < 1 ||
      winnerCount > 1000
    ) {
      setMessage({
        kind: "error",
        text: "Enter valid pricing details. The optional maximum increase must be at least the minimum step.",
      });
      return;
    }
    const imageEntry = new FormData(event.currentTarget).get("image");
    const imageFile = imageEntry instanceof File && imageEntry.size > 0 ? imageEntry : null;
    if (imageFile && (!PRODUCT_IMAGE_TYPES.includes(imageFile.type) || imageFile.size > DEMO_IMAGE_MAX_BYTES)) {
      setMessage({ kind: "error", text: "Demo images must be PNG or JPEG files up to 1 MB." });
      return;
    }
    let imageUrl = form.imageUrl;
    if (imageFile) {
      try {
        imageUrl = await fileAsDataUrl(imageFile);
      } catch {
        setMessage({ kind: "error", text: "Could not read the selected image." });
        return;
      }
    }
    const now = new Date().toISOString();
    const nextAuction: Auction = selected
      ? {
        ...selected,
        title: form.title.trim(),
        description: form.description.trim(),
        image_url: imageUrl || null,
        starting_price: startingPrice,
        minimum_increment: minimumIncrement,
        maximum_bid_difference: maximumDifference,
        winner_count: winnerCount,
        currency: form.currency.trim().toUpperCase(),
      }
      : {
        id: crypto.randomUUID(),
        title: form.title.trim(),
        description: form.description.trim(),
        image_url: imageUrl || null,
        starting_price: startingPrice,
        minimum_increment: minimumIncrement,
        maximum_bid_difference: maximumDifference,
        winner_count: winnerCount,
        currency: form.currency.trim().toUpperCase(),
        status: "upcoming",
        starts_at: null,
        ends_at: null,
        sort_order: Math.max(0, ...demoState.auctions.map((item) => item.sort_order)) + 1,
        created_at: now,
      };
    const auctions = selected
      ? demoState.auctions.map((item) => item.id === selected.id ? nextAuction : item)
      : [...demoState.auctions, nextAuction];
    commitState({ ...demoState, auctions });
    setSelectedId(nextAuction.id);
    setForm(formFromAuction(nextAuction));
    setMessage({ kind: "success", text: selected ? "Demo product saved." : "Demo product added to the queue." });
  }

  function changeStatus(action: "start" | "end") {
    if (!demoState || !selected) return;
    const now = new Date().toISOString();
    const auctions = demoState.auctions.map((item) => {
      if (action === "start" && item.status === "active" && item.id !== selected.id) {
        return { ...item, status: "ended" as const, ends_at: now };
      }
      if (item.id !== selected.id) return item;
      return action === "start"
        ? { ...item, status: "active" as const, starts_at: now, ends_at: null }
        : { ...item, status: "ended" as const, ends_at: now };
    });
    commitState({ ...demoState, auctions });
    setMessage({ kind: "success", text: action === "start" ? "Demo product is now live." : "Demo bidding has ended." });
  }

  function resetDemo() {
    const next = createDemoAuctionState();
    const current = selectCurrentAuction(next.auctions);
    clearDemoParticipantId();
    commitState(next);
    setSelectedId(current?.id ?? null);
    setForm(current ? formFromAuction(current) : emptyForm);
    setMessage({ kind: "success", text: "Demo data reset." });
  }

  if (!demoState) return <div className="panel h-[34rem] animate-pulse" />;

  return (
    <AuctionManagerView
      auctions={orderAuctions(demoState.auctions)}
      auction={selected}
      bids={bids}
      donationTotals={donationTotals}
      form={form}
      message={message}
      saving={false}
      demo
      onReset={resetDemo}
      onFormChange={setForm}
      onSelect={(id) => {
        const next = demoState.auctions.find((item) => item.id === id) ?? null;
        setSelectedId(id);
        setForm(next ? formFromAuction(next) : emptyForm);
        setMessage(null);
      }}
      onNew={() => {
        setSelectedId(null);
        setForm(emptyForm);
        setMessage(null);
      }}
      onSave={save}
      onStatusChange={changeStatus}
      onRefresh={() => load(selectedId ?? undefined)}
    />
  );
}

function AuctionManagerView({
  auctions,
  auction,
  bids,
  donationTotals,
  form,
  message,
  saving,
  demo = false,
  onFormChange,
  onSelect,
  onNew,
  onSave,
  onStatusChange,
  onRefresh,
  onSignOut,
  onReset,
}: {
  auctions: Auction[];
  auction: Auction | null;
  bids: AdminBid[];
  donationTotals: DonationTotal[];
  form: FormState;
  message: Message;
  saving: boolean;
  demo?: boolean;
  onFormChange: (form: FormState) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onStatusChange: (action: "start" | "end") => void;
  onRefresh: () => void;
  onSignOut?: () => void;
  onReset?: () => void;
}) {
  const auctionKey = auction?.id ?? "new";
  const [selectedImage, setSelectedImage] = useState<{ auctionKey: string; file: File } | null>(null);
  const selectedImageFile = selectedImage?.auctionKey === auctionKey ? selectedImage.file : null;
  const selectedImageUrl = useMemo(
    () => selectedImageFile ? URL.createObjectURL(selectedImageFile) : null,
    [selectedImageFile],
  );
  useEffect(() => () => {
    if (selectedImageUrl) URL.revokeObjectURL(selectedImageUrl);
  }, [selectedImageUrl]);
  const imagePreviewUrl = selectedImageUrl ?? form.imageUrl;
  const imageMaxBytes = demo ? DEMO_IMAGE_MAX_BYTES : PRODUCT_IMAGE_MAX_BYTES;
  const donationTotalsByAuction = new Map(
    donationTotals.map((total) => [total.auction_id, total]),
  );
  const selectedDonationTotal = auction ? donationTotalsByAuction.get(auction.id) : undefined;

  const winningRanks = new Map(
    (auction ? selectWinningBids(bids, auction.winner_count) : [])
      .map((bid) => [bid.id, bid.rank]),
  );

  function updateField(field: keyof FormState, value: string) {
    onFormChange({ ...form, [field]: value });
  }

  return (
    <div className="space-y-6">
      {demo && (
        <div className="notice notice-info flex flex-wrap items-center justify-between gap-3">
          <span><strong>Local demo:</strong> Products and bids are stored only in this browser.</span>
          <button className="font-bold underline underline-offset-4" onClick={onReset}>Reset demo</button>
        </div>
      )}

      <section className="panel p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.16em] text-forest">Auction sequence</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-.03em]">Product queue</h1>
          </div>
          <div className="flex items-center gap-4">
            {onSignOut && <button className="text-link" onClick={onSignOut}>Sign out</button>}
            <button className="btn-primary" onClick={onNew}>Add product</button>
          </div>
        </div>
        {auctions.length ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {auctions.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={auction?.id === item.id}
                className={`rounded-2xl border p-4 text-left transition ${auction?.id === item.id ? "border-forest bg-forest text-white" : "border-ink/10 bg-white/70 hover:border-ink/30"}`}
                onClick={() => onSelect(item.id)}
              >
                <span className={`text-xs font-bold uppercase tracking-[.12em] ${auction?.id === item.id ? "text-white/55" : "text-ink/45"}`}>Lot {index + 1}</span>
                <strong className="mt-2 block truncate">{item.title}</strong>
                <span className={`mt-1 block text-xs ${auction?.id === item.id ? "text-white/60" : "text-ink/45"}`}>
                  {item.winner_count} {item.winner_count === 1 ? "winner" : "winners"}
                </span>
                <span className={`mt-1 block text-xs ${auction?.id === item.id ? "text-white/75" : "text-forest"}`}>
                  Donation total: {formatMoney(donationTotalsByAuction.get(item.id)?.total_bid_amount ?? 0, item.currency)}
                </span>
                <span className={`mt-3 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[.08em] ${auction?.id === item.id ? "text-white/75" : "text-ink/55"}`}>
                  <span className={`status-dot ${item.status}`} />{item.status}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-5 rounded-xl border border-dashed border-ink/15 p-7 text-center text-sm text-ink/50">No products yet. Add the first auction lot.</div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="panel p-6 sm:p-8">
          <div className="mb-7 flex items-start justify-between gap-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.16em] text-forest">Product settings</p>
              <h2 className="mt-2 text-3xl font-semibold tracking-[-.04em]">{auction ? "Edit product" : "Add a product"}</h2>
            </div>
            {auction && <span className="status-pill"><span className={`status-dot ${auction.status}`} />{auction.status}</span>}
          </div>

          {auction && (
            <AuctionTimer
              startsAt={auction.starts_at}
              status={auction.status}
              compact
              className="mb-7"
            />
          )}

          <form key={auctionKey} onSubmit={onSave} className="space-y-5">
            <div>
              <label className="field-label" htmlFor="title">Product name</label>
              <input id="title" name="title" className="field" value={form.title} onChange={(event) => updateField("title", event.target.value)} maxLength={120} required />
            </div>
            <div>
              <label className="field-label" htmlFor="description">Description</label>
              <textarea id="description" name="description" className="field min-h-32 resize-y" value={form.description} onChange={(event) => updateField("description", event.target.value)} maxLength={4000} />
            </div>
            <div>
              <label className="field-label" htmlFor="image">Product image</label>
              <input
                key={auctionKey}
                id="image"
                name="image"
                type="file"
                accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                className="field file:mr-4 file:rounded-full file:border-0 file:bg-forest file:px-4 file:py-2 file:text-sm file:font-bold file:text-white"
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  const error = file && !PRODUCT_IMAGE_TYPES.includes(file.type)
                    ? "Select a PNG or JPEG image."
                    : file && file.size > imageMaxBytes
                      ? `The image must not exceed ${demo ? "1 MB" : "4 MB"}.`
                      : "";
                  event.target.setCustomValidity(error);
                  if (error) {
                    event.target.reportValidity();
                    setSelectedImage(null);
                    return;
                  }
                  setSelectedImage(file ? { auctionKey, file } : null);
                }}
              />
              <p className="mt-2 text-xs text-ink/45">
                PNG or JPEG, maximum {demo ? "1 MB in demo mode" : "4 MB"}. Choosing no file keeps the current image.
              </p>
              {imagePreviewUrl && (
                <div className="mt-3 h-40 overflow-hidden rounded-2xl border border-ink/10 bg-mist">
                  <img src={imagePreviewUrl} alt="Product preview" className="h-full w-full object-contain" />
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
              <div>
                <label className="field-label" htmlFor="starting-price">Starting price</label>
                <input id="starting-price" name="startingPrice" type="number" min="0" step="0.01" className="field" value={form.startingPrice} onChange={(event) => updateField("startingPrice", event.target.value)} required />
              </div>
              <div>
                <label className="field-label" htmlFor="increment">Minimum step</label>
                <input id="increment" name="minimumIncrement" type="number" min="0.01" step="0.01" className="field" value={form.minimumIncrement} onChange={(event) => updateField("minimumIncrement", event.target.value)} required />
              </div>
              <div>
                <label className="field-label" htmlFor="maximum-difference">Maximum increase</label>
                <input
                  id="maximum-difference"
                  name="maximumDifference"
                  type="number"
                  min={form.minimumIncrement || "0.01"}
                  step="0.01"
                  className="field"
                  value={form.maximumDifference}
                  onChange={(event) => updateField("maximumDifference", event.target.value)}
                  placeholder="Unlimited"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="winner-count">Winning bidders</label>
                <input id="winner-count" name="winnerCount" type="number" min="1" max="1000" step="1" className="field" value={form.winnerCount} onChange={(event) => updateField("winnerCount", event.target.value)} required />
              </div>
              <div>
                <label className="field-label" htmlFor="currency">Currency</label>
                <input id="currency" name="currency" className="field uppercase" value={form.currency} onChange={(event) => updateField("currency", event.target.value.toUpperCase())} minLength={3} maxLength={3} required />
              </div>
            </div>
            <p className="text-xs leading-5 text-ink/45">
              Maximum increase is the largest allowed difference from the current highest bid. Leave it blank for no limit.
            </p>
            {message && <div className={`notice ${message.kind === "error" ? "notice-error" : "notice-success"}`} role="status">{message.text}</div>}
            <div className="flex flex-wrap items-center gap-3 border-t border-ink/10 pt-6">
              <button className="btn-primary" disabled={saving}>{saving ? "Saving…" : auction ? "Save changes" : "Add to queue"}</button>
              {auction?.status === "upcoming" && (
                <button type="button" className="btn-secondary" disabled={saving} onClick={() => onStatusChange("start")}>Start this product</button>
              )}
              {auction?.status === "active" && (
                <button type="button" className="btn-danger" disabled={saving} onClick={() => onStatusChange("end")}>End bidding</button>
              )}
            </div>
          </form>
        </section>

        <aside className="panel self-start p-6">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.16em] text-ink/45">Selected product</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-.03em]">Bid history</h2>
              {auction && (
                <div className="mt-1 space-y-1 text-xs text-ink/45">
                  <p>Top {auction.winner_count} distinct {auction.winner_count === 1 ? "bidder wins" : "bidders win"}</p>
                  <p className="font-semibold text-forest">
                    Donation total: {formatMoney(selectedDonationTotal?.total_bid_amount ?? 0, auction.currency)} from {selectedDonationTotal?.bid_count ?? 0} accepted bids
                  </p>
                </div>
              )}
            </div>
            <button className="text-link" onClick={onRefresh}>Refresh</button>
          </div>
          {bids.length && auction ? (
            <ol className="mt-5 divide-y divide-ink/10">
              {bids.map((bid) => {
                const winningRank = winningRanks.get(bid.id);
                return (
                <li key={bid.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-semibold">
                      <span className="truncate">{bid.username}</span>
                      {winningRank && <span className="rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold text-ink">Winner #{winningRank}</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-ink/45">{formatTime(bid.created_at)}</p>
                    {bid.email && <p className="mt-0.5 truncate text-xs text-ink/45">{bid.email}</p>}
                  </div>
                  <strong className="text-sm tabular-nums">{formatMoney(bid.amount, auction.currency)}</strong>
                </li>
                );
              })}
            </ol>
          ) : (
            <div className="mt-5 rounded-xl border border-dashed border-ink/15 p-7 text-center text-sm text-ink/50">No accepted bids for this product yet.</div>
          )}
        </aside>
      </div>
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
