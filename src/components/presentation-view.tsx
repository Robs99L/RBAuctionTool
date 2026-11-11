"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { AuctionTimer } from "@/components/auction-timer";
import { RbLogo } from "@/components/rb-logo";
import { formatMoney } from "@/lib/format";
import type { Auction, LeaderboardEntry } from "@/lib/types";

import styles from "./presentation-view.module.css";

const LEADERBOARD_PAGE_SIZE = 5;

export function PresentationView({
  auction,
  leaderboard,
  connection,
  loading = false,
  error = "",
  nextEventName,
  demo = false,
}: {
  auction: Auction | null;
  leaderboard: LeaderboardEntry[];
  connection: "connecting" | "live" | "offline";
  loading?: boolean;
  error?: string;
  nextEventName?: string;
  demo?: boolean;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [fullscreenError, setFullscreenError] = useState("");

  useEffect(() => {
    const update = () => {
      setFullscreen(document.fullscreenElement === document.documentElement);
      setFullscreenSupported(Boolean(document.fullscreenEnabled));
    };
    update();
    document.addEventListener("fullscreenchange", update);
    return () => document.removeEventListener("fullscreenchange", update);
  }, []);

  async function toggleFullscreen() {
    setFullscreenError("");
    try {
      if (fullscreen) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setFullscreenError("Fullscreen is unavailable. Use your browser’s fullscreen option.");
    }
  }

  const highest = leaderboard[0];

  return (
    <main className={styles.screen}>
      <header className={styles.header}>
        <div className={`brand-lockup ${styles.brand}`} aria-label="Roland Berger Christmas Auction">
          <RbLogo />
          <span>Christmas Auction</span>
        </div>
        <div className={styles.controls}>
          <span className={styles.connection} role="status">
            <span className={connection === "live" && !error ? styles.liveDot : styles.offlineDot} aria-hidden="true" />
            {demo ? "Local demo" : error || connection === "offline" ? "Reconnecting" : connection === "live" ? "Live" : "Connecting"}
          </span>
          <button className={styles.fullscreenButton} type="button" onClick={toggleFullscreen} disabled={!fullscreenSupported}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d={fullscreen ? "M9 3v6H3m12-6v6h6M9 21v-6H3m12 6v-6h6" : "M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"} />
            </svg>
            {fullscreen ? "Exit fullscreen" : "Fullscreen"}
          </button>
        </div>
      </header>

      {fullscreenError && <p className={styles.message} role="status">{fullscreenError}</p>}
      {error && auction && <p className={styles.message} role="status">Live updates are temporarily unavailable. Reconnecting automatically.</p>}

      {auction ? (
        <div className={styles.content}>
          <section className={styles.event} aria-labelledby="presentation-event-title">
            {auction.image_url && (
              <div className={`event-image-frame ${styles.image}`}>
                <Image src={auction.image_url} alt={auction.title} fill sizes="(max-width: 900px) 100vw, 45vw" className="object-contain" />
              </div>
            )}
            <div className={styles.eventDetails}>
              <div className={styles.eventHeading}>
                <p className={styles.eyebrow}>Current event</p>
                <span className={`${styles.eventStatus} ${auction.status === "active" ? styles.active : ""}`}>
                  {auction.status === "active" ? "Live event" : auction.status === "ended" ? "Bidding closed" : "Starting soon"}
                </span>
              </div>
              <h1 id="presentation-event-title" className={styles.title}>{auction.title}</h1>
              {auction.description && !auction.image_url && <p className={styles.description}>{auction.description}</p>}
              <div className={styles.eventRules}>
                <div><span>Opening price</span><strong>{formatMoney(auction.starting_price, auction.currency)}</strong></div>
                <div><span>Winning places</span><strong>{auction.winner_count}</strong></div>
              </div>
              <AuctionTimer key={`${auction.id}:${auction.starts_at}`} startsAt={auction.starts_at} durationSeconds={auction.timer_duration_seconds} status={auction.status} className={styles.timer} compact />
            </div>
          </section>

          <section className={styles.leaderboard} aria-labelledby="presentation-leaderboard-title">
            <div className={styles.leaderboardHeader}>
              <div className={styles.eventHeading}>
                <h2 id="presentation-leaderboard-title">{auction.status === "ended" ? "Final leaderboard" : "Live leaderboard"}</h2>
                <span className={styles.bidderCount}>{leaderboard.length} {leaderboard.length === 1 ? "bidder" : "bidders"}</span>
              </div>
              <p className={styles.highestLabel}>{highest ? auction.status === "ended" ? "Highest bid" : "Current highest bid" : "Opening price"}</p>
              <p className={styles.highestAmount}>{formatMoney(highest?.amount ?? auction.starting_price, auction.currency)}</p>
              <p className={styles.leaderName}>{highest?.username ?? "Waiting for the first bid"}</p>
            </div>
            <PresentationLeaderboard key={auction.id} auction={auction} leaderboard={leaderboard} />
          </section>
        </div>
      ) : (
        <div className={styles.emptyScreen} role="status">
          <p className={styles.eyebrow}>Christmas Auction</p>
          <h1>{loading ? "Loading the event…" : error ? "Connecting to the auction…" : "Waiting for the first event"}</h1>
          <p>The current event and leaderboard will appear here automatically.</p>
        </div>
      )}

      <footer className={styles.footer}>
        <span>{auction?.status === "ended" ? "Final results" : "Leaderboard updates automatically"}</span>
        {nextEventName && <span className={styles.nextEvent}>Next event: <strong>{nextEventName}</strong></span>}
      </footer>
    </main>
  );
}

function PresentationLeaderboard({ auction, leaderboard }: { auction: Auction; leaderboard: LeaderboardEntry[] }) {
  const [page, setPage] = useState(0);
  const pageCount = Math.max(1, Math.ceil(leaderboard.length / LEADERBOARD_PAGE_SIZE));
  const currentPage = page % pageCount;

  useEffect(() => {
    if (pageCount <= 1) return;
    const interval = window.setInterval(() => setPage((value) => (value + 1) % pageCount), 8_000);
    return () => window.clearInterval(interval);
  }, [pageCount]);

  const entries = leaderboard.slice(currentPage * LEADERBOARD_PAGE_SIZE, (currentPage + 1) * LEADERBOARD_PAGE_SIZE);

  return (
    <div className={styles.ranking}>
      {entries.length ? (
        <ol className={styles.rankList} start={currentPage * LEADERBOARD_PAGE_SIZE + 1} aria-label="Ranked highest bids per participant">
          {entries.map((entry) => (
            <li key={entry.participant_id} className={`${styles.rankRow} ${entry.is_winner ? styles.winningRow : ""}`}>
              <span className={styles.rank}>#{entry.bidder_rank}</span>
              <div className={styles.bidder}>
                <strong>{entry.username}</strong>
                {entry.is_winner && <span className={styles.winnerBadge}>{auction.status === "ended" ? "Winner" : "Winning place"}</span>}
              </div>
              <strong className={styles.bidAmount}>{formatMoney(entry.amount, auction.currency)}</strong>
            </li>
          ))}
        </ol>
      ) : (
        <div className={styles.emptyLeaderboard}>
          <strong>No bids yet</strong>
          <p>{auction.status === "ended" ? "This event ended without a bid." : auction.status === "upcoming" ? "The leaderboard will appear when bidding begins." : "The first accepted bid will appear here."}</p>
        </div>
      )}
      <div className={styles.rankFooter}>
        <span>Highest bid per participant</span>
        {pageCount > 1 && <span>Page {currentPage + 1} / {pageCount} · rotates every 8s</span>}
      </div>
    </div>
  );
}
