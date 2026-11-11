"use client";

import { useSyncExternalStore } from "react";

import { hasAuctionClock, synchronizeAuctionClock } from "@/lib/auction-clock";

const listeners = new Set<() => void>();
let pending: Promise<void> | null = null;
let interval: ReturnType<typeof setInterval> | null = null;
let retry: ReturnType<typeof setTimeout> | null = null;

function synchronize() {
  if (pending) return;
  if (retry !== null) clearTimeout(retry);
  retry = null;
  pending = synchronizeAuctionClock()
    .then(() => { for (const listener of listeners) listener(); })
    .catch(() => {
      // Keep a previously synchronized clock; retry an initial failure promptly.
      if (!hasAuctionClock() && listeners.size) retry = setTimeout(synchronize, 5_000);
    })
    .finally(() => { pending = null; });
}

function synchronizeWhenVisible() {
  if (document.visibilityState === "visible") synchronize();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (listeners.size === 1) {
    synchronize();
    interval = setInterval(synchronizeWhenVisible, 60_000);
    window.addEventListener("online", synchronize);
    document.addEventListener("visibilitychange", synchronizeWhenVisible);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      if (interval !== null) clearInterval(interval);
      interval = null;
      if (retry !== null) clearTimeout(retry);
      retry = null;
      window.removeEventListener("online", synchronize);
      document.removeEventListener("visibilitychange", synchronizeWhenVisible);
    }
  };
}

export function useAuctionClock() {
  return useSyncExternalStore(subscribe, hasAuctionClock, () => false);
}
