import { redirect } from "next/navigation";

import { AuctionApp } from "@/components/auction-app";
import { isAdminRequest } from "@/lib/admin-auth";

export const metadata = { title: "Live Presentation | Christmas Auction" };

export default async function PresentationPage() {
  if (!(await isAdminRequest())) redirect("/admin");

  return <AuctionApp presentation />;
}
