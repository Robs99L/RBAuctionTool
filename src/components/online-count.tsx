"use client";

import { useOnlineCount } from "@/lib/use-online-count";

export function OnlineCount({ demo = false, className }: { demo?: boolean; className?: string }) {
  const count = useOnlineCount(demo);
  return (
    <span
      className={className ?? "inline-flex items-center gap-1.5 rounded-full border border-forest/15 bg-forest/5 px-3 py-1.5 text-sm font-semibold text-forest"}
      role="status"
      aria-label={count === null ? "Online count unavailable" : `${count} ${count === 1 ? "person" : "people"} online`}
      title="Connected browsers across all views; multiple tabs count once."
      data-online-count={count ?? "unavailable"}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.87M15 3.13a4 4 0 0 1 0 7.75" />
        <circle cx="9" cy="7" r="4" />
      </svg>
      <span>{count ?? "—"} <span className="max-[420px]:sr-only">online</span></span>
    </span>
  );
}
