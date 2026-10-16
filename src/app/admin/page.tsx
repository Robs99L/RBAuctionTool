import Link from "next/link";

import { AdminPanel } from "@/components/admin-panel";
import { RbLogo } from "@/components/rb-logo";

export const metadata = { title: "Administration | Christmas Auction" };

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-cream px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <Link href="/" className="brand-lockup" aria-label="Back to Christmas Auction">
            <RbLogo />
            <span className="max-w-44 text-sm leading-tight sm:max-w-none sm:text-base">
              Christmas Auction
            </span>
          </Link>
          <Link className="text-link" href="/">View auction</Link>
        </header>
        <AdminPanel />
      </div>
    </main>
  );
}
