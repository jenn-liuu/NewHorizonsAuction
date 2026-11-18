"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import { supabase } from "@/supabase";
import { useBidderAuth } from "./components/bidder-auth-provider";

type ItemStatus = "draft" | "published";
type AccessState =
  | "checking"
  | "signed-out"
  | "not-admin"
  | "disabled"
  | "error"
  | "ready";

type AccessResult = {
  userId: string | null;
  state: AccessState;
  message: string;
};

type FormValues = {
  title: string;
  description: string;
  retailValue: string;
  startingBid: string;
  bidIncrement: string;
  donorWebsite: string;
  status: ItemStatus;
};

type ApiMessage = { message?: string };

const initialValues: FormValues = {
  title: "",
  description: "",
  retailValue: "",
  startingBid: "",
  bidIncrement: "25",
  donorWebsite: "",
  status: "draft",
};

const fieldClassName =
  "mt-2 block w-full rounded-lg border border-stone-300 bg-white px-3.5 py-2.5 text-sm text-stone-900 shadow-sm outline-none transition placeholder:text-stone-500 focus-visible:border-stone-950 focus-visible:ring-2 focus-visible:ring-stone-950/25";
const labelClassName = "block text-sm font-medium text-stone-800";

export default function AuctionItemForm() {
  const { user, loading: authLoading } = useBidderAuth();
  const [item, setItem] = useState(initialValues);
  const [accessResult, setAccessResult] = useState<AccessResult | null>(null);
  const [feedback, setFeedback] = useState<{
    kind: "success" | "error";
    message: string;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const currentUserId = user?.id ?? null;
  const access: AccessState = authLoading
    ? "checking"
    : !currentUserId
      ? "signed-out"
      : !supabase
        ? "disabled"
        : accessResult?.userId === currentUserId
          ? accessResult.state
          : "checking";
  const accessMessage =
    !supabase
      ? "Supabase is not configured in this environment."
      : accessResult?.userId === currentUserId
        ? accessResult.message
        : "";

  useEffect(() => {
    const userId = currentUserId;
    if (authLoading || !userId || !supabase) return;

    let active = true;
    const client = supabase;

    async function checkAccess() {
      try {
        const { data, error } = await client.auth.getSession();
        if (!active) return;
        if (error) {
          setAccessResult({
            userId,
            state: "error",
            message: "Could not verify your sign-in session. Please sign in again.",
          });
          return;
        }
        if (!data.session) {
          setAccessResult({
            userId,
            state: "signed-out",
            message: "Your session has expired. Please sign in again.",
          });
          return;
        }

        const response = await fetch("/api/admin/items", {
          headers: {
            Authorization: `Bearer ${data.session.access_token}`,
          },
          cache: "no-store",
        });
        const result = (await response.json()) as ApiMessage;
        if (!active) return;
        if (response.ok) {
          setAccessResult({
            userId,
            state: "ready",
            message: "",
          });
          return;
        }
        setAccessResult({
          userId,
          state:
            response.status === 401
              ? "signed-out"
              : response.status === 403
                ? "not-admin"
                : response.status === 503
                  ? "disabled"
                  : "error",
          message:
            result.message ??
            "Could not verify admin access. Saving is disabled.",
        });
      } catch {
        if (!active) return;
        setAccessResult({
          userId,
          state: "error",
          message:
            "Could not reach the server to verify admin access. Saving is disabled.",
        });
      }
    }

    void checkAccess();
    return () => {
      active = false;
    };
  }, [authLoading, currentUserId]);

  function updateField<Field extends keyof FormValues>(
    field: Field,
    value: FormValues[Field],
  ) {
    setItem((current) => ({ ...current, [field]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || access !== "ready" || !supabase) return;

    setSaving(true);
    setFeedback(null);
    try {
      const { data, error } = await supabase.auth.getSession();
      if (error || !data.session) {
        setFeedback({
          kind: "error",
          message: "Your session could not be verified. Sign in again; your entries are still here.",
        });
        if (currentUserId) {
          setAccessResult({
            userId: currentUserId,
            state: "signed-out",
            message: "Your session has expired. Please sign in again.",
          });
        }
        return;
      }

      const response = await fetch("/api/admin/items", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${data.session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(item),
      });
      const result = (await response.json()) as ApiMessage;
      if (!response.ok) {
        setFeedback({
          kind: "error",
          message:
            result.message ??
            "The item was not saved. Your entries are still here.",
        });
        if (response.status === 401 || response.status === 403) {
          if (currentUserId) {
            setAccessResult({
              userId: currentUserId,
              state: response.status === 403 ? "not-admin" : "signed-out",
              message:
                result.message ?? "Admin access could not be verified.",
            });
          }
        } else if (response.status === 503) {
          if (currentUserId) {
            setAccessResult({
              userId: currentUserId,
              state: "disabled",
              message: result.message ?? "Saving is not enabled yet.",
            });
          }
        }
        return;
      }

      setFeedback({
        kind: "success",
        message: result.message ?? "Item saved successfully.",
      });
    } catch {
      setFeedback({
        kind: "error",
        message:
          "We could not reach the server. The item was not saved, and your entries are still here.",
      });
    } finally {
      setSaving(false);
    }
  }

  const canSave = access === "ready" && !saving;

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-10 font-sans text-stone-900 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-4xl">
        <div className="mb-7 overflow-hidden rounded-xl bg-stone-950 text-white shadow-sm">
          <div className="border-b border-stone-700 px-5 py-4 sm:px-7">
            <p className="font-serif text-xl font-semibold tracking-wide">
              New Horizons
            </p>
            <p className="mt-1 text-xs tracking-wide text-stone-300">
              Annual auction · Item preparation
            </p>
          </div>
        </div>

        <header className="mb-8">
          <h1 className="font-serif text-3xl font-semibold tracking-tight text-stone-950 sm:text-4xl">
            Prepare your auction item
          </h1>
          <p className="mt-3 max-w-2xl text-base leading-7 text-stone-700">
            Add the item details and bidding amounts that appear in the public
            catalog.
          </p>
        </header>

        <form
          className="overflow-hidden rounded-xl border border-stone-300 bg-white shadow-md shadow-stone-900/5"
          onSubmit={submit}
        >
          <section
            aria-labelledby="item-details-heading"
            className="space-y-6 p-5 sm:p-8"
          >
            <div>
              <h2
                className="font-serif text-xl font-semibold text-stone-950"
                id="item-details-heading"
              >
                Item details
              </h2>
              <p className="mt-1 text-sm leading-6 text-stone-700">
                Tell bidders what makes this donated item special.
              </p>
            </div>

            <div>
              <label className={labelClassName} htmlFor="title">
                Item title <span className="text-rose-700">*</span>
              </label>
              <input
                autoComplete="off"
                className={fieldClassName}
                id="title"
                maxLength={200}
                name="title"
                onChange={(event) => updateField("title", event.target.value)}
                placeholder="For example, Leather western saddle"
                required
                value={item.title}
              />
            </div>

            <div>
              <label className={labelClassName} htmlFor="description">
                Description <span className="text-rose-700">*</span>
              </label>
              <textarea
                className={fieldClassName}
                id="description"
                maxLength={5000}
                name="description"
                onChange={(event) =>
                  updateField("description", event.target.value)
                }
                placeholder="Share the details bidders will want to know."
                required
                rows={4}
                value={item.description}
              />
            </div>

            <div className="max-w-sm">
              <label className={labelClassName} htmlFor="donorWebsite">
                Donor website{" "}
                <span className="font-normal text-stone-500">(optional)</span>
              </label>
              <input
                className={fieldClassName}
                id="donorWebsite"
                maxLength={2048}
                name="donorWebsite"
                onChange={(event) =>
                  updateField("donorWebsite", event.target.value)
                }
                placeholder="https://example.com"
                type="url"
                value={item.donorWebsite}
              />
              <p className="mt-2 text-sm leading-6 text-stone-700">
                Saved to the catalog&apos;s donor link field.
              </p>
            </div>

            <div className="max-w-sm">
              <label className={labelClassName} htmlFor="status">
                Item status
              </label>
              <select
                className={fieldClassName}
                id="status"
                name="status"
                onChange={(event) => {
                  if (
                    event.target.value === "draft" ||
                    event.target.value === "published"
                  ) {
                    updateField("status", event.target.value);
                  }
                }}
                value={item.status}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
              <p className="mt-2 text-sm leading-6 text-stone-700">
                New items stay as drafts unless you explicitly choose Published.
              </p>
            </div>

            <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
              Not saved yet: category, donor name, breeding details, auction
              schedule, and photos. Those fields are hidden until database
              support is confirmed.
            </p>
          </section>

          <section
            aria-labelledby="bidding-heading"
            className="space-y-6 border-t border-stone-200 p-5 sm:p-8"
          >
            <div>
              <h2
                className="font-serif text-xl font-semibold text-stone-950"
                id="bidding-heading"
              >
                Value and bidding
              </h2>
              <p className="mt-1 text-sm leading-6 text-stone-700">
                Monetary amounts are entered and stored in dollars, matching
                the catalog&apos;s retail_value, minimum_bid, and bid_increment
                fields.
              </p>
            </div>

            <div className="grid gap-5 sm:grid-cols-3">
              {(
                [
                  ["retailValue", "Retail value ($)", "0.00"],
                  ["startingBid", "Starting bid ($)", "0.00"],
                  ["bidIncrement", "Bid increment ($)", "25.00"],
                ] as const
              ).map(([field, label, placeholder]) => (
                <div key={field}>
                  <label className={labelClassName} htmlFor={field}>
                    {label} <span className="text-rose-700">*</span>
                  </label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-sm text-stone-500">
                      $
                    </span>
                    <input
                      className={`${fieldClassName} pl-8`}
                      id={field}
                      inputMode="decimal"
                      min={field === "bidIncrement" ? "0.01" : "0"}
                      name={field}
                      onChange={(event) =>
                        updateField(field, event.target.value)
                      }
                      placeholder={placeholder}
                      required
                      step="0.01"
                      type="number"
                      value={item[field]}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section
            aria-labelledby="access-heading"
            className="space-y-4 border-t border-stone-200 p-5 sm:p-8"
          >
            <h2
              className="font-serif text-xl font-semibold text-stone-950"
              id="access-heading"
            >
              Save access
            </h2>
            {access === "checking" && (
              <p className="text-sm text-stone-700" role="status">
                Checking your sign-in and approved-admin access…
              </p>
            )}
            {access === "ready" && (
              <p className="text-sm text-emerald-800" role="status">
                Approved-admin membership is verified. The item INSERT is
                independently checked by database RLS.
              </p>
            )}
            {access === "signed-out" && (
              <p className="text-sm text-stone-700">
                <Link
                  className="font-semibold underline underline-offset-2"
                  href="/login"
                >
                  Sign in
                </Link>{" "}
                with an approved admin account to create an item.
                {accessMessage ? ` ${accessMessage}` : ""}
              </p>
            )}
            {(access === "not-admin" ||
              access === "disabled" ||
              access === "error") && (
              <p className="text-sm text-rose-800" role="alert">
                {accessMessage || "Admin access could not be verified. Saving is disabled."}
              </p>
            )}
            {feedback && (
              <p
                className={`rounded-lg border p-4 text-sm ${
                  feedback.kind === "success"
                    ? "border-emerald-200 bg-emerald-50 text-emerald-900"
                    : "border-rose-200 bg-rose-50 text-rose-800"
                }`}
                role={feedback.kind === "error" ? "alert" : "status"}
              >
                {feedback.message}
              </p>
            )}
          </section>

          <footer className="flex flex-col gap-4 border-t border-stone-200 bg-stone-50 p-5 sm:flex-row sm:items-center sm:justify-between sm:px-8">
            <p className="max-w-lg text-sm leading-5 text-stone-600">
              Saving remains disabled until the reviewed admin migration is
              applied and the server-side access check is enabled.
            </p>
            <button
              aria-busy={saving}
              className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-lg bg-stone-950 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-stone-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-stone-950 disabled:cursor-not-allowed disabled:bg-stone-300 disabled:text-stone-700"
              disabled={!canSave}
              type="submit"
            >
              {saving ? "Saving item…" : "Save item"}
            </button>
          </footer>
        </form>
      </div>
    </main>
  );
}
