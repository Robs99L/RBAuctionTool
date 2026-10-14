"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { minimumNextBid, parseBidAmount } from "@/lib/bid-rules";
import { formatMoney, formatTime } from "@/lib/format";
import {
  getSupabaseBrowserClient,
  hasSupabaseBrowserConfig,
} from "@/lib/supabase-browser";
import type { Auction, AuctionStatus, Bid, Participant } from "@/lib/types";

type ConnectionState = "connecting" | "live" | "offline";

function normalizeAuction(value: Record<string, unknown>): Auction {
  return {
    ...(value as unknown as Auction),
    starting_price: Number(value.starting_price),
    minimum_increment: Number(value.minimum_increment),
  };
}

function participantName(value: unknown) {
  if (Array.isArray(value)) return (value[0] as { username?: string } | undefined)?.username;
  return (value as { username?: string } | null)?.username;
}

function effectiveStatus(auction: Auction): AuctionStatus {
  if (
    auction.status === "active" &&
    auction.ends_at &&
    new Date(auction.ends_at).getTime() <= Date.now()
  ) {
    return "ended";
  }
  return auction.status;
}

export function AuctionApp() {
  const configured = hasSupabaseBrowserConfig();
  const client = useMemo(
    () => (configured ? getSupabaseBrowserClient() : null),
    [configured],
  );
  const [auction, setAuction] = useState<Auction | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [bids, setBids] = useState<Bid[]>([]);
  const [participantCount, setParticipantCount] = useState(0);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const auctionId = auction?.id;

  const refreshDashboard = useCallback(async () => {
    if (!client || !auctionId) return;
    const [bidResult, countResult, auctionResult] = await Promise.all([
      client
        .from("bids")
        .select("id, auction_id, participant_id, amount, created_at, participants(username)")
        .eq("auction_id", auctionId)
        .order("created_at", { ascending: false })
        .limit(30),
      client
        .from("participants")
        .select("id", { count: "exact", head: true })
        .eq("auction_id", auctionId),
      client.from("auctions").select("*").eq("id", auctionId).single(),
    ]);

    if (bidResult.error) throw bidResult.error;
    if (countResult.error) throw countResult.error;
    if (auctionResult.error) throw auctionResult.error;

    const normalized = (bidResult.data ?? []).map((row) => ({
      id: row.id,
      auction_id: row.auction_id,
      participant_id: row.participant_id,
      amount: Number(row.amount),
      created_at: row.created_at,
      username: participantName(row.participants) ?? "Unknown participant",
    }));
    setBids(normalized);
    setParticipantCount(countResult.count ?? 0);
    setAuction(normalizeAuction(auctionResult.data));
  }, [auctionId, client]);

  useEffect(() => {
    if (!client) return;
    let active = true;

    async function load() {
      setLoading(true);
      const { data, error: loadError } = await client!
        .from("auctions")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!active) return;
      if (loadError) {
        setError(loadError.message);
      } else if (data) {
        setAuction(normalizeAuction(data));
      }
      setLoading(false);
    }

    void load();
    return () => {
      active = false;
    };
  }, [client]);

  useEffect(() => {
    if (!client || !auctionId) return;
    let active = true;

    async function restoreParticipant() {
      const { data: sessionData } = await client!.auth.getSession();
      if (!sessionData.session || !active) return;
      const { data } = await client!.rpc("get_my_participant", {
        p_auction_id: auctionId,
      });
      if (active && data?.[0]) setParticipant(data[0] as Participant);
    }

    void restoreParticipant();
    return () => {
      active = false;
    };
  }, [auctionId, client]);

  useEffect(() => {
    if (!client || !auctionId) return;
    let active = true;
    const initialRefresh = window.setTimeout(() => {
      void refreshDashboard().catch((refreshError: unknown) => {
        if (active) {
          setError(refreshError instanceof Error ? refreshError.message : "Could not load bids.");
        }
      });
    }, 0);

    const refresh = () => {
      void refreshDashboard().catch(() => setConnection("offline"));
    };
    const channel = client
      .channel(`auction:${auctionId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "bids", filter: `auction_id=eq.${auctionId}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "participants", filter: `auction_id=eq.${auctionId}` },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "auctions", filter: `id=eq.${auctionId}` },
        refresh,
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") setConnection("live");
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          setConnection("offline");
        }
      });

    return () => {
      active = false;
      window.clearTimeout(initialRefresh);
      void client.removeChannel(channel);
    };
  }, [auctionId, client, refreshDashboard]);

  if (!configured) return <SetupRequired />;
  if (loading) return <LoadingScreen />;
  if (error && !auction) return <ErrorScreen message={error} />;
  if (!auction) return <NoAuction />;

  return (
    <main className="min-h-screen bg-cream">
      <Header connection={connection} participantCount={participantCount} />
      {participant ? (
        <AuctionRoom
          auction={auction}
          participant={participant}
          bids={bids}
          connection={connection}
          refreshDashboard={refreshDashboard}
        />
      ) : (
        <JoinExperience auction={auction} onJoined={setParticipant} client={client!} />
      )}
    </main>
  );
}

function Header({
  connection,
  participantCount,
}: {
  connection: ConnectionState;
  participantCount: number;
}) {
  return (
    <header className="border-b border-ink/10 bg-cream/90 px-4 py-4 backdrop-blur sm:px-8">
      <div className="mx-auto flex max-w-7xl items-center justify-between">
        <div className="brand-lockup">
          <span className="brand-mark">A</span>
          <span>Live Auction</span>
        </div>
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden text-sm text-ink/55 sm:inline">
            {participantCount} {participantCount === 1 ? "participant" : "participants"}
          </span>
          <span className="status-pill" title={connection === "live" ? "Realtime updates connected" : "Realtime connection status"}>
            <span className={`status-dot ${connection === "live" ? "active" : ""}`} />
            {connection === "live" ? "Live" : connection === "connecting" ? "Connecting" : "Reconnecting"}
          </span>
        </div>
      </div>
    </header>
  );
}

function JoinExperience({ auction, onJoined, client }: {
  auction: Auction;
  onJoined: (participant: Participant) => void;
  client: ReturnType<typeof getSupabaseBrowserClient>;
}) {
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const status = effectiveStatus(auction);

  async function join(event: FormEvent) {
    event.preventDefault();
    const cleanUsername = username.trim();
    if (!cleanUsername || cleanUsername.length > 32) {
      setMessage("Enter a username between 1 and 32 characters.");
      return;
    }

    setSubmitting(true);
    setMessage("");
    try {
      const { data: sessionData } = await client.auth.getSession();
      if (!sessionData.session) {
        const { error: authError } = await client.auth.signInAnonymously();
        if (authError) throw new Error(
          authError.message.includes("Anonymous sign-ins are disabled")
            ? "Anonymous sign-ins are disabled. Enable them in Supabase Authentication settings."
            : authError.message,
        );
      }
      const { data, error } = await client.rpc("join_auction", {
        p_auction_id: auction.id,
        p_username: cleanUsername,
      });
      if (error) throw error;
      if (!data?.[0]) throw new Error("The auction could not be joined.");
      onJoined(data[0] as Participant);
    } catch (joinError) {
      setMessage(joinError instanceof Error ? joinError.message : "Could not join the auction.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto grid min-h-[calc(100vh-65px)] max-w-7xl items-stretch lg:grid-cols-[1.08fr_.92fr]">
      <section className="relative min-h-[42vh] overflow-hidden bg-ink lg:min-h-0">
        {auction.image_url ? (
          <img src={auction.image_url} alt={auction.title} className="absolute inset-0 h-full w-full object-cover opacity-80" />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_35%,#557867,#18201d_68%)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-ink via-ink/10 to-transparent" />
        <div className="absolute inset-x-0 bottom-0 p-6 text-white sm:p-10">
          <span className="status-pill mb-4 border-white/20 bg-ink/45 text-white">
            <span className={`status-dot ${status}`} />{status}
          </span>
          <p className="mb-2 text-xs font-bold uppercase tracking-[.18em] text-white/65">Current lot</p>
          <h1 className="max-w-2xl text-3xl font-semibold tracking-[-.04em] sm:text-5xl">{auction.title}</h1>
          <p className="mt-4 max-w-xl leading-7 text-white/72">{auction.description}</p>
        </div>
      </section>

      <section className="flex items-center px-5 py-10 sm:px-12 lg:px-16">
        <div className="w-full max-w-lg">
          <p className="mb-4 text-sm font-bold uppercase tracking-[.16em] text-forest">You’re invited</p>
          <h2 className="text-4xl font-semibold tracking-[-.045em] sm:text-5xl">Join the bidding.</h2>
          <p className="mt-5 max-w-md text-base leading-7 text-ink/60">
            Choose a display name to enter this auction. No account setup is needed.
          </p>
          <form className="mt-9" onSubmit={join}>
            <label className="field-label" htmlFor="username">Display name</label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                id="username"
                className="field min-h-12 flex-1"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="e.g. Mia K."
                maxLength={32}
                autoComplete="nickname"
                autoFocus
                disabled={status === "ended"}
              />
              <button className="btn-primary min-w-32" disabled={submitting || status === "ended"}>
                {submitting ? "Joining…" : "Join auction"}
              </button>
            </div>
            {message && <div className="notice notice-error mt-3" role="alert">{message}</div>}
          </form>
          {status === "ended" && (
            <div className="notice notice-info mt-5">This auction has ended and is no longer accepting participants.</div>
          )}
          <p className="mt-6 text-xs leading-5 text-ink/45">
            Display names are public and are not verified identities. Your anonymous session is saved in this browser.
          </p>
          <div className="mt-9 flex items-center gap-6 border-t border-ink/10 pt-6 text-sm">
            <div><span className="block text-ink/45">Opening price</span><strong className="mt-1 block">{formatMoney(auction.starting_price, auction.currency)}</strong></div>
            <div><span className="block text-ink/45">Minimum step</span><strong className="mt-1 block">{formatMoney(auction.minimum_increment, auction.currency)}</strong></div>
          </div>
        </div>
      </section>
    </div>
  );
}

function AuctionRoom({ auction, participant, bids, connection, refreshDashboard }: {
  auction: Auction;
  participant: Participant;
  bids: Bid[];
  connection: ConnectionState;
  refreshDashboard: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const client = getSupabaseBrowserClient();
  const status = effectiveStatus(auction);
  const highest = bids[0];
  const minimum = minimumNextBid(auction.starting_price, auction.minimum_increment, highest?.amount);

  async function submitBid(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    const parsed = parseBidAmount(amount);
    if (parsed === null) {
      setFeedback({ kind: "error", text: "Enter a valid amount with no more than two decimal places." });
      return;
    }
    if (parsed < minimum) {
      setFeedback({ kind: "error", text: `Your bid must be at least ${formatMoney(minimum, auction.currency)}.` });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      const { data, error } = await client.rpc("place_bid", {
        p_auction_id: auction.id,
        p_amount: parsed,
      });
      if (error) throw error;
      setAmount("");
      setFeedback({
        kind: "success",
        text: `Bid accepted at ${formatMoney(Number(data?.[0]?.amount ?? parsed), auction.currency)}.`,
      });
      await refreshDashboard();
    } catch (bidError) {
      setFeedback({
        kind: "error",
        text: bidError instanceof Error ? bidError.message : "Your bid could not be accepted.",
      });
      await refreshDashboard().catch(() => undefined);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8 sm:py-10">
      {connection === "offline" && (
        <div className="notice notice-info mb-5" role="status">
          Live updates are reconnecting. Accepted bids are still checked against the latest database value.
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
        <div className="space-y-6">
          <section className="panel overflow-hidden">
            <div className="grid md:grid-cols-[.9fr_1.1fr]">
              <div className="relative min-h-72 bg-ink">
                {auction.image_url ? (
                  <img src={auction.image_url} alt={auction.title} className="absolute inset-0 h-full w-full object-cover" />
                ) : (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_35%,#557867,#18201d_68%)]" />
                )}
              </div>
              <div className="flex flex-col justify-between p-6 sm:p-8">
                <div>
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs font-bold uppercase tracking-[.18em] text-forest">Current lot</p>
                    <span className="status-pill"><span className={`status-dot ${status}`} />{status}</span>
                  </div>
                  <h1 className="mt-4 text-3xl font-semibold tracking-[-.04em] sm:text-4xl">{auction.title}</h1>
                  <p className="mt-4 leading-7 text-ink/60">{auction.description}</p>
                </div>
                <div className="mt-8 flex gap-10 border-t border-ink/10 pt-5 text-sm">
                  <div><span className="block text-ink/45">Opening</span><strong className="mt-1 block">{formatMoney(auction.starting_price, auction.currency)}</strong></div>
                  <div><span className="block text-ink/45">Bid step</span><strong className="mt-1 block">+{formatMoney(auction.minimum_increment, auction.currency)}</strong></div>
                </div>
              </div>
            </div>
          </section>

          <section className="panel p-5 sm:p-7">
            <div className="mb-5 flex items-end justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.16em] text-ink/45">Activity</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-.03em]">Recent bids</h2>
              </div>
              <span className="text-sm text-ink/45">Latest first</span>
            </div>
            {bids.length ? (
              <ol className="divide-y divide-ink/10">
                {bids.map((bid, index) => (
                  <li key={bid.id} className="grid grid-cols-[2.25rem_1fr_auto] items-center gap-3 py-4 first:pt-1">
                    <span className={`grid h-9 w-9 place-items-center rounded-full text-xs font-bold ${index === 0 ? "bg-lime" : "bg-ink/5"}`}>
                      {bid.username.slice(0, 2).toUpperCase()}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{bid.username}</p>
                      <p className="mt-0.5 text-xs text-ink/45">{formatTime(bid.created_at)}</p>
                    </div>
                    <strong className="tabular-nums">{formatMoney(bid.amount, auction.currency)}</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="rounded-2xl border border-dashed border-ink/15 px-5 py-10 text-center">
                <p className="font-semibold">No bids yet</p>
                <p className="mt-1 text-sm text-ink/50">Be the first to set the pace.</p>
              </div>
            )}
          </section>
        </div>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <section className="overflow-hidden rounded-3xl bg-forest text-white shadow-card">
            <div className="p-6 sm:p-8">
              <p className="text-xs font-bold uppercase tracking-[.18em] text-white/55">{highest ? "Current highest bid" : "Opening price"}</p>
              <p className="mt-3 text-5xl font-semibold tracking-[-.055em] tabular-nums sm:text-6xl">
                {formatMoney(highest?.amount ?? auction.starting_price, auction.currency)}
              </p>
              <div className="mt-5 flex min-h-10 items-center gap-3 border-t border-white/15 pt-5">
                {highest ? (
                  <><span className="grid h-9 w-9 place-items-center rounded-full bg-lime text-xs font-bold text-ink">{highest.username.slice(0, 2).toUpperCase()}</span><div><span className="block text-xs text-white/50">Leading participant</span><strong>{highest.username}</strong></div></>
                ) : (
                  <span className="text-sm text-white/58">Waiting for the first bid</span>
                )}
              </div>
            </div>

            <form onSubmit={submitBid} className="bg-white p-6 text-ink sm:p-8">
              <div className="mb-5 flex items-center justify-between gap-4">
                <div>
                  <span className="block text-xs font-bold uppercase tracking-[.13em] text-ink/45">Bidding as</span>
                  <strong className="mt-1 block">{participant.username}</strong>
                </div>
                <span className="rounded-full bg-cream px-3 py-1.5 text-xs font-semibold text-ink/60">Min. {formatMoney(minimum, auction.currency)}</span>
              </div>
              <label className="field-label" htmlFor="bid-amount">Your bid</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-semibold text-ink/40">{auction.currency}</span>
                <input
                  id="bid-amount"
                  className="field min-h-14 pl-14 text-xl font-semibold tabular-nums"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder={minimum.toFixed(2)}
                  disabled={status !== "active" || submitting}
                  aria-describedby="bid-help"
                />
              </div>
              <p id="bid-help" className="mt-2 text-xs leading-5 text-ink/45">Bids are final for this MVP. The database rechecks the amount when submitted.</p>
              <button className="btn-primary mt-5 w-full" disabled={status !== "active" || submitting}>
                {submitting ? "Checking bid…" : status === "active" ? "Place bid" : status === "ended" ? "Auction ended" : "Auction not started"}
              </button>
              <div className="mt-3 min-h-12" aria-live="polite">
                {feedback && <div className={`notice ${feedback.kind === "error" ? "notice-error" : "notice-success"}`}>{feedback.text}</div>}
              </div>
            </form>
          </section>
        </aside>
      </div>
      <footer className="flex flex-col gap-3 py-8 text-xs text-ink/40 sm:flex-row sm:items-center sm:justify-between">
        <span>Usernames are unverified display names.</span>
        <Link href="/admin" className="text-link">Auction administration</Link>
      </footer>
    </div>
  );
}

function SetupRequired() {
  return (
    <main className="grid min-h-screen place-items-center bg-cream p-5">
      <section className="panel max-w-xl p-7 sm:p-10">
        <span className="brand-mark mb-6">A</span>
        <p className="text-xs font-bold uppercase tracking-[.16em] text-forest">Setup required</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">Connect your Supabase project</h1>
        <p className="mt-4 leading-7 text-ink/60">Copy <code>.env.example</code> to <code>.env.local</code>, add the project URL and publishable key, then restart the app. The README includes the migration and authentication steps.</p>
      </section>
    </main>
  );
}

function NoAuction() {
  return (
    <main className="grid min-h-screen place-items-center bg-cream p-5">
      <section className="panel max-w-lg p-8 text-center">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-forest">Ready for a lot</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">No auction has been created</h1>
        <p className="mt-4 leading-7 text-ink/60">Use the protected administration page to create the first auction.</p>
        <Link href="/admin" className="btn-primary mt-6">Open administration</Link>
      </section>
    </main>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <main className="grid min-h-screen place-items-center bg-cream p-5">
      <section className="panel max-w-lg p-8">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-coral">Connection error</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">The auction could not load</h1>
        <div className="notice notice-error mt-5">{message}</div>
        <p className="mt-4 text-sm leading-6 text-ink/55">Confirm the environment variables and apply the Supabase migration.</p>
      </section>
    </main>
  );
}

function LoadingScreen() {
  return (
    <main className="min-h-screen bg-cream p-5 sm:p-10">
      <div className="mx-auto max-w-7xl">
        <div className="skeleton h-9 w-40" />
        <div className="mt-10 grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
          <div className="skeleton h-[34rem]" />
          <div className="skeleton h-[30rem]" />
        </div>
      </div>
    </main>
  );
}
