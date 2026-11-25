import { Suspense } from "react";
import type { Metadata } from "next";
import AuctionItemForm from "../../../auction-item-form";

export const metadata: Metadata = {
  title: "Edit auction item | New Horizons Auction",
};

export default function EditAuctionItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-stone-50 px-4 py-10 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-4xl text-sm text-stone-700">
            Loading saved item…
          </div>
        </main>
      }
    >
      <EditAuctionItemForm params={params} />
    </Suspense>
  );
}

async function EditAuctionItemForm({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AuctionItemForm itemId={id} />;
}
