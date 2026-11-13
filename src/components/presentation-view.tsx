"use client";

import Image from "next/image";
import { useEffect, useId, useState, type CSSProperties } from "react";

import { AuctionTimer } from "@/components/auction-timer";
import { RbLogo } from "@/components/rb-logo";
import { formatMoney } from "@/lib/format";
import type { Auction, LeaderboardEntry } from "@/lib/types";

import styles from "./presentation-view.module.css";

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

  const winners = leaderboard.filter(entry => entry.is_winner);

  return (
    <main className={styles.screen}>
      <Snowfall />
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
        <ChristmasLights />
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
                <span className={`${styles.eventStatus} ${auction.status === "active" ? styles.active : auction.status === "ended" ? styles.closed : ""}`}>
                  {auction.status === "active" ? "Live event" : auction.status === "ended" ? "Bidding closed" : "Starting soon"}
                </span>
              </div>
              <h1 id="presentation-event-title" className={styles.title}>{auction.title}</h1>
              {auction.description && !auction.image_url && <p className={styles.description}>{auction.description}</p>}
              <div className={styles.eventRules}>
                <div><span>Winning places</span><strong>{auction.winner_count}</strong></div>
              </div>
              <AuctionTimer key={`${auction.id}:${auction.starts_at}`} startsAt={auction.starts_at} durationSeconds={auction.timer_duration_seconds} status={auction.status} className={styles.timer} compact />
            </div>
          </section>

          <div className={styles.leaderboardFrame}>
            <SantaHat />
            <section className={styles.leaderboard} aria-labelledby="presentation-leaderboard-title">
              <div className={styles.leaderboardHeader}>
                <div className={styles.eventHeading}>
                  <h2 id="presentation-leaderboard-title">{auction.status === "ended" ? "Final leaderboard" : "Live leaderboard"}</h2>
                  <span className={styles.bidderCount}>{winners.length} {winners.length === 1 ? "winner" : "winners"}</span>
                </div>
              </div>
              <PresentationLeaderboard key={auction.id} auction={auction} winners={winners} />
            </section>
          </div>
        </div>
      ) : (
        <div className={styles.emptyScreen} role="status">
          <p className={styles.eyebrow}>Christmas Auction</p>
          <h1>{loading ? "Loading the event…" : error ? "Connecting to the auction…" : "Waiting for the first event"}</h1>
          <p>The current event and leaderboard will appear here automatically.</p>
        </div>
      )}

      <footer className={styles.footer}>
        <ChristmasGifts />
        <span>{auction?.status === "ended" ? "Final results" : "Leaderboard updates automatically"}</span>
        {nextEventName && <span className={styles.nextEvent}>Next event: <strong>{nextEventName}</strong></span>}
      </footer>
    </main>
  );
}

function Snowfall() {
  return (
    <div className={styles.snowfall} aria-hidden="true">
      {Array.from({ length: 144 }, (_, index) => (
        <span
          key={index}
          className={styles.snowflake}
          style={{
            left: `${(index * 37 + 11) % 100}%`,
            width: `${4 + (index % 6)}px`,
            height: `${4 + (index % 6)}px`,
            opacity: 0.65 + (index % 4) * 0.1,
            animationDuration: `${10 + (index % 6) * 2}s`,
            animationDelay: `${-((index * 7.3) % 20)}s`,
          }}
        />
      ))}
    </div>
  );
}

function ChristmasLights() {
  const strandId = useId();
  const bulbs = [30, 90, 150, 210, 270, 330];
  const colors = ["#edc973", "#cb5361", "#89bfa0"];
  return (
    <svg className={styles.christmasLights} aria-hidden="true" focusable="false">
      <defs>
        <pattern id={strandId} width="360" height="36" patternUnits="userSpaceOnUse">
          <path d="M0 5Q90 29 180 5Q270 29 360 5" fill="none" stroke="#417052" strokeWidth="2" />
          {bulbs.map((x, index) => {
            const y = index % 3 === 1 ? 17 : 12;
            const color = colors[index % colors.length];
            return (
              <g key={x}>
                <ellipse cx={x} cy={y + 7} rx="12" ry="12" fill={color} opacity=".12" />
                <ellipse cx={x} cy={y + 7} rx="8" ry="9" fill={color} opacity=".24" />
                <rect x={x - 2.5} y={y - 2} width="5" height="5" rx="1" fill="#417052" />
                <ellipse cx={x} cy={y + 7} rx="4.5" ry="6" fill={color} stroke="#fff8e8" strokeWidth=".6" />
                <path d={`M${x - 1.5} ${y + 5}v3`} stroke="#fff8e8" strokeWidth="1.2" strokeLinecap="round" opacity=".9" />
              </g>
            );
          })}
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${strandId})`} />
    </svg>
  );
}

function SantaHat() {
  return (
    <svg className={styles.santaHat} viewBox="0 0 112 96" aria-hidden="true" focusable="false">
      <path d="M18 72C20 51 27 31 43 19C59 7 75 14 89 35L88 49C79 37 69 32 59 34C58 46 68 56 80 72L79 80Z" fill="#b62e42" />
      <path d="M29 57C33 36 46 23 60 23" fill="none" stroke="#d85b66" strokeWidth="5" strokeLinecap="round" />
      <path d="M58 34C54 46 61 60 70 70" fill="none" stroke="#922238" strokeWidth="3" strokeLinecap="round" opacity=".5" />
      <path d="M16 68C34 63 63 64 80 73C87 76 87 85 80 88C62 80 40 77 21 82C14 84 11 75 16 68Z" fill="#fffaf0" stroke="#e7dfd1" strokeWidth="1.5" />
      <path d="M22 77C40 72 60 76 77 82" fill="none" stroke="#eee7dc" strokeWidth="2" strokeLinecap="round" />
      <circle cx="91" cy="49" r="11" fill="#fffaf0" stroke="#e7dfd1" strokeWidth="1.5" />
      <path d="M85 51Q90 56 96 51" fill="none" stroke="#eee7dc" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function ChristmasGifts() {
  return (
    <svg className={styles.christmasGifts} viewBox="0 0 160 84" aria-hidden="true" focusable="false">
      <ellipse cx="80" cy="79" rx="75" ry="3" fill="#061431" opacity=".08" />
      <rect x="9" y="39" width="48" height="38" rx="3" fill="#396c55" />
      <path d="M13 50H53M13 61H53" stroke="#5b866e" strokeWidth="1" />
      <rect x="5" y="31" width="56" height="12" rx="3" fill="#2b5946" />
      <path d="M33 31C13 30 15 17 23 19C30 20 34 31 33 31ZM33 31C49 30 49 19 42 20C36 21 33 31 33 31Z" fill="none" stroke="#dbbe79" strokeWidth="4" />
      <path d="M28 33H38V77H28Z" fill="#dbbe79" />
      <rect x="63" y="29" width="54" height="49" rx="3" fill="#b63b4b" />
      <path d="M68 44H112M68 58H112" stroke="#ce6570" strokeWidth="1" />
      <rect x="58" y="21" width="64" height="12" rx="3" fill="#9d2d40" />
      <path d="M90 22C68 21 68 5 78 7C87 8 92 22 90 22ZM90 22C114 23 116 5 105 7C95 9 90 22 90 22Z" fill="none" stroke="#e3c98b" strokeWidth="4" />
      <path d="M84 24H96V78H84Z" fill="#e3c98b" />
      <rect x="122" y="47" width="30" height="30" rx="2" fill="#d1b274" />
      <rect x="118" y="40" width="38" height="10" rx="2" fill="#be9959" />
      <path d="M137 40C122 39 122 29 129 31C134 32 137 40 137 40ZM137 40C150 39 151 30 145 31C140 32 137 40 137 40Z" fill="none" stroke="#38624e" strokeWidth="3" />
      <path d="M133 42H141V77H133Z" fill="#38624e" />
    </svg>
  );
}

function PresentationLeaderboard({ auction, winners }: { auction: Auction; winners: LeaderboardEntry[] }) {
  const ended = auction.status === "ended";

  return (
    <div className={styles.ranking}>
      {winners.length ? (
        <ol
          className={styles.rankList}
          style={{ "--leaderboard-rows": winners.length } as CSSProperties}
          aria-label={ended ? "Final winners and winning bids" : "Current winning bidders"}
        >
          {winners.map((entry) => (
            <li key={entry.participant_id} className={`${styles.rankRow} ${styles.winningRow} ${ended ? "" : styles.namesOnly}`}>
              <span className={styles.rank}>#{entry.bidder_rank}</span>
              <div className={styles.bidder}>
                <strong>{entry.username}</strong>
                <span className={styles.winnerBadge}>{ended ? "Winner" : "Winning place"}</span>
              </div>
              {ended && <strong className={styles.bidAmount}>{formatMoney(entry.amount, auction.currency)}</strong>}
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
        <span>{ended ? "Final winning bids" : "Current winners"}</span>
        <span>{ended ? `${winners.length} ${winners.length === 1 ? "winner" : "winners"}` : "Amounts revealed when bidding closes"}</span>
      </div>
    </div>
  );
}
