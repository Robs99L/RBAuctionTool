import Link from "next/link";

import { AdminPanel } from "@/components/admin-panel";
import { RbLogo } from "@/components/rb-logo";

export const metadata = { title: "Administration | Christmas Auction" };

export default function AdminPage() {
  return (
    <main className="min-h-dvh bg-cream px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <Link href="/" className="brand-lockup" aria-label="Back to Christmas Auction">
            <RbLogo />
            <span className="max-w-44 text-sm leading-tight sm:max-w-none sm:text-base">
              Christmas Auction
            </span>
          </Link>
          <nav className="flex flex-wrap items-center gap-4" aria-label="Auction views">
            <Link className="text-link" href="/">View auction</Link>
            <Link className="btn-secondary gap-2" href="/presentation" target="_blank" rel="noopener noreferrer">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                <rect x="3" y="3" width="18" height="13" rx="2" />
                <path d="M12 16v5m-5 0h10" />
              </svg>
              Presentation view
              <span className="sr-only"> (opens in a new tab)</span>
            </Link>
          </nav>
        </header>
        <AdminPanel />
      </div>
    </main>
  );
}
