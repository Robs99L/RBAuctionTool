"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import christmasAuctionImage from "../../Roland Berger Christmas Auction Pic.png";
import { AuctionTimer } from "@/components/auction-timer";
import { RbLogo } from "@/components/rb-logo";
import {
  applyAuctionRules,
  applyLiveAuctionEvent,
  emptyAuctionLiveState,
  normalizeAuctionDashboard,
  type LiveAuctionEvent,
  type LiveBidInsert,
  type LiveParticipantInsert,
} from "@/lib/auction-live-state";
import { selectNextAuction, selectParticipantAuction } from "@/lib/auction-queue";
import { remainingAuctionStartSeconds } from "@/lib/auction-timer";
import { selectWinningBids } from "@/lib/auction-winners";
import { maximumNextBid, minimumNextBid, parseBidAmount } from "@/lib/bid-rules";
import { browserDemoMode } from "@/lib/deployment-mode";
import { formatMoney, formatTime } from "@/lib/format";
import { normalizeParticipantProfile } from "@/lib/participant-profile";
import { continueParticipantAcrossLots } from "@/lib/participant-session";
import {
  ensureAnonymousSupabaseSession,
  getSupabaseBrowserClient,
  getVerifiedSupabaseSession,
  hasSupabaseBrowserConfig,
} from "@/lib/supabase-browser";
import {
  clearDemoParticipantId,
  createDemoAuctionState,
  DEMO_STATE_KEY,
  loadDemoAuctionState,
  loadDemoParticipantId,
  saveDemoAuctionState,
  saveDemoParticipantId,
  type DemoAuctionState,
} from "@/lib/demo-auction";
import type {
  Auction,
  AuctionStatus,
  Bid,
  BidReceipt,
  LeaderboardEntry,
  Participant,
} from "@/lib/types";

type ConnectionState = "connecting" | "live" | "offline";

function normalizeAuction(value: Record<string, unknown>): Auction {
  return {
    ...(value as unknown as Auction),
    starting_price: Number(value.starting_price),
    minimum_increment: Number(value.minimum_increment),
    maximum_bid_difference: value.maximum_bid_difference == null
      ? null
      : Number(value.maximum_bid_difference),
    winner_count: Number(value.winner_count ?? 1),
    timer_duration_seconds: Number(value.timer_duration_seconds ?? 120),
    sort_order: Number(value.sort_order),
  };
}

function auctionError(error: unknown, fallback: string) {
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "";
  const knownMessages = [
    "That name is already in use for this auction.",
    "This auction is not accepting bids.",
    "Registration is closed because this auction has ended.",
    "Enter a valid bid with no more than two decimal places.",
    "Please wait a moment before placing another bid.",
  ];
  const known = knownMessages.find((candidate) => message.includes(candidate));
  if (known) return known;
  if (message.includes("minimum bid is")) return message;
  if (message.includes("maximum bid is")) return message;
  return fallback;
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

function useBiddingOpen(status: AuctionStatus, startsAt: string | null) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const update = () => {
      setOpen(status === "active" && remainingAuctionStartSeconds(startsAt) === 0);
    };
    const initialUpdate = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 100);
    return () => {
      window.clearTimeout(initialUpdate);
      window.clearInterval(interval);
    };
  }, [startsAt, status]);

  return open && status === "active" && remainingAuctionStartSeconds(startsAt) === 0;
}

export function AuctionApp() {
  const configured = hasSupabaseBrowserConfig();
  const demoMode = browserDemoMode(configured);
  const client = useMemo(
    () => (configured && !demoMode ? getSupabaseBrowserClient() : null),
    [configured, demoMode],
  );
  const [auctions, setAuctions] = useState<Auction[]>([]);
  const [auction, setAuction] = useState<Auction | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const [liveState, setLiveState] = useState(emptyAuctionLiveState);
  const [loading, setLoading] = useState(configured && !demoMode);
  const [restoredAuctionId, setRestoredAuctionId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const auctionsRef = useRef<Auction[]>([]);
  const auctionRef = useRef<Auction | null>(null);
  const liveStateRef = useRef(liveState);
  const liveEventBufferRef = useRef<LiveAuctionEvent[]>([]);
  const snapshotGenerationRef = useRef(0);
  const snapshotRequestRef = useRef<{
    auctionId: string;
    generation: number;
    promise: Promise<void>;
  } | null>(null);
  const { bids, leaderboard, participantCount } = liveState;
  const auctionId = auction?.id;
  const shouldObserveLiveAuction = Boolean(participant) || auction?.status === "ended";
  const shouldObserveLiveAuctionRef = useRef(shouldObserveLiveAuction);
  const nextAuction = useMemo(
    () => selectNextAuction(auctions, auctionId),
    [auctionId, auctions],
  );

  useEffect(() => {
    shouldObserveLiveAuctionRef.current = shouldObserveLiveAuction;
  }, [shouldObserveLiveAuction]);

  const commitLiveState = useCallback((nextState: typeof liveState) => {
    liveStateRef.current = nextState;
    setLiveState(nextState);
  }, []);

  const commitAuction = useCallback((nextAuction: Auction | null) => {
    const previousAuction = auctionRef.current;
    auctionRef.current = nextAuction;
    setAuction(nextAuction);

    if (!nextAuction || previousAuction?.id !== nextAuction.id) {
      commitLiveState(emptyAuctionLiveState());
      return;
    }
    commitLiveState(applyAuctionRules(liveStateRef.current, nextAuction));
  }, [commitLiveState]);

  const commitAuctions = useCallback((nextAuctions: Auction[]) => {
    auctionsRef.current = nextAuctions;
    setAuctions(nextAuctions);
    commitAuction(selectParticipantAuction(nextAuctions));
  }, [commitAuction]);

  const loadCurrentAuction = useCallback(async () => {
    if (!client) return;
    const { data, error: loadError } = await client
      .from("auctions")
      .select("*")
      .order("sort_order", { ascending: true });
    if (loadError) throw loadError;
    const nextAuctions = (data ?? []).map((row) => normalizeAuction(row));
    commitAuctions(nextAuctions);
  }, [client, commitAuctions]);

  const refreshDashboard = useCallback(async () => {
    if (!client || !auctionId) return;
    const existingRequest = snapshotRequestRef.current;
    if (existingRequest?.auctionId === auctionId) return existingRequest.promise;

    const requestedAuctionId = auctionId;
    const generation = ++snapshotGenerationRef.current;
    liveEventBufferRef.current = [];

    const replayBufferedEvents = (baseState: typeof liveState, snapshotAuction: Auction) => {
      const buffered = liveEventBufferRef.current;
      liveEventBufferRef.current = [];
      return buffered.reduce(
        (state, event) => applyLiveAuctionEvent(state, event, snapshotAuction),
        baseState,
      );
    };

    const request = (async () => {
      const { data, error: snapshotError } = await client.rpc("get_auction_dashboard", {
        p_auction_id: requestedAuctionId,
      });
      if (snapshotError) throw snapshotError;
      if (
        generation !== snapshotGenerationRef.current ||
        auctionRef.current?.id !== requestedAuctionId
      ) {
        return;
      }

      const snapshot = normalizeAuctionDashboard(data, normalizeAuction);
      const nextState = replayBufferedEvents(snapshot.liveState, snapshot.auction);
      auctionRef.current = snapshot.auction;
      setAuction(snapshot.auction);
      commitLiveState(nextState);
    })().catch((snapshotError: unknown) => {
      if (
        generation === snapshotGenerationRef.current &&
        auctionRef.current?.id === requestedAuctionId
      ) {
        const currentAuction = auctionRef.current;
        commitLiveState(replayBufferedEvents(liveStateRef.current, currentAuction));
      }
      throw snapshotError;
    }).finally(() => {
      if (snapshotRequestRef.current?.generation === generation) {
        snapshotRequestRef.current = null;
      }
    });

    snapshotRequestRef.current = { auctionId: requestedAuctionId, generation, promise: request };
    return request;
  }, [auctionId, client, commitLiveState]);

  const handleLiveEvent = useCallback((event: LiveAuctionEvent) => {
    const currentAuction = auctionRef.current;
    if (!currentAuction || event.record.auction_id !== currentAuction.id) return;

    if (snapshotRequestRef.current?.auctionId === currentAuction.id) {
      liveEventBufferRef.current.push(event);
      return;
    }
    commitLiveState(applyLiveAuctionEvent(liveStateRef.current, event, currentAuction));
  }, [commitLiveState]);

  const joinAuction = useCallback(async (username: string, email: string) => {
    if (!client || !auctionId) throw new Error("The auction is not available.");
    await ensureAnonymousSupabaseSession(client);
    const { data, error: joinError } = await client.rpc("join_auction_with_contact", {
      p_auction_id: auctionId,
      p_username: username,
      p_email: email,
    });
    if (joinError) {
      const { data: existingData, error: existingError } = await client.rpc(
        "get_my_participant_with_contact",
        { p_auction_id: auctionId },
      );
      const existingParticipant = existingData?.[0] as Participant | undefined;
      if (
        !existingError &&
        existingParticipant?.username.toLocaleLowerCase() === username.toLocaleLowerCase() &&
        existingParticipant?.email?.toLocaleLowerCase() === email.toLocaleLowerCase()
      ) {
        return existingParticipant;
      }
      throw new Error(auctionError(joinError, "Could not join the auction."));
    }
    if (!data?.[0]) throw new Error("The auction could not be joined.");
    return data[0] as Participant;
  }, [auctionId, client]);

  const placeBid = useCallback(async (amount: number): Promise<BidReceipt> => {
    if (!client || !auctionId) throw new Error("The auction is not available.");
    const { data, error: bidError } = await client.rpc("place_bid", {
      p_auction_id: auctionId,
      p_amount: amount,
    });
    if (bidError) throw new Error(auctionError(bidError, "Your bid could not be accepted."));
    const receipt = data?.[0];
    if (!receipt) throw new Error("The accepted bid receipt is unavailable.");
    const normalizedReceipt = {
      bid_id: String(receipt.bid_id),
      amount: Number(receipt.amount),
      created_at: String(receipt.created_at),
      username: String(receipt.username),
    };
    if (participant) {
      handleLiveEvent({
        kind: "bid",
        record: {
          id: normalizedReceipt.bid_id,
          auction_id: auctionId,
          participant_id: participant.id,
          amount: normalizedReceipt.amount,
          created_at: normalizedReceipt.created_at,
          username: normalizedReceipt.username,
        },
      });
    }
    return normalizedReceipt;
  }, [auctionId, client, handleLiveEvent, participant]);

  useEffect(() => {
    if (!client) return;
    let active = true;

    async function load() {
      setLoading(true);
      try {
        await loadCurrentAuction();
        if (active) setError("");
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : "Could not load the auction queue.");
        }
      }
      if (active) setLoading(false);
    }

    void load();
    return () => {
      active = false;
    };
  }, [client, loadCurrentAuction]);

  useEffect(() => {
    if (!client) return;
    const applyQueueChange = (payload: {
      eventType: "INSERT" | "UPDATE" | "DELETE";
      new: Record<string, unknown>;
      old: Record<string, unknown>;
    }) => {
      const current = auctionsRef.current;
      let nextAuctions = current;
      if (payload.eventType === "DELETE") {
        const deletedId = String(payload.old.id ?? "");
        nextAuctions = current.filter((item) => item.id !== deletedId);
      } else {
        const changed = normalizeAuction(payload.new);
        const exists = current.some((item) => item.id === changed.id);
        nextAuctions = exists
          ? current.map((item) => item.id === changed.id ? changed : item)
          : [...current, changed];
      }
      commitAuctions(nextAuctions);
    };
    const channel = client
      .channel("auction-queue")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "auctions" },
        (payload) => applyQueueChange(payload as Parameters<typeof applyQueueChange>[0]),
      )
      .subscribe((status) => {
        if (!shouldObserveLiveAuctionRef.current) {
          if (status === "SUBSCRIBED") setConnection("live");
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            setConnection("offline");
          }
        }
      });

    return () => {
      void client.removeChannel(channel);
    };
  }, [client, commitAuctions]);

  useEffect(() => {
    if (!client || !auctionId) return;
    let active = true;

    async function restoreParticipant() {
      setParticipant(null);
      try {
        const session = await getVerifiedSupabaseSession(client!);
        if (!session || !active) return;
        const { data, error: restoreError } = await client!.rpc("get_my_participant_with_contact", {
          p_auction_id: auctionId,
        });
        if (restoreError) throw restoreError;
        if (!active) return;

        const currentParticipant = data?.[0] ? data[0] as Participant : null;
        if (!currentParticipant && auctionRef.current?.status === "ended") {
          setParticipant(null);
          return;
        }
        let previousIdentity: { username: string; email: string } | null = null;
        if (!currentParticipant?.email) {
          const { data: identityData, error: identityError } = await client!.rpc(
            "get_my_auction_identity_with_contact",
          );
          if (identityError) throw identityError;
          const identity = identityData?.[0];
          previousIdentity = identity?.username && identity?.email
            ? { username: identity.username, email: identity.email }
            : null;
        }
        if (!active) return;

        const restoredParticipant = await continueParticipantAcrossLots(
          currentParticipant,
          previousIdentity,
          joinAuction,
        );
        if (active) setParticipant(restoredParticipant);
      } catch (restoreError) {
        if (active) {
          setError(
            restoreError instanceof Error
              ? restoreError.message
              : "Could not restore the participant session.",
          );
        }
      } finally {
        if (active) setRestoredAuctionId(auctionId ?? null);
      }
    }

    void restoreParticipant();
    return () => {
      active = false;
    };
  }, [auctionId, client, joinAuction]);

  useEffect(() => {
    if (
      !client ||
      !auctionId ||
      !shouldObserveLiveAuction
    ) return;
    let active = true;
    let subscribed = false;

    const recoverSnapshot = () => {
      void refreshDashboard()
        .then(() => {
          if (active) setError("");
        })
        .catch((refreshError: unknown) => {
          if (!active) return;
          setConnection("offline");
          setError(refreshError instanceof Error ? refreshError.message : "Could not load bids.");
        });
    };
    const fallbackRefresh = window.setTimeout(() => {
      if (!subscribed) recoverSnapshot();
    }, 4_000);

    const channel = client
      .channel(`auction:${auctionId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "bids",
          filter: `auction_id=eq.${auctionId}`,
          select: ["id", "auction_id", "participant_id", "amount", "created_at"],
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          handleLiveEvent({
            kind: "bid",
            record: {
              id: String(row.id),
              auction_id: String(row.auction_id),
              participant_id: String(row.participant_id),
              amount: Number(row.amount),
              created_at: String(row.created_at),
            } satisfies LiveBidInsert,
          });
        },
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "participants",
          filter: `auction_id=eq.${auctionId}`,
          select: ["id", "auction_id", "username"],
        },
        (payload) => {
          const row = payload.new as Record<string, unknown>;
          handleLiveEvent({
            kind: "participant",
            record: {
              id: String(row.id),
              auction_id: String(row.auction_id),
              username: String(row.username ?? "Unknown participant"),
            } satisfies LiveParticipantInsert,
          });
        },
      )
      .subscribe((status) => {
        if (!active) return;
        if (status === "SUBSCRIBED") {
          subscribed = true;
          window.clearTimeout(fallbackRefresh);
          setConnection("live");
          recoverSnapshot();
        }
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          subscribed = false;
          setConnection("offline");
        }
      });

    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") recoverSnapshot();
    };
    window.addEventListener("online", recoverSnapshot);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      active = false;
      snapshotGenerationRef.current += 1;
      snapshotRequestRef.current = null;
      liveEventBufferRef.current = [];
      window.clearTimeout(fallbackRefresh);
      window.removeEventListener("online", recoverSnapshot);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      void client.removeChannel(channel);
    };
  }, [auctionId, client, handleLiveEvent, refreshDashboard, shouldObserveLiveAuction]);

  useEffect(() => {
    if (!shouldObserveLiveAuction || connection !== "offline") return;
    const interval = window.setInterval(() => {
      void refreshDashboard().catch(() => undefined);
    }, 10_000);
    return () => window.clearInterval(interval);
  }, [connection, refreshDashboard, shouldObserveLiveAuction]);

  if (demoMode) return <DemoAuctionApp />;
  if (!configured) return <ConfigurationScreen />;
  if (loading) return <LoadingScreen />;
  if (error && !auction) return <ErrorScreen message={error} />;
  if (!auction) return <NoAuction />;
  if (restoredAuctionId !== auctionId || (participant && participant.auction_id !== auctionId)) {
    return <LoadingScreen />;
  }

  return (
    <main className="min-h-screen bg-cream">
      <Header connection={connection} participantCount={participantCount} />
      {participant || effectiveStatus(auction) === "ended" ? (
        <AuctionRoom
          auction={auction}
          participant={participant}
          bids={bids}
          leaderboard={leaderboard}
          connection={connection}
          onPlaceBid={placeBid}
          refreshDashboard={refreshDashboard}
        />
      ) : (
        <JoinExperience
          auction={auction}
          nextEventName={nextAuction?.title ?? null}
          onJoined={setParticipant}
          onJoin={joinAuction}
        />
      )}
    </main>
  );
}

function DemoAuctionApp() {
  const [demoState, setDemoState] = useState<DemoAuctionState | null>(null);
  const [participant, setParticipant] = useState<Participant | null>(null);
  const demoAuction = useMemo(
    () => demoState ? selectParticipantAuction(demoState.auctions) : null,
    [demoState],
  );
  const demoNextAuction = useMemo(
    () => demoState ? selectNextAuction(demoState.auctions, demoAuction?.id) : null,
    [demoAuction?.id, demoState],
  );
  const demoBids = useMemo(
    () => demoState && demoAuction
      ? demoState.bids.filter((bid) => bid.auction_id === demoAuction.id)
      : [],
    [demoAuction, demoState],
  );
  const demoParticipants = useMemo(
    () => demoState?.participants ?? [],
    [demoState],
  );
  const demoLeaderboard = useMemo<LeaderboardEntry[]>(() => {
    if (!demoAuction) return [];
    const ranked = selectWinningBids(demoBids, Number.MAX_SAFE_INTEGER);
    return ranked.map((bid) => ({
      bid_id: bid.id,
      participant_id: bid.participant_id,
      username: bid.username,
      amount: bid.amount,
      created_at: bid.created_at,
      bidder_rank: bid.rank,
      is_winner: bid.rank <= demoAuction.winner_count,
      is_final: demoAuction.status === "ended",
    }));
  }, [demoAuction, demoBids]);

  useEffect(() => {
    const load = () => {
      const next = loadDemoAuctionState();
      const participantId = loadDemoParticipantId();
      const currentAuction = selectParticipantAuction(next.auctions);
      setDemoState(next);
      const existingParticipant = next.participants.find((item) => item.id === participantId);
      setParticipant(
        existingParticipant?.email && currentAuction
          ? { ...existingParticipant, auction_id: currentAuction.id }
          : null,
      );
      saveDemoAuctionState(next);
    };
    load();

    const syncAcrossTabs = (event: StorageEvent) => {
      if (event.key === DEMO_STATE_KEY) load();
    };
    window.addEventListener("storage", syncAcrossTabs);
    return () => window.removeEventListener("storage", syncAcrossTabs);
  }, []);

  const commitState = useCallback((next: DemoAuctionState) => {
    setDemoState(next);
    saveDemoAuctionState(next);
  }, []);

  const joinDemo = useCallback(async (username: string, email: string) => {
    if (!demoState || !demoAuction) throw new Error("The demo is still loading.");
    const nameTaken = demoState.participants.some(
      (item) => item.username.toLocaleLowerCase() === username.toLocaleLowerCase(),
    );
    if (nameTaken) throw new Error("This name is already in use.");

    const nextParticipant: Participant = {
      id: crypto.randomUUID(),
      auction_id: demoAuction.id,
      username,
      email,
      created_at: new Date().toISOString(),
    };
    commitState({
      ...demoState,
      participants: [...demoState.participants, nextParticipant],
    });
    saveDemoParticipantId(nextParticipant.id);
    return nextParticipant;
  }, [commitState, demoAuction, demoState]);

  const placeDemoBid = useCallback(async (amount: number) => {
    if (!demoState || !demoAuction || !participant) throw new Error("Join the demo before bidding.");
    if (effectiveStatus(demoAuction) !== "active") {
      throw new Error("This auction is not accepting bids.");
    }
    if (remainingAuctionStartSeconds(demoAuction.starts_at) > 0) {
      throw new Error("Bidding opens when the start countdown reaches zero.");
    }
    const minimum = minimumNextBid(
      demoAuction.starting_price,
      demoAuction.minimum_increment,
      demoBids[0]?.amount,
      demoBids[0]?.participant_id === participant.id,
    );
    const maximum = maximumNextBid(
      demoAuction.starting_price,
      demoAuction.maximum_bid_difference,
      demoBids[0]?.amount,
    );
    if (amount < minimum) {
      throw new Error(
        `Your bid must be at least ${formatMoney(minimum, demoAuction.currency)}.`,
      );
    }
    if (maximum !== null && amount > maximum) {
      throw new Error(
        `Your bid must not exceed ${formatMoney(maximum, demoAuction.currency)}.`,
      );
    }

    const nextBid: Bid = {
      id: crypto.randomUUID(),
      auction_id: demoAuction.id,
      participant_id: participant.id,
      amount,
      created_at: new Date().toISOString(),
      username: participant.username,
    };
    commitState({ ...demoState, bids: [nextBid, ...demoState.bids] });
    return {
      bid_id: nextBid.id,
      amount: nextBid.amount,
      created_at: nextBid.created_at,
      username: nextBid.username,
    } satisfies BidReceipt;
  }, [commitState, demoAuction, demoBids, demoState, participant]);

  const resetDemo = useCallback(() => {
    const next = createDemoAuctionState();
    clearDemoParticipantId();
    setParticipant(null);
    commitState(next);
  }, [commitState]);

  if (!demoState) return <LoadingScreen />;
  if (!demoAuction) return <NoAuction />;

  return (
    <main className="min-h-screen bg-cream">
      <div className="bg-lime px-4 py-2 text-sm text-ink sm:px-8">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 sm:gap-4">
          <span className="min-w-0"><strong>Local demo</strong> · Changes are saved in this browser.</span>
          <button className="font-bold underline underline-offset-4" onClick={resetDemo}>
            Reset demo
          </button>
        </div>
      </div>
      <Header connection="live" participantCount={demoParticipants.length} />
      {participant || effectiveStatus(demoAuction) === "ended" ? (
        <AuctionRoom
          auction={demoAuction}
          participant={participant}
          bids={demoBids}
          leaderboard={demoLeaderboard}
          connection="live"
          onPlaceBid={placeDemoBid}
          refreshDashboard={async () => undefined}
        />
      ) : (
        <JoinExperience
          auction={demoAuction}
          nextEventName={demoNextAuction?.title ?? null}
          onJoined={setParticipant}
          onJoin={joinDemo}
        />
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
      <div className="mx-auto flex max-w-7xl flex-col items-stretch justify-between gap-3 sm:flex-row sm:items-center">
        <div className="brand-lockup">
          <RbLogo />
          <span className="max-w-44 text-sm leading-tight sm:max-w-none sm:text-base">
            Christmas Auction
          </span>
        </div>
        <div className="flex items-center justify-end gap-2 sm:gap-3">
          <span className="hidden text-sm text-ink/55 sm:inline">
            {participantCount} {participantCount === 1 ? "participant" : "participants"}
          </span>
          <span className="status-pill" title={connection === "live" ? "Realtime updates connected" : "Realtime connection status"}>
            <span className={`status-dot ${connection === "live" ? "active" : ""}`} />
            {connection === "live" ? "Live" : connection === "connecting" ? "Connecting" : "Reconnecting"}
          </span>
          <Link href="/admin" className="text-link whitespace-nowrap">
            Admin
          </Link>
        </div>
      </div>
    </header>
  );
}

function JoinExperience({ auction, nextEventName, onJoined, onJoin }: {
  auction: Auction;
  nextEventName: string | null;
  onJoined: (participant: Participant) => void;
  onJoin: (username: string, email: string) => Promise<Participant>;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState("");

  async function join(event: FormEvent) {
    event.preventDefault();
    const profile = normalizeParticipantProfile(username, email);
    if (!profile) {
      setMessage("Enter your full name and a valid email address.");
      return;
    }

    setSubmitting(true);
    setMessage("");
    try {
      onJoined(await onJoin(profile.username, profile.email));
    } catch (joinError) {
      setMessage(joinError instanceof Error ? joinError.message : "Could not join the auction.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto grid w-full max-w-7xl grid-cols-[minmax(0,1fr)] items-center lg:min-h-[calc(100dvh-81px)] lg:grid-cols-[1.08fr_.92fr]">
      <section className="h-36 min-w-0 max-w-full overflow-hidden bg-ink sm:h-56 lg:h-auto">
        <Image
          src={christmasAuctionImage}
          alt="Christmas Auction"
          sizes="(max-width: 1024px) 100vw, 54vw"
          className="block h-full w-full object-cover opacity-90 lg:h-auto lg:object-contain"
          placeholder="blur"
          preload
        />
      </section>

      <section className="flex min-w-0 items-center px-5 py-8 sm:px-12 sm:py-10 lg:px-16">
        <div className="w-full max-w-lg">
          <h2 className="break-words text-3xl font-semibold sm:text-4xl">Welcome to the OPS/IND Christmas Auction</h2>
          <p className="mt-3 text-lg font-semibold text-forest">Join the bidding.</p>
          <p className="mt-5 max-w-md text-base leading-7 text-ink/60">
            Register with your name and email. You stay in the auction automatically when the next bidding round starts.
          </p>
          <AuctionTimer
            startsAt={auction.starts_at}
            durationSeconds={auction.timer_duration_seconds}
            status={auction.status}
            eventName={auction.title}
            nextEventName={nextEventName}
            compact
            className="mt-6"
          />
          <form className="mt-9 space-y-4" onSubmit={join}>
            <div>
              <label className="field-label" htmlFor="username">Full name</label>
              <input
                id="username"
                name="name"
                className="field min-h-12"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="e.g. Mia Keller"
                maxLength={120}
                autoComplete="name"
                autoFocus
                required
              />
            </div>
            <div>
              <label className="field-label" htmlFor="email">Email address</label>
              <input
                id="email"
                name="email"
                type="email"
                className="field min-h-12"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="mia@example.com"
                maxLength={254}
                autoComplete="email"
                required
              />
            </div>
            <button className="btn-primary w-full" disabled={submitting}>
              {submitting ? "Joining…" : "Register for auction"}
            </button>
            {message && <div className="notice notice-error mt-3" role="alert">{message}</div>}
          </form>
          <p className="mt-6 text-xs leading-5 text-ink/45">
            Your name is shown with bids. Your email stays private and is available only to auction administrators.
          </p>
        </div>
      </section>
    </div>
  );
}

function AuctionRoom({ auction, participant, bids, leaderboard, connection, onPlaceBid, refreshDashboard }: {
  auction: Auction;
  participant: Participant | null;
  bids: Bid[];
  leaderboard: LeaderboardEntry[];
  connection: ConnectionState;
  onPlaceBid: (amount: number) => Promise<BidReceipt>;
  refreshDashboard: () => Promise<void>;
}) {
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(null);
  const status = effectiveStatus(auction);
  const biddingOpen = useBiddingOpen(status, auction.starts_at);
  const starting = status === "active" && !biddingOpen;
  const highest = bids[0];
  const isLeadingParticipant = highest?.participant_id === participant?.id;
  const minimum = minimumNextBid(
    auction.starting_price,
    auction.minimum_increment,
    highest?.amount,
    isLeadingParticipant,
  );
  const maximum = maximumNextBid(
    auction.starting_price,
    auction.maximum_bid_difference,
    highest?.amount,
  );
  const personalRank = leaderboard.find((entry) => entry.participant_id === participant?.id);

  async function submitBid(event: FormEvent) {
    event.preventDefault();
    if (submitting) return;
    if (!biddingOpen) {
      setFeedback({ kind: "error", text: "Bidding opens when the start countdown reaches zero." });
      return;
    }
    const parsed = parseBidAmount(amount);
    if (parsed === null) {
      setFeedback({ kind: "error", text: "Enter a valid amount with no more than two decimal places." });
      return;
    }
    if (parsed < minimum) {
      setFeedback({ kind: "error", text: `Your bid must be at least ${formatMoney(minimum, auction.currency)}.` });
      return;
    }
    if (maximum !== null && parsed > maximum) {
      setFeedback({ kind: "error", text: `Your bid must not exceed ${formatMoney(maximum, auction.currency)}.` });
      return;
    }

    setSubmitting(true);
    setFeedback(null);
    try {
      const receipt = await onPlaceBid(parsed);
      setAmount("");
      setFeedback({
        kind: "success",
        text: `Bid accepted at ${formatMoney(receipt.amount, auction.currency)}.`,
      });
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
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(340px,.85fr)]">
        <div className="contents lg:block lg:space-y-6">
          <section className="panel order-1 overflow-hidden lg:order-none">
            <div>
              <div className="relative aspect-video w-full bg-ink">
                {auction.image_url ? (
                  <Image
                    src={auction.image_url}
                    alt={auction.title}
                    fill
                    sizes="(max-width: 1024px) 100vw, 58vw"
                    className="object-contain"
                  />
                ) : (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_35%_35%,#557867,#18201d_68%)]" />
                )}
              </div>
              <div className="flex flex-col justify-between p-5 sm:p-8">
                <div>
                  <div className="flex items-center justify-between gap-4">
                    <p className="text-xs font-bold uppercase tracking-[.18em] text-forest">Current lot</p>
                    <span className="status-pill"><span className={`status-dot ${status}`} />{starting ? "starting" : status}</span>
                  </div>
                  <h1 className="mt-4 break-words text-3xl font-semibold sm:text-4xl">{auction.title}</h1>
                  <p className="mt-4 leading-7 text-ink/60">{auction.description}</p>
                  <AuctionTimer
                    startsAt={auction.starts_at}
                    durationSeconds={auction.timer_duration_seconds}
                    status={status}
                    className="mt-6"
                  />
                </div>
                <div className="mt-8 grid grid-cols-2 gap-x-4 gap-y-5 border-t border-ink/10 pt-5 text-sm sm:flex sm:flex-wrap sm:gap-8">
                  <div><span className="block text-ink/45">Opening</span><strong className="mt-1 block">{formatMoney(auction.starting_price, auction.currency)}</strong></div>
                  <div><span className="block text-ink/45">Bid step</span><strong className="mt-1 block">+{formatMoney(auction.minimum_increment, auction.currency)}</strong></div>
                  <div><span className="block text-ink/45">Max. increase</span><strong className="mt-1 block">{auction.maximum_bid_difference == null ? "Unlimited" : `+${formatMoney(auction.maximum_bid_difference, auction.currency)}`}</strong></div>
                  <div><span className="block text-ink/45">Winner spots</span><strong className="mt-1 block">{auction.winner_count}</strong></div>
                </div>
              </div>
            </div>
          </section>

          <section className="panel order-3 p-5 sm:p-7 lg:order-none">
            <div className="mb-5 flex flex-col items-start gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.16em] text-ink/45">
                  {status === "ended" ? "Final result" : "Current standings"}
                </p>
                <h2 className="mt-1 text-2xl font-semibold">Leaderboard</h2>
              </div>
              <span className="text-sm text-ink/45">One best bid per person</span>
            </div>
            {personalRank && (
              <div className={`notice mb-4 ${personalRank.is_winner ? "notice-success" : "notice-info"}`} role="status">
                You are ranked #{personalRank.bidder_rank}. {personalRank.is_winner
                  ? status === "ended" ? "You are a winner." : "You are currently in a winning place."
                  : status === "ended" ? "You did not finish in a winning place." : "Increase your bid to reach a winning place."}
              </div>
            )}
            {leaderboard.length ? (
              <ol className="divide-y divide-ink/10">
                {leaderboard.map((entry) => (
                  <li
                    key={entry.participant_id}
                    className={`grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 py-3 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:gap-3 ${entry.participant_id === participant?.id ? "bg-lime/20" : ""}`}
                  >
                    <span className={`grid h-8 w-8 place-items-center rounded-full text-sm font-bold sm:h-9 sm:w-9 ${entry.is_winner ? "bg-lime" : "bg-ink/5"}`}>
                      {entry.bidder_rank}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-semibold">{entry.username}</p>
                      {entry.is_winner && (
                        <span className="text-xs font-semibold text-forest">
                          {status === "ended" ? "Winner" : "Winning place"}
                        </span>
                      )}
                    </div>
                    <strong className="shrink-0 whitespace-nowrap text-right text-sm tabular-nums sm:text-base">{formatMoney(entry.amount, auction.currency)}</strong>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="rounded-xl border border-dashed border-ink/15 p-7 text-center text-sm text-ink/50">
                The leaderboard will appear after the first accepted bid.
              </div>
            )}
          </section>

          <section className="panel order-4 p-5 sm:p-7 lg:order-none">
            <div className="mb-5 flex flex-col items-start gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="text-xs font-bold uppercase tracking-[.16em] text-ink/45">Activity</p>
                <h2 className="mt-1 text-2xl font-semibold tracking-[-.03em]">Recent bids</h2>
              </div>
              <span className="text-sm text-ink/45">Latest first</span>
            </div>
            {bids.length ? (
              <ol className="divide-y divide-ink/10">
                {bids.map((bid) => (
                    <li key={bid.id} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-2 py-4 first:pt-1 sm:grid-cols-[2.25rem_minmax(0,1fr)_auto] sm:gap-3">
                      <span className="grid h-8 w-8 place-items-center rounded-full bg-ink/5 text-xs font-bold sm:h-9 sm:w-9">
                        {bid.username.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{bid.username}</p>
                        <p className="mt-0.5 text-xs text-ink/45">{formatTime(bid.created_at)}</p>
                      </div>
                      <strong className="shrink-0 whitespace-nowrap text-right text-sm tabular-nums sm:text-base">{formatMoney(bid.amount, auction.currency)}</strong>
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

        <aside className="order-2 lg:order-none lg:sticky lg:top-6 lg:self-start">
          <section className="overflow-hidden rounded-3xl bg-forest text-white shadow-card">
            <div className="p-6 sm:p-8">
              <p className="text-xs font-bold uppercase tracking-[.18em] text-white/55">{highest ? "Current highest bid" : "Opening price"}</p>
              <p className="mt-3 break-words text-4xl font-semibold tabular-nums sm:text-6xl">
                {formatMoney(highest?.amount ?? auction.starting_price, auction.currency)}
              </p>
              <div className="mt-5 flex min-h-10 items-center gap-3 border-t border-white/15 pt-5">
                {highest ? (
                  <><span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-lime text-xs font-bold text-ink">{highest.username.slice(0, 2).toUpperCase()}</span><div className="min-w-0"><span className="block text-xs text-white/50">Leading participant</span><strong className="block truncate">{highest.username}</strong></div></>
                ) : (
                  <span className="text-sm text-white/58">Waiting for the first bid</span>
                )}
              </div>
            </div>

            {participant ? (
            <form onSubmit={submitBid} className="bg-white p-6 text-ink sm:p-8">
              <div className="mb-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div>
                  <span className="block text-xs font-bold uppercase tracking-[.13em] text-ink/45">Bidding as</span>
                  <strong className="mt-1 block">{participant.username}</strong>
                </div>
                <div className="flex flex-wrap justify-start gap-2 sm:justify-end">
                  <span className="rounded-full bg-cream px-3 py-1.5 text-xs font-semibold text-ink/60">Min. {formatMoney(minimum, auction.currency)}</span>
                  {maximum !== null && (
                    <span className="rounded-full bg-cream px-3 py-1.5 text-xs font-semibold text-ink/60">Max. {formatMoney(maximum, auction.currency)}</span>
                  )}
                </div>
              </div>
              <label className="field-label" htmlFor="bid-amount">Your bid</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 font-semibold text-ink/40">{auction.currency}</span>
                <input
                  id="bid-amount"
                  className="field min-h-14 text-xl font-semibold tabular-nums"
                  style={{ paddingLeft: "4.5rem" }}
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  inputMode="decimal"
                  placeholder={minimum.toFixed(2)}
                  disabled={!biddingOpen || submitting}
                  aria-describedby={isLeadingParticipant ? undefined : "bid-help"}
                />
              </div>
              {!isLeadingParticipant && (
                <p id="bid-help" className="mt-2 text-xs leading-5 text-ink/45">
                  The database rechecks the minimum and maximum when submitted.
                </p>
              )}
              <button className="btn-primary mt-5 w-full" disabled={!biddingOpen || submitting}>
                {submitting
                  ? "Checking bid…"
                  : starting
                    ? "Bidding starts shortly"
                    : status === "active"
                      ? "Place bid"
                      : status === "ended"
                        ? "Auction ended"
                        : "Auction not started"}
              </button>
              <div className="mt-3 min-h-12" aria-live="polite">
                {feedback && <div className={`notice ${feedback.kind === "error" ? "notice-error" : "notice-success"}`}>{feedback.text}</div>}
              </div>
            </form>
            ) : (
              <div className="bg-white p-6 text-ink sm:p-8">
                <p className="text-xs font-bold uppercase tracking-[.13em] text-ink/45">Bidding closed</p>
                <h2 className="mt-2 text-xl font-semibold">Final results are available above.</h2>
                <p className="mt-2 text-sm leading-6 text-ink/55">No registration is required to view the completed auction.</p>
              </div>
            )}
          </section>
        </aside>
      </div>
      <footer className="flex flex-col gap-3 py-8 text-xs text-ink/40 sm:flex-row sm:items-center sm:justify-between">
        <span>Names are self-reported; email addresses remain private.</span>
        <Link href="/admin" className="text-link">Auction administration</Link>
      </footer>
    </div>
  );
}

function NoAuction() {
  return (
    <main className="grid min-h-dvh place-items-center bg-cream p-5">
      <section className="panel max-w-lg p-6 text-center sm:p-8">
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
    <main className="grid min-h-dvh place-items-center bg-cream p-5">
      <section className="panel max-w-lg p-6 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-coral">Connection error</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-[-.04em]">The auction could not load</h1>
        <div className="notice notice-error mt-5">{message}</div>
        <p className="mt-4 text-sm leading-6 text-ink/55">Confirm the environment variables and apply the Supabase migration.</p>
      </section>
    </main>
  );
}

function ConfigurationScreen() {
  return (
    <main className="grid min-h-dvh place-items-center bg-cream p-5">
      <section className="panel max-w-lg p-6 sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[.16em] text-coral">Service unavailable</p>
        <h1 className="mt-3 text-3xl font-semibold">Auction configuration is missing</h1>
        <p className="mt-4 leading-7 text-ink/60">
          This deployment cannot connect to the auction service. An administrator must configure the Supabase environment variables and redeploy.
        </p>
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
