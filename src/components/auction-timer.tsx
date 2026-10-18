"use client";

import { useEffect, useState } from "react";

import {
  formatAuctionTimer,
  remainingAuctionSeconds,
  remainingAuctionStartSeconds,
} from "@/lib/auction-timer";
import type { AuctionStatus } from "@/lib/types";

export function AuctionTimer({
  startsAt,
  durationSeconds,
  status,
  compact = false,
  className = "",
}: {
  startsAt: string | null;
  durationSeconds: number;
  status: AuctionStatus;
  compact?: boolean;
  className?: string;
}) {
  const [remainingSeconds, setRemainingSeconds] = useState(durationSeconds);
  const [startCountdownSeconds, setStartCountdownSeconds] = useState(0);

  useEffect(() => {
    if (status !== "active") return;
    const update = () => {
      setStartCountdownSeconds(remainingAuctionStartSeconds(startsAt));
      setRemainingSeconds(remainingAuctionSeconds(startsAt, durationSeconds));
    };
    const initialUpdate = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 250);
    return () => {
      window.clearTimeout(initialUpdate);
      window.clearInterval(interval);
    };
  }, [durationSeconds, startsAt, status]);

  if (status !== "active") return null;
  const starting = startCountdownSeconds > 0;
  const displayedSeconds = starting ? startCountdownSeconds : remainingSeconds;
  const elapsed = remainingSeconds === 0;

  return (
    <div
      className={`${className} rounded-2xl border ${elapsed ? "border-coral/25 bg-coral/10" : "border-forest/15 bg-forest/[.06]"} ${compact ? "px-4 py-3" : "p-5"}`}
      role="timer"
      aria-live={starting || remainingSeconds <= 10 ? "polite" : "off"}
      aria-label={starting
        ? `Bidding starts in ${startCountdownSeconds} seconds`
        : elapsed
          ? "The timer has elapsed; bidding remains open"
          : `${remainingSeconds} seconds remaining`}
    >
      <div className="flex items-center justify-between gap-5">
        <div>
          <p className={`font-bold uppercase tracking-[.15em] ${elapsed ? "text-coral" : "text-forest"} ${compact ? "text-[10px]" : "text-xs"}`}>
            {starting ? "Bidding starts in" : elapsed ? "Timer elapsed" : "Time remaining"}
          </p>
          <p className={`mt-1 text-ink/55 ${compact ? "text-xs" : "text-sm"}`}>
            {starting ? "Get ready." : "Bidding closes manually."}
          </p>
        </div>
        <strong className={`${elapsed ? "text-coral" : "text-ink"} tabular-nums tracking-[-.04em] ${compact ? "text-2xl" : "text-4xl"}`}>
          {formatAuctionTimer(displayedSeconds)}
        </strong>
      </div>
    </div>
  );
}
