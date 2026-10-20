"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AuctionTimer } from "@/components/auction-timer";
import { moveAuctionInQueue, orderAuctions, selectCurrentAuction } from "@/lib/auction-queue";
import { AUCTION_START_COUNTDOWN_SECONDS } from "@/lib/auction-timer";
import { selectWinningBids } from "@/lib/auction-winners";
import { summarizeDonations, type DonationTotal } from "@/lib/donation-summary";
import { browserDemoMode } from "@/lib/deployment-mode";
import {
  clearDemoParticipantId,
  createDemoAuctionState,
  DEMO_STATE_KEY,
  loadDemoAuctionState,
  saveDemoAuctionState,
  type DemoAuctionState,
} from "@/lib/demo-auction";
import { formatMoney, formatTime } from "@/lib/format";
import { getSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase-browser";
import type {
  Auction,
  WinnerReportEntry,
} from "@/lib/types";

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
  timerDurationMinutes: string;
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
  timerDurationMinutes: "2",
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
    timerDurationMinutes: String(auction.timer_duration_seconds / 60),
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
    timer_duration_seconds: Number(auction.timer_duration_seconds ?? 120),
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

function mapWinnerReport(rows: Array<Record<string, unknown>> = []): WinnerReportEntry[] {
  return rows.map((row) => ({
    auction_id: String(row.auction_id),
    title: String(row.title),
    sort_order: Number(row.sort_order),
    winner_rank: Number(row.winner_rank),
    participant_id: String(row.participant_id),
    username: String(row.username),
    email: String(row.email ?? ""),
    winning_amount: Number(row.winning_amount),
    currency: String(row.currency),
    finalized_at: String(row.finalized_at),
    payment_status: String(row.payment_status) as WinnerReportEntry["payment_status"],
    paid_at: row.paid_at ? String(row.paid_at) : null,
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
  const configured = hasSupabaseBrowserConfig();
  const demoMode = browserDemoMode(configured);
  if (demoMode) return <DemoAuctionEditor />;
  if (!configured) return <AdminNotConfigured />;
  return <ConnectedAdminPanel />;
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
      <p className="mt-4 leading-7 text-ink/60">Enter the server-configured administrator secret to manage the event queue.</p>
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
  const [winnerReport, setWinnerReport] = useState<WinnerReportEntry[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const selectedAuctionIdRef = useRef<string | null>(null);
  const loadRequestRef = useRef(0);
  const realtimeRefreshTimerRef = useRef<number | null>(null);
  const suppressAuctionRefreshUntilRef = useRef(0);

  const load = useCallback(async (auctionId?: string, preserveForm = false) => {
    const requestId = ++loadRequestRef.current;
    if (auctionId && !preserveForm) selectedAuctionIdRef.current = auctionId;
    try {
      const query = auctionId ? `?auctionId=${encodeURIComponent(auctionId)}` : "";
      const response = await fetch(`/api/admin/auction${query}`, { cache: "no-store" });
      const data = (await response.json()) as {
        auctions?: Auction[];
        auction?: Auction | null;
        bids?: Array<Record<string, unknown>>;
        donationTotals?: Array<Record<string, unknown>>;
        winnerReport?: Array<Record<string, unknown>>;
        error?: string;
      };
      if (response.status === 401) {
        onSignedOut();
        return;
      }
      if (!response.ok) throw new Error(data.error ?? "Could not load the event queue.");
      if (requestId !== loadRequestRef.current) return;
      const nextAuctions = orderAuctions((data.auctions ?? []).map(normalizedAuction));
      const selected = data.auction ? normalizedAuction(data.auction) : null;
      selectedAuctionIdRef.current = selected?.id ?? null;
      setAuctions(nextAuctions);
      setAuction(selected);
      if (!preserveForm) setForm(selected ? formFromAuction(selected) : emptyForm);
      setBids(mapAdminBids(data.bids));
      setDonationTotals(mapDonationTotals(data.donationTotals));
      setWinnerReport(mapWinnerReport(data.winnerReport));
    } catch (loadError) {
      if (requestId !== loadRequestRef.current) return;
      setMessage({
        kind: "error",
        text: loadError instanceof Error ? loadError.message : "Could not load the event queue.",
      });
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  }, [onSignedOut]);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  useEffect(() => {
    const refresh = () => {
      if (Date.now() < suppressAuctionRefreshUntilRef.current) return;
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
      }
      realtimeRefreshTimerRef.current = window.setTimeout(() => {
        realtimeRefreshTimerRef.current = null;
        void load(selectedAuctionIdRef.current ?? undefined, true);
      }, 400);
    };
    const interval = window.setInterval(
      () => void load(selectedAuctionIdRef.current ?? undefined, true),
      30_000,
    );
    const client = getSupabaseBrowserClient();
    const channel = client
      .channel("admin-auction-dashboard")
      .on("postgres_changes", { event: "*", schema: "public", table: "auctions" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "bids" }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "participants" }, refresh)
      .subscribe();

    return () => {
      window.clearInterval(interval);
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
      void client.removeChannel(channel);
    };
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
      if (!response.ok) throw new Error(data.error ?? "Could not save the event.");
      if (data.auction) await load(data.auction.id);
      setMessage({ kind: "success", text: creating ? "Event added to the queue." : "Event details saved." });
    } catch (saveError) {
      setMessage({ kind: "error", text: saveError instanceof Error ? saveError.message : "Could not save the event." });
    } finally {
      setSaving(false);
    }
  }

  async function importEvents(file: File) {
    if (saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const payload = new FormData();
      payload.set("file", file);
      const response = await fetch("/api/admin/auction-import", {
        method: "POST",
        body: payload,
      });
      const data = (await response.json()) as {
        imported?: number;
        auctions?: Auction[];
        error?: string;
        rowErrors?: string[];
      };
      if (response.status === 401) {
        onSignedOut();
        return;
      }
      if (!response.ok) {
        const details = data.rowErrors?.length ? ` ${data.rowErrors.join(" ")}` : "";
        throw new Error(`${data.error ?? "Could not import the events."}${details}`);
      }
      const firstImportedId = data.auctions?.[0]?.id;
      await load(firstImportedId);
      const imported = data.imported ?? 0;
      setMessage({
        kind: "success",
        text: `${imported} event${imported === 1 ? "" : "s"} imported and added to the queue.`,
      });
    } catch (importError) {
      setMessage({
        kind: "error",
        text: importError instanceof Error ? importError.message : "Could not import the events.",
      });
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
      setMessage({
        kind: "success",
        text: action === "start"
          ? `Start countdown is running. Bidding opens in ${AUCTION_START_COUNTDOWN_SECONDS} seconds.`
          : "Bidding for this event has ended.",
      });
    } catch (statusError) {
      setMessage({ kind: "error", text: statusError instanceof Error ? statusError.message : "Could not update the auction status." });
    } finally {
      setSaving(false);
    }
  }

  async function queueAction(action: "move_up" | "move_down" | "duplicate") {
    if (!auction || saving) return;
    const isMove = action === "move_up" || action === "move_down";
    const previousAuctions = auctions;
    const previousAuction = auction;
    if (isMove) {
      suppressAuctionRefreshUntilRef.current = Number.POSITIVE_INFINITY;
      if (realtimeRefreshTimerRef.current !== null) {
        window.clearTimeout(realtimeRefreshTimerRef.current);
        realtimeRefreshTimerRef.current = null;
      }
      const optimisticAuctions = moveAuctionInQueue(
        auctions,
        auction.id,
        action === "move_up" ? -1 : 1,
      );
      setAuctions(optimisticAuctions);
      setAuction(optimisticAuctions.find((item) => item.id === auction.id) ?? auction);
    }
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/auction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: auction.id, action }),
      });
      const data = (await response.json()) as {
        auction?: Auction;
        auctions?: Auction[];
        error?: string;
      };
      if (!response.ok) throw new Error(data.error ?? "Could not update the event queue.");
      if (isMove && data.auctions) {
        const canonicalAuctions = orderAuctions(data.auctions.map(normalizedAuction));
        setAuctions(canonicalAuctions);
        setAuction(canonicalAuctions.find((item) => item.id === auction.id) ?? auction);
      } else {
        await load(data.auction?.id ?? auction.id);
      }
      setMessage({
        kind: "success",
        text: action === "duplicate" ? "A copy was added to the queue." : "Queue order updated.",
      });
    } catch (actionError) {
      if (isMove) {
        setAuctions(previousAuctions);
        setAuction(previousAuction);
      }
      setMessage({ kind: "error", text: actionError instanceof Error ? actionError.message : "Could not update the event queue." });
    } finally {
      if (isMove) suppressAuctionRefreshUntilRef.current = Date.now() + 750;
      setSaving(false);
    }
  }

  async function deleteAuction() {
    if (!auction || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch("/api/admin/auction", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: auction.id }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not delete the event.");
      await load();
      setMessage({ kind: "success", text: "Event deleted from the queue." });
    } catch (deleteError) {
      setMessage({ kind: "error", text: deleteError instanceof Error ? deleteError.message : "Could not delete the event." });
    } finally {
      setSaving(false);
    }
  }

  async function signOut() {
    await fetch("/api/admin/session", { method: "DELETE" });
    onSignedOut();
  }

  function selectAuction(id: string) {
    selectedAuctionIdRef.current = id;
    const selected = auctions.find((item) => item.id === id);
    if (selected) {
      setAuction(selected);
      setForm(formFromAuction(selected));
      setBids([]);
      setMessage(null);
    }
    void load(id);
  }

  if (loading) return <div className="panel h-[34rem] animate-pulse" />;

  return (
    <AuctionManagerView
      auctions={auctions}
      auction={auction}
      bids={bids}
      donationTotals={donationTotals}
      winnerReport={winnerReport}
      form={form}
      message={message}
      saving={saving}
      onFormChange={setForm}
      onSelect={selectAuction}
      onNew={() => {
        selectedAuctionIdRef.current = null;
        loadRequestRef.current += 1;
        setAuction(null);
        setForm(emptyForm);
        setBids([]);
        setMessage(null);
      }}
      onSave={save}
      onStatusChange={(action) => void changeStatus(action)}
      onQueueAction={(action) => void queueAction(action)}
      onDelete={() => void deleteAuction()}
      onImport={(file) => void importEvents(file)}
      onRefresh={() => void load(auction?.id)}
      onSignOut={() => void signOut()}
    />
  );
}

function DemoAuctionEditor() {
  const [demoState, setDemoState] = useState<DemoAuctionState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
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
  const winnerReport = useMemo<WinnerReportEntry[]>(() => {
    if (!demoState) return [];
    return orderAuctions(demoState.auctions).flatMap((item) => {
      if (item.status !== "ended") return [];
      const itemBids = demoState.bids.filter((bid) => bid.auction_id === item.id);
      return selectWinningBids(itemBids, item.winner_count).map((bid) => {
        const participant = demoState.participants.find((entry) => entry.id === bid.participant_id);
        return {
          auction_id: item.id,
          title: item.title,
          sort_order: item.sort_order,
          winner_rank: bid.rank,
          participant_id: bid.participant_id,
          username: bid.username,
          email: participant?.email ?? "",
          winning_amount: bid.amount,
          currency: item.currency,
          finalized_at: item.ends_at ?? bid.created_at,
          payment_status: "pending" as const,
          paid_at: null,
        };
      });
    });
  }, [demoState]);

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
      if (event.key === DEMO_STATE_KEY) load(selectedIdRef.current ?? undefined);
    };
    window.addEventListener("storage", syncAcrossTabs);
    return () => {
      window.clearTimeout(initialLoad);
      window.removeEventListener("storage", syncAcrossTabs);
    };
  }, [load]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  const commitState = useCallback((next: DemoAuctionState) => {
    setDemoState(next);
    saveDemoAuctionState(next);
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!demoState) return;
    if (selected?.status === "active") {
      setMessage({ kind: "error", text: "Event settings cannot change while bidding is live." });
      return;
    }
    setMessage(null);
    const startingPrice = Number(form.startingPrice);
    const minimumIncrement = Number(form.minimumIncrement);
    const maximumDifference = form.maximumDifference.trim() === ""
      ? null
      : Number(form.maximumDifference);
    const winnerCount = Number(form.winnerCount);
    const timerDurationSeconds = Number(form.timerDurationMinutes) * 60;
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
      winnerCount > 1000 ||
      !Number.isSafeInteger(timerDurationSeconds) ||
      timerDurationSeconds < 30 ||
      timerDurationSeconds > 86_400
    ) {
      setMessage({
        kind: "error",
        text: "Enter valid pricing details and a timer duration between 0.5 and 1,440 minutes. The optional maximum increase must be at least the minimum step.",
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
        timer_duration_seconds: timerDurationSeconds,
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
        timer_duration_seconds: timerDurationSeconds,
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
    setMessage({ kind: "success", text: selected ? "Demo event saved." : "Demo event added to the queue." });
  }

  function changeStatus(action: "start" | "end") {
    if (!demoState || !selected) return;
    const now = new Date().toISOString();
    const scheduledStart = new Date(
      Date.now() + AUCTION_START_COUNTDOWN_SECONDS * 1000,
    ).toISOString();
    const auctions = demoState.auctions.map((item) => {
      if (action === "start" && item.status === "active" && item.id !== selected.id) {
        return { ...item, status: "ended" as const, ends_at: now };
      }
      if (item.id !== selected.id) return item;
      return action === "start"
        ? { ...item, status: "active" as const, starts_at: scheduledStart, ends_at: null }
        : { ...item, status: "ended" as const, ends_at: now };
    });
    commitState({ ...demoState, auctions });
    setMessage({
      kind: "success",
      text: action === "start"
        ? `Start countdown is running. Bidding opens in ${AUCTION_START_COUNTDOWN_SECONDS} seconds.`
        : "Demo bidding has ended.",
    });
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

  function queueAction(action: "move_up" | "move_down" | "duplicate") {
    if (!demoState || !selected) return;
    if (action === "duplicate") {
      const copy: Auction = {
        ...selected,
        id: crypto.randomUUID(),
        title: `${selected.title} (copy)`.slice(0, 120),
        status: "upcoming",
        starts_at: null,
        ends_at: null,
        sort_order: Math.max(0, ...demoState.auctions.map((item) => item.sort_order)) + 1,
        created_at: new Date().toISOString(),
      };
      commitState({ ...demoState, auctions: [...demoState.auctions, copy] });
      setSelectedId(copy.id);
      setForm(formFromAuction(copy));
      setMessage({ kind: "success", text: "A demo copy was added to the queue." });
      return;
    }

    const ordered = orderAuctions(demoState.auctions);
    const index = ordered.findIndex((item) => item.id === selected.id);
    const targetIndex = action === "move_up" ? index - 1 : index + 1;
    if (index < 0 || targetIndex < 0 || targetIndex >= ordered.length) return;
    const currentOrder = ordered[index].sort_order;
    ordered[index] = { ...ordered[index], sort_order: ordered[targetIndex].sort_order };
    ordered[targetIndex] = { ...ordered[targetIndex], sort_order: currentOrder };
    commitState({ ...demoState, auctions: ordered });
    setMessage({ kind: "success", text: "Demo queue order updated." });
  }

  function deleteAuction() {
    if (!demoState || !selected) return;
    const hasActivity = demoState.participants.some((item) => item.auction_id === selected.id)
      || demoState.bids.some((item) => item.auction_id === selected.id);
    if (selected.status !== "upcoming" || hasActivity) {
      setMessage({ kind: "error", text: "Only an upcoming event without registrations or bids can be deleted." });
      return;
    }
    const next = { ...demoState, auctions: demoState.auctions.filter((item) => item.id !== selected.id) };
    const current = selectCurrentAuction(next.auctions);
    commitState(next);
    setSelectedId(current?.id ?? null);
    setForm(current ? formFromAuction(current) : emptyForm);
    setMessage({ kind: "success", text: "Demo event deleted." });
  }

  if (!demoState) return <div className="panel h-[34rem] animate-pulse" />;

  return (
    <AuctionManagerView
      auctions={orderAuctions(demoState.auctions)}
      auction={selected}
      bids={bids}
      donationTotals={donationTotals}
      winnerReport={winnerReport}
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
      onQueueAction={queueAction}
      onDelete={deleteAuction}
      onRefresh={() => load(selectedId ?? undefined)}
    />
  );
}

function AuctionManagerView({
  auctions,
  auction,
  bids,
  donationTotals,
  winnerReport,
  form,
  message,
  saving,
  demo = false,
  onFormChange,
  onSelect,
  onNew,
  onSave,
  onStatusChange,
  onQueueAction,
  onDelete,
  onImport,
  onRefresh,
  onSignOut,
  onReset,
}: {
  auctions: Auction[];
  auction: Auction | null;
  bids: AdminBid[];
  donationTotals: DonationTotal[];
  winnerReport: WinnerReportEntry[];
  form: FormState;
  message: Message;
  saving: boolean;
  demo?: boolean;
  onFormChange: (form: FormState) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onStatusChange: (action: "start" | "end") => void;
  onQueueAction: (action: "move_up" | "move_down" | "duplicate") => void;
  onDelete: () => void;
  onImport?: (file: File) => void;
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
  const selectedWinnerReport = auction
    ? winnerReport.filter((entry) => entry.auction_id === auction.id)
    : [];
  const rulesLocked = Boolean(auction && auction.status !== "upcoming");
  const contentLocked = auction?.status === "active";
  const selectedIndex = auction ? auctions.findIndex((item) => item.id === auction.id) : -1;
  const [confirmation, setConfirmation] = useState<"start" | "end" | "delete" | null>(null);

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
          <span className="min-w-0"><strong>Local demo:</strong> Events and bids are stored only in this browser.</span>
          <button className="font-bold underline underline-offset-4" onClick={onReset}>Reset demo</button>
        </div>
      )}

      <section className="panel p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.16em] text-forest">Auction sequence</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-[-.03em]">Event queue</h1>
          </div>
          <div className="flex w-full flex-wrap items-center gap-x-4 gap-y-2 sm:w-auto sm:justify-end">
            {!demo && <a className="text-link inline-flex min-h-11 items-center" href="/api/admin/auction-import">Download Excel template</a>}
            {!demo && onImport && (
              <label className={`text-link inline-flex min-h-11 cursor-pointer items-center ${saving ? "pointer-events-none opacity-50" : ""}`}>
                {saving ? "Working…" : "Import Excel"}
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  className="sr-only"
                  disabled={saving}
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0] ?? null;
                    event.currentTarget.value = "";
                    if (file) onImport(file);
                  }}
                />
              </label>
            )}
            {!demo && <a className="text-link inline-flex min-h-11 items-center" href="/api/admin/export">Export winners</a>}
            {onSignOut && <button className="text-link min-h-11" onClick={onSignOut}>Sign out</button>}
            <button className="btn-primary w-full sm:w-auto" onClick={onNew}>Add event</button>
          </div>
        </div>
        {auctions.length ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {auctions.map((item, index) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={auction?.id === item.id}
                aria-current={auction?.id === item.id ? "true" : undefined}
                className={`cursor-pointer rounded-2xl border p-4 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-lime ${auction?.id === item.id ? "border-forest bg-forest text-white" : "border-ink/10 bg-white/70 hover:border-forest hover:shadow-md"}`}
                onClick={() => onSelect(item.id)}
              >
                <span className={`text-xs font-bold uppercase tracking-[.12em] ${auction?.id === item.id ? "text-white/55" : "text-ink/45"}`}>Event {index + 1}</span>
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
          <div className="mt-5 rounded-xl border border-dashed border-ink/15 p-7 text-center text-sm text-ink/50">No events yet. Add the first event.</div>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section className="panel p-4 sm:p-8">
          <div className="mb-7 flex flex-wrap items-start justify-between gap-5">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.16em] text-forest">Event settings</p>
              <h2 className="mt-2 text-3xl font-semibold">{auction ? "Edit event" : "Add an event"}</h2>
            </div>
            {auction && (
              <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end">
                <button type="button" className="btn-secondary w-full sm:w-auto" disabled={saving || selectedIndex <= 0} onClick={() => onQueueAction("move_up")}>Move up</button>
                <button type="button" className="btn-secondary w-full sm:w-auto" disabled={saving || selectedIndex >= auctions.length - 1} onClick={() => onQueueAction("move_down")}>Move down</button>
                <button type="button" className="btn-secondary w-full sm:w-auto" disabled={saving} onClick={() => onQueueAction("duplicate")}>Duplicate</button>
                {auction.status === "upcoming" && (
                  <button type="button" className="btn-danger w-full sm:w-auto" disabled={saving} onClick={() => setConfirmation("delete")}>Delete</button>
                )}
              </div>
            )}
          </div>

          {auction && (
            <AuctionTimer
              startsAt={auction.starts_at}
              durationSeconds={auction.timer_duration_seconds}
              status={auction.status}
              compact
              className="mb-7"
            />
          )}

          {rulesLocked && (
            <div className="notice notice-info mb-6" role="status">
              {contentLocked
                ? "This event is live. All settings are locked until bidding has ended."
                : "Auction rules stay locked after the event ends. Name, description, and image can be updated."}
            </div>
          )}

          <form key={auctionKey} onSubmit={onSave} className="space-y-5">
            <div>
              <label className="field-label" htmlFor="title">Event name</label>
              <input id="title" name="title" className="field" value={form.title} onChange={(event) => updateField("title", event.target.value)} readOnly={contentLocked} aria-disabled={contentLocked} maxLength={120} required />
            </div>
            <div>
              <label className="field-label" htmlFor="description">Description</label>
              <textarea id="description" name="description" className="field min-h-32 resize-y" value={form.description} onChange={(event) => updateField("description", event.target.value)} readOnly={contentLocked} aria-disabled={contentLocked} maxLength={4000} />
            </div>
            <div>
              <label className="field-label" htmlFor="image">Event image</label>
              <input
                key={auctionKey}
                id="image"
                name="image"
                type="file"
                accept=".png,.jpg,.jpeg,image/png,image/jpeg"
                className="field text-sm file:mr-2 file:rounded-full file:border-0 file:bg-forest file:px-3 file:py-2 file:text-sm file:font-bold file:text-white sm:file:mr-4 sm:file:px-4"
                disabled={contentLocked}
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
                PNG or JPEG, maximum {demo ? "1 MB in demo mode" : "4 MB"}. 16:9 is recommended, for example an exported PowerPoint slide. Choosing no file keeps the current image.
              </p>
              {imagePreviewUrl && (
                <div className="mt-3 aspect-video w-full max-w-2xl overflow-hidden rounded-2xl border border-ink/10 bg-mist">
                  <img src={imagePreviewUrl} alt="Event preview" className="h-full w-full object-contain" />
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="field-label" htmlFor="starting-price">Starting price</label>
                <input id="starting-price" name="startingPrice" type="number" min="0" step="0.01" className="field" value={form.startingPrice} onChange={(event) => updateField("startingPrice", event.target.value)} readOnly={rulesLocked} aria-disabled={rulesLocked} required />
              </div>
              <div>
                <label className="field-label" htmlFor="increment">Minimum step</label>
                <input id="increment" name="minimumIncrement" type="number" min="0.01" step="0.01" className="field" value={form.minimumIncrement} onChange={(event) => updateField("minimumIncrement", event.target.value)} readOnly={rulesLocked} aria-disabled={rulesLocked} required />
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
                  readOnly={rulesLocked}
                  aria-disabled={rulesLocked}
                  placeholder="Unlimited"
                />
              </div>
              <div>
                <label className="field-label" htmlFor="winner-count">Winning bidders</label>
                <input id="winner-count" name="winnerCount" type="number" min="1" max="1000" step="1" className="field" value={form.winnerCount} onChange={(event) => updateField("winnerCount", event.target.value)} readOnly={rulesLocked} aria-disabled={rulesLocked} required />
              </div>
              <div>
                <label className="field-label" htmlFor="timer-duration">Timer duration (minutes)</label>
                <input
                  id="timer-duration"
                  name="timerDurationMinutes"
                  type="number"
                  min="0.5"
                  max="1440"
                  step="0.5"
                  className="field"
                  value={form.timerDurationMinutes}
                  onChange={(event) => updateField("timerDurationMinutes", event.target.value)}
                  readOnly={rulesLocked}
                  aria-disabled={rulesLocked}
                  required
                />
              </div>
              <div>
                <label className="field-label" htmlFor="currency">Currency</label>
                <input id="currency" name="currency" className="field uppercase" value={form.currency} onChange={(event) => updateField("currency", event.target.value.toUpperCase())} readOnly={rulesLocked} aria-disabled={rulesLocked} minLength={3} maxLength={3} required />
              </div>
            </div>
            <p className="text-xs leading-5 text-ink/45">
              Maximum increase is the largest allowed difference from the current highest bid. Leave it blank for no limit. The timer starts when this event goes live and never ends bidding automatically.
            </p>
            {message && <div className={`notice ${message.kind === "error" ? "notice-error" : "notice-success"}`} role="status">{message.text}</div>}
            <div className="grid gap-3 border-t border-ink/10 pt-6 sm:flex sm:flex-wrap sm:items-center">
              <button className="btn-primary w-full sm:w-auto" disabled={saving || contentLocked}>{saving ? "Saving…" : auction ? "Save changes" : "Add to queue"}</button>
              {auction?.status === "upcoming" && (
                <button type="button" className="btn-secondary w-full sm:w-auto" disabled={saving} onClick={() => setConfirmation("start")}>Start this event</button>
              )}
              {auction?.status === "active" && (
                <button type="button" className="btn-danger w-full sm:w-auto" disabled={saving} onClick={() => setConfirmation("end")}>End bidding</button>
              )}
            </div>
          </form>
        </section>

        <aside className="panel self-start p-4 sm:p-6">
          <div className="flex flex-col items-start gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[.16em] text-ink/45">Selected event</p>
              <h2 className="mt-1 text-2xl font-semibold tracking-[-.03em]">Bid history</h2>
              {auction && (
                <div className="mt-1 space-y-1 text-xs text-ink/45">
                  <p>Top {auction.winner_count} distinct {auction.winner_count === 1 ? "bidder wins" : "bidders win"}</p>
                  <p className="font-semibold text-forest">
                    Donation total: {formatMoney(selectedDonationTotal?.total_bid_amount ?? 0, auction.currency)} from {selectedDonationTotal?.bid_count ?? 0} winning {(selectedDonationTotal?.bid_count ?? 0) === 1 ? "bid" : "bids"}
                  </p>
                </div>
              )}
            </div>
            <button className="text-link min-h-11" onClick={onRefresh}>Refresh</button>
          </div>
          {bids.length && auction ? (
            <ol className="mt-5 divide-y divide-ink/10">
              {bids.map((bid) => {
                const winningRank = winningRanks.get(bid.id);
                return (
                <li key={bid.id} className="flex items-start justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="flex min-w-0 flex-wrap items-center gap-2 text-sm font-semibold">
                      <span className="max-w-full truncate">{bid.username}</span>
                      {winningRank && <span className="shrink-0 rounded-full bg-lime px-2 py-0.5 text-[10px] font-bold text-ink">Winner #{winningRank}</span>}
                    </p>
                    <p className="mt-0.5 text-xs text-ink/45">{formatTime(bid.created_at)}</p>
                    {bid.email && <p className="mt-0.5 truncate text-xs text-ink/45">{bid.email}</p>}
                  </div>
                  <strong className="shrink-0 whitespace-nowrap text-right text-sm tabular-nums">{formatMoney(bid.amount, auction.currency)}</strong>
                </li>
                );
              })}
            </ol>
          ) : (
            <div className="mt-5 rounded-xl border border-dashed border-ink/15 p-7 text-center text-sm text-ink/50">No accepted bids for this event yet.</div>
          )}

          {auction?.status === "ended" && (
            <div className="mt-7 border-t border-ink/10 pt-6">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[.16em] text-ink/45">Final result</p>
                  <h3 className="mt-1 text-lg font-semibold">Winners</h3>
                </div>
                {!demo && <a className="text-link text-sm" href="/api/admin/export">CSV export</a>}
              </div>
              {selectedWinnerReport.length ? (
                <ul className="mt-4 divide-y divide-ink/10">
                  {selectedWinnerReport.map((entry) => (
                    <li key={entry.participant_id} className="py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">#{entry.winner_rank} {entry.username}</p>
                          <p className="truncate text-xs text-ink/45">{entry.email}</p>
                          <p className="mt-1 text-xs font-semibold text-forest">{formatMoney(entry.winning_amount, entry.currency)}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-ink/50">This event ended without a winning bid.</p>
              )}
            </div>
          )}
        </aside>
      </div>

      {confirmation && auction && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/55 p-4"
          role="presentation"
          onKeyDown={(event) => {
            if (event.key === "Escape") setConfirmation(null);
          }}
        >
          <section
            className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-lg bg-white p-5 shadow-2xl sm:p-6"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="confirmation-title"
            aria-describedby="confirmation-description"
          >
            <h2 id="confirmation-title" className="text-xl font-semibold">
              {confirmation === "start" ? "Start this event?" : confirmation === "end" ? "End bidding now?" : "Delete this event?"}
            </h2>
            <p id="confirmation-description" className="mt-3 leading-6 text-ink/60">
              {confirmation === "start"
                ? `Starting this event ends any currently active event, locks its auction rules, and begins a public ${AUCTION_START_COUNTDOWN_SECONDS}-second countdown before bidding opens.`
                : confirmation === "end"
                  ? "The final winners will be recorded immediately. This action cannot be reversed."
                  : "Only an upcoming event without registrations or bids can be deleted."}
            </p>
            <div className="mt-6 grid gap-3 sm:flex sm:justify-end">
              <button type="button" className="btn-secondary w-full sm:w-auto" autoFocus onClick={() => setConfirmation(null)}>Cancel</button>
              <button
                type="button"
                className={`${confirmation === "start" ? "btn-primary" : "btn-danger"} w-full sm:w-auto`}
                onClick={() => {
                  const action = confirmation;
                  setConfirmation(null);
                  if (action === "delete") onDelete();
                  else onStatusChange(action);
                }}
              >
                {confirmation === "start" ? "Start event" : confirmation === "end" ? "End bidding" : "Delete event"}
              </button>
            </div>
          </section>
        </div>
      )}
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
