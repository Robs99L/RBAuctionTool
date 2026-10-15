"use client";

import { useEffect, useState } from "react";

import {
  AUCTION_TIMER_SECONDS,
  formatAuctionTimer,
  remainingAuctionSeconds,
} from "@/lib/auction-timer";
import type { AuctionStatus } from "@/lib/types";

export function AuctionTimer({
  startsAt,
  status,
  compact = false,
  className = "",
}: {
  startsAt: string | null;
  status: AuctionStatus;
  compact?: boolean;
  className?: string;
}) {
  const [remainingSeconds, setRemainingSeconds] = useState(AUCTION_TIMER_SECONDS);

  useEffect(() => {
    if (status !== "active") return;
    const update = () => setRemainingSeconds(remainingAuctionSeconds(startsAt));
    const initialUpdate = window.setTimeout(update, 0);
    const interval = window.setInterval(update, 250);
    return () => {
      window.clearTimeout(initialUpdate);
      window.clearInterval(interval);
    };
  }, [startsAt, status]);

  if (status !== "active") return null;
  const elapsed = remainingSeconds === 0;

  return (
    <div
      className={`${className} rounded-2xl border ${elapsed ? "border-coral/25 bg-coral/10" : "border-forest/15 bg-forest/[.06]"} ${compact ? "px-4 py-3" : "p-5"}`}
      role="timer"
      aria-live={remainingSeconds <= 10 ? "polite" : "off"}
      aria-label={elapsed ? "The two-minute timer has elapsed; bidding remains open" : `${remainingSeconds} seconds remaining`}
    >
      <div className="flex items-center justify-between gap-5">
        <div>
          <p className={`font-bold uppercase tracking-[.15em] ${elapsed ? "text-coral" : "text-forest"} ${compact ? "text-[10px]" : "text-xs"}`}>
            {elapsed ? "Timer elapsed" : "Time remaining"}
          </p>
          <p className={`mt-1 text-ink/55 ${compact ? "text-xs" : "text-sm"}`}>
            Bidding closes manually.
          </p>
        </div>
        <strong className={`${elapsed ? "text-coral" : "text-ink"} tabular-nums tracking-[-.04em] ${compact ? "text-2xl" : "text-4xl"}`}>
          {formatAuctionTimer(remainingSeconds)}
        </strong>
      </div>
    </div>
  );
}
