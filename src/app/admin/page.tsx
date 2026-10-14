import Link from "next/link";

import { AdminPanel } from "@/components/admin-panel";

export const metadata = { title: "Auction administration" };

export default function AdminPage() {
  return (
    <main className="min-h-screen bg-cream px-4 py-6 sm:px-8 sm:py-10">
      <div className="mx-auto max-w-7xl">
        <header className="mb-8 flex items-center justify-between">
          <Link href="/" className="brand-lockup" aria-label="Back to live auction">
            <span className="brand-mark">A</span>
            <span>Live Auction</span>
          </Link>
          <Link className="text-link" href="/">View auction</Link>
        </header>
        <AdminPanel />
      </div>
    </main>
  );
}
