import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Live Auction",
  description: "A secure realtime auction experience.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
