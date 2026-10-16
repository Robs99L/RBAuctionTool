import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Christmas Auction",
  description: "The Christmas Auction bidding experience.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
