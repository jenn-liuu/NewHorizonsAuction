"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { supabase } from "@/supabase";
import { useBidderAuth } from "../../components/bidder-auth-provider";

type ManagedItem = {
  id: string;
  title: string;
  description: string | null;
  retail_value: number | null;
  minimum_bid: number | null;
  bid_increment: number | null;
  donor_url: string | null;
  status: "draft" | "published";
  created_at: string;
};

type ApiResult = { items?: ManagedItem[]; message?: string };

function ItemSection({
  title,
  items,
}: {
  title: string;
  items: ManagedItem[];
}) {
  return (
    <section className="mt-8" aria-labelledby={`${title.toLowerCase()}-heading`}>
      <h2
        className="font-serif text-2xl font-semibold text-stone-950"
        id={`${title.toLowerCase()}-heading`}
      >
        {title} <span className="text-base font-normal text-stone-600">({items.length})</span>
      </h2>
      {items.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-stone-300 bg-white p-6 text-sm text-stone-700">
          No {title.toLowerCase()} items.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-stone-200 overflow-hidden rounded-lg border border-stone-200 bg-white">
          {items.map((item) => (
            <li
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"
              key={item.id}
            >
              <div>
                <h3 className="font-semibold text-stone-950">{item.title}</h3>
                <p className="mt-1 line-clamp-2 text-sm text-stone-600">
                  {item.description || "No description yet"}
                </p>
                <p className="mt-1 text-xs text-stone-500">
                  Created {new Date(item.created_at).toLocaleDateString()}
                </p>
              </div>
              <Link
                className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg border border-stone-400 px-4 py-2 text-sm font-semibold text-stone-900 hover:bg-stone-100"
                href={`/admin/items/${encodeURIComponent(item.id)}`}
              >
                Edit item
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function AdminItemsPage() {
  const { user, loading: authLoading } = useBidderAuth();
  const [items, setItems] = useState<ManagedItem[]>([]);
  const [loadingItems, setLoadingItems] = useState(true);
  const [messageForUser, setMessageForUser] = useState<{
    userId: string;
    text: string;
  } | null>(null);
  const [verifiedAdminUserId, setVerifiedAdminUserId] = useState<string | null>(
    null,
  );
  const isAdmin = user !== null && verifiedAdminUserId === user.id;
  const hasMessageForCurrentUser =
    messageForUser?.userId === user?.id && messageForUser !== null;
  const loadingCurrentUserItems =
    Boolean(user && supabase) &&
    (loadingItems ||
      (verifiedAdminUserId !== user?.id && !hasMessageForCurrentUser));
  const message =
    !authLoading && !user
      ? "Sign in with an approved admin account to manage items."
      : user && !supabase
        ? "Supabase is not configured in this environment."
        : messageForUser && user && messageForUser.userId === user.id
          ? messageForUser.text
          : null;

  useEffect(() => {
    if (authLoading || !user || !supabase) return;

    const userId = user.id;
    let active = true;
    const client = supabase;

    async function loadItems() {
      try {
        const { data, error } = await client.auth.getSession();
        if (error || !data.session) {
          throw new Error("Your session has expired. Please sign in again.");
        }
        const response = await fetch("/api/admin/items?list=true", {
          headers: { Authorization: `Bearer ${data.session.access_token}` },
          cache: "no-store",
        });
        const result = (await response.json()) as ApiResult;
        if (!response.ok) {
          if (response.status === 403) setVerifiedAdminUserId(null);
          throw new Error(
            result.message ?? "The item list could not be loaded.",
          );
        }
        if (!active) return;
        setVerifiedAdminUserId(userId);
        setItems(result.items ?? []);
        setMessageForUser(null);
      } catch (error) {
        if (!active) return;
        setMessageForUser({
          userId,
          text:
            error instanceof Error
              ? error.message
              : "The item list could not be loaded.",
        });
      } finally {
        if (active) setLoadingItems(false);
      }
    }

    void loadItems();
    return () => {
      active = false;
    };
  }, [authLoading, user]);

  const drafts = items.filter((item) => item.status === "draft");
  const published = items.filter((item) => item.status === "published");

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10 font-sans text-stone-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-stone-600">
              New Horizons Auction
            </p>
            <h1 className="mt-2 font-serif text-3xl font-semibold text-stone-950 sm:text-4xl">
              Item management
            </h1>
            <p className="mt-2 text-stone-700">
              Return to drafts or edit items already in the catalog.
            </p>
          </div>
          {isAdmin && (
            <Link
              className="inline-flex min-h-11 items-center justify-center rounded-lg bg-stone-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-stone-800"
              href="/admin/items/new"
            >
              Add item
            </Link>
          )}
        </header>

        {(authLoading || loadingCurrentUserItems) && (
          <p className="mt-8 text-sm text-stone-700" role="status">
            Loading items…
          </p>
        )}
        {message && (
          <div className="mt-8 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
            <p role="alert">{message}</p>
            {!user && (
              <Link
                className="mt-2 inline-block font-semibold underline underline-offset-2"
                href="/login"
              >
                Sign in
              </Link>
            )}
          </div>
        )}
        {!loadingCurrentUserItems && !authLoading && isAdmin && (
          <>
            <ItemSection title="Draft" items={drafts} />
            <ItemSection title="Published" items={published} />
          </>
        )}
      </div>
    </main>
  );
}
