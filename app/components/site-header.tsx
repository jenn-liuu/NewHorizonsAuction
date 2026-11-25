"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/supabase";
import { AuctionWordmark } from "./auction-wordmark";
import { useBidderAuth } from "./bidder-auth-provider";

type AdminMembershipCheck = {
  user: User;
  status: "approved" | "not-approved" | "error";
};

const subscribeToHydration = () => () => {};
const getClientHydrationSnapshot = () => true;
const getServerHydrationSnapshot = () => false;

export function SiteHeader() {
  const { user, loading, loggingOut, logout } = useBidderAuth();
  const pathname = usePathname();
  const isHydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const [membershipCheck, setMembershipCheck] =
    useState<AdminMembershipCheck | null>(null);

  useEffect(() => {
    if (loading || !user || !supabase) return;
    const client: NonNullable<typeof supabase> = supabase;
    const verifiedUser = user;
    const verifiedUserId = user.id;

    let active = true;

    async function verifyMembership() {
      try {
        const { data, error } = await client
          .from("approved_admins")
          .select("user_id")
          .eq("user_id", verifiedUserId)
          .maybeSingle();

        if (!active) return;
        if (error) {
          console.error(
            "Could not verify approved-admin navigation access.",
            error,
          );
          setMembershipCheck({ user: verifiedUser, status: "error" });
          return;
        }
        setMembershipCheck({
          user: verifiedUser,
          status: data ? "approved" : "not-approved",
        });
      } catch (error) {
        if (!active) return;
        console.error("Approved-admin navigation check failed.", error);
        setMembershipCheck({ user: verifiedUser, status: "error" });
      }
    }

    void verifyMembership();
    return () => {
      active = false;
    };
  }, [loading, user]);

  const isVerifiedAdmin =
    user !== null &&
    membershipCheck?.user === user &&
    membershipCheck.status === "approved";

  return (
    <header className="site-header">
      <div className="site-header-inner">
        <Link href="/" className="brand" aria-label="New Horizons Auction home">
          <AuctionWordmark />
        </Link>
        <nav aria-label="Account navigation">
          <Link
            href="/"
            className="nav-link"
            aria-current={pathname === "/" ? "page" : undefined}
          >
            Catalog
          </Link>
          {!isHydrated || loading ? (
            <span className="nav-status">Checking session…</span>
          ) : user ? (
            <>
              {isVerifiedAdmin && (
                <>
                  <Link
                    href="/admin/items"
                    className="nav-link"
                    aria-current={
                      pathname.startsWith("/admin/items") ? "page" : undefined
                    }
                  >
                    Manage items
                  </Link>
                  <Link
                    href="/admin/items/new"
                    className="nav-link"
                    aria-current={
                      pathname === "/admin/items/new" ? "page" : undefined
                    }
                  >
                    New item
                  </Link>
                </>
              )}
              <button
                type="button"
                className="nav-link nav-button"
                onClick={() => {
                  setMembershipCheck(null);
                  void logout();
                }}
                disabled={loggingOut}
              >
                {loggingOut ? "Signing out…" : "Log out"}
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="nav-link"
                aria-current={pathname === "/login" ? "page" : undefined}
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="nav-link"
                aria-current={pathname === "/register" ? "page" : undefined}
              >
                Register
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
