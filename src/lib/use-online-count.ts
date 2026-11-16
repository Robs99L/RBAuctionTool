"use client";

import { useEffect, useSyncExternalStore } from "react";
import { createOnlineCountStore, getOnlineBrowserKey, subscribeOnlineCount } from "@/lib/auction-presence";
import { browserDemoMode } from "@/lib/deployment-mode";
import { getSupabaseBrowserClient, hasSupabaseBrowserConfig } from "@/lib/supabase-browser";

const unavailable = () => null;
const noSubscription: (listener: () => void) => () => void = () => () => {};
const demoStore = { subscribe: noSubscription, getSnapshot: () => 1 };
const disabledStore = { subscribe: noSubscription, getSnapshot: unavailable };
const liveStore = createOnlineCountStore(onCount => {
  // Access to localStorage itself can be blocked by browser privacy settings.
  const storage = {
    getItem: (key: string) => window.localStorage.getItem(key),
    setItem: (key: string, value: string) => window.localStorage.setItem(key, value),
  };
  return subscribeOnlineCount(getSupabaseBrowserClient(), getOnlineBrowserKey(storage), onCount);
});

function onlineStore(demo: boolean) {
  const configured = hasSupabaseBrowserConfig();
  if (demo || browserDemoMode(configured)) return demoStore;
  return configured ? liveStore : disabledStore;
}

export function useOnlineCount(demo = false) {
  const store = onlineStore(demo);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, unavailable);
}

/** Participant pages contribute presence without re-rendering on every arrival. */
export function useTrackOnline(demo = false) {
  const store = onlineStore(demo);
  useEffect(() => store.subscribe(() => {}), [store]);
}
