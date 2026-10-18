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
  eventName,
  nextEventName,
  compact = false,
  className = "",
}: {
  startsAt: string | null;
  durationSeconds: number;
  status: AuctionStatus;
  eventName?: string;
  nextEventName?: string | null;
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
      <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-5">
        <div className="min-w-0">
          <p className={`font-bold uppercase tracking-[.15em] ${elapsed ? "text-coral" : "text-forest"} ${compact ? "text-[10px]" : "text-xs"}`}>
            {starting ? "Bidding starts in" : elapsed ? "Timer elapsed" : "Time remaining"}
          </p>
          {eventName && (
            <p className={`break-words font-semibold text-ink ${compact ? "mt-1 text-sm" : "mt-2 text-base"}`}>
              {eventName}
            </p>
          )}
          {nextEventName && (
            <p className={`break-words text-ink/60 ${compact ? "mt-1 text-xs" : "mt-2 text-sm"}`}>
              <span className="font-semibold text-ink">Next Bidding:</span> {nextEventName}
            </p>
          )}
          {starting && (
            <p className={`mt-1 text-ink/55 ${compact ? "text-xs" : "text-sm"}`}>
              Get ready.
            </p>
          )}
        </div>
        <strong className={`${elapsed ? "text-coral" : "text-ink"} shrink-0 self-end tabular-nums sm:self-auto ${compact ? "text-2xl" : "text-4xl"}`}>
          {formatAuctionTimer(displayedSeconds)}
        </strong>
      </div>
    </div>
  );
}
