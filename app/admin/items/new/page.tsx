import type { Metadata } from "next";
import AuctionItemForm from "../../../auction-item-form";

export const metadata: Metadata = {
  title: "New auction item | New Horizons Auction",
};

export default function NewAuctionItemPage() {
  return <AuctionItemForm key="new-item" />;
}
