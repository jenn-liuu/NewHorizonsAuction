import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/supabase-url";
import { isItemCategory, type ItemCategory } from "@/item-categories";

type AuthorizationResult =
  | { ok: true; client: SupabaseClient }
  | { ok: false; response: Response };

export type ItemWrite = {
  title: string;
  description: string | null;
  retail_value: number | null;
  minimum_bid: number | null;
  bid_increment: number | null;
  donor_url: string | null;
  category: ItemCategory;
  status: "draft" | "published";
};

export function jsonResponse(body: object, status: number): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function authorizeApprovedAdmin(
  request: Request,
): Promise<AuthorizationResult> {
  const authorization = request.headers.get("authorization");
  const tokenMatch = authorization?.match(/^Bearer\s+(.+)$/i);
  if (!tokenMatch) {
    return {
      ok: false,
      response: jsonResponse(
        { message: "Sign in with an approved admin account to continue." },
        401,
      ),
    };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    return {
      ok: false,
      response: jsonResponse(
        { message: "Supabase is not configured. Saving is disabled." },
        503,
      ),
    };
  }

  const client = createClient(normalizeSupabaseUrl(url), publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: { Authorization: `Bearer ${tokenMatch[1]}` },
    },
  });

  let userId: string;
  try {
    const { data, error } = await client.auth.getUser(tokenMatch[1]);
    if (error || !data.user) {
      return {
        ok: false,
        response: jsonResponse(
          { message: "Your sign-in session is invalid or expired. Sign in again." },
          401,
        ),
      };
    }
    userId = data.user.id;
  } catch (error) {
    console.error("Could not verify the Supabase user session.", error);
    return {
      ok: false,
      response: jsonResponse(
        { message: "Could not verify your session. Saving is disabled." },
        503,
      ),
    };
  }

  try {
    const { data: membership, error } = await client
      .from("approved_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("Could not verify approved-admin membership.", error);
      return {
        ok: false,
        response: jsonResponse(
          {
            message:
              "Could not verify approved-admin access. Apply and verify the reviewed database migrations before enabling saves.",
          },
          503,
        ),
      };
    }
    if (!membership) {
      return {
        ok: false,
        response: jsonResponse(
          { message: "This account is not an approved auction admin." },
          403,
        ),
      };
    }
  } catch (error) {
    console.error("Approved-admin membership lookup failed.", error);
    return {
      ok: false,
      response: jsonResponse(
        {
          message:
            "Could not verify approved-admin access. Saving is disabled.",
        },
        503,
      ),
    };
  }

  if (process.env.ADMIN_ITEM_CREATION_ENABLED !== "true") {
    return {
      ok: false,
      response: jsonResponse(
        {
          message:
            "Saving is disabled until the reviewed migrations are applied and database admin protection is verified.",
        },
        503,
      ),
    };
  }

  return { ok: true, client };
}

type MoneyResult =
  | { ok: true; amount: number | null }
  | { ok: false; error: string };

function parseMoney(
  value: unknown,
  label: string,
  mustBePositive = false,
): MoneyResult {
  if (value === undefined || value === null) {
    return { ok: true, amount: null };
  }
  if (typeof value !== "string") {
    return {
      ok: false,
      error: `${label} must be a non-negative dollar amount with up to two decimals.`,
    };
  }
  if (!value.trim()) return { ok: true, amount: null };
  if (!/^\d+(?:\.\d{1,2})?$/.test(value.trim())) {
    return {
      ok: false,
      error: `${label} must be a non-negative dollar amount with up to two decimals.`,
    };
  }

  const amount = Number(value);
  if (
    !Number.isFinite(amount) ||
    !Number.isSafeInteger(Math.round(amount * 100))
  ) {
    return {
      ok: false,
      error: `${label} is outside the supported range.`,
    };
  }
  if (mustBePositive && amount <= 0) {
    return { ok: false, error: `${label} must be greater than zero.` };
  }
  return { ok: true, amount };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseItemInput(
  value: unknown,
):
  | { ok: true; item: ItemWrite }
  | { ok: false; message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "The item form data is invalid." };
  }

  const intent = value.intent;
  if (intent !== "draft" && intent !== "publish") {
    return { ok: false, message: "Choose whether to save a draft or publish the item." };
  }

  const title = value.title;
  if (typeof title !== "string" || !title.trim()) {
    return { ok: false, message: "Enter an item title so you can identify this draft." };
  }
  if (title.trim().length > 200) {
    return { ok: false, message: "The item title must be 200 characters or fewer." };
  }

  if (!isItemCategory(value.category)) {
    return {
      ok: false,
      message: "Choose a valid item category.",
    };
  }

  const descriptionInput = value.description;
  if (descriptionInput !== undefined && typeof descriptionInput !== "string") {
    return { ok: false, message: "The item description is invalid." };
  }
  const description =
    typeof descriptionInput === "string" && descriptionInput.trim()
      ? descriptionInput.trim()
      : null;
  if (description && description.length > 5000) {
    return {
      ok: false,
      message: "The item description must be 5,000 characters or fewer.",
    };
  }

  const retailValue = parseMoney(value.retailValue, "Retail value");
  if (!retailValue.ok) return { ok: false, message: retailValue.error };
  const minimumBid = parseMoney(value.startingBid, "Starting bid");
  if (!minimumBid.ok) return { ok: false, message: minimumBid.error };
  const bidIncrement = parseMoney(value.bidIncrement, "Bid increment", true);
  if (!bidIncrement.ok) return { ok: false, message: bidIncrement.error };

  if (
    intent === "publish" &&
    (!description ||
      retailValue.amount === null ||
      minimumBid.amount === null ||
      bidIncrement.amount === null)
  ) {
    return {
      ok: false,
      message:
        "To publish, provide a description, retail value, starting bid, and bid increment.",
    };
  }

  const donorWebsiteInput = value.donorWebsite;
  if (
    donorWebsiteInput !== undefined &&
    typeof donorWebsiteInput !== "string"
  ) {
    return { ok: false, message: "The donor website is invalid." };
  }
  const donorWebsite = typeof donorWebsiteInput === "string"
    ? donorWebsiteInput
    : "";
  if (donorWebsite.length > 2048) {
    return { ok: false, message: "The donor website must be 2,048 characters or fewer." };
  }

  let donorUrl: string | null = null;
  if (donorWebsite.trim()) {
    try {
      const parsedUrl = new URL(donorWebsite.trim());
      if (parsedUrl.protocol !== "https:" && parsedUrl.protocol !== "http:") {
        return { ok: false, message: "The donor website must use HTTP or HTTPS." };
      }
      donorUrl = parsedUrl.toString();
    } catch {
      return { ok: false, message: "Enter a valid donor website URL." };
    }
  }

  return {
    ok: true,
    item: {
      title: title.trim(),
      description,
      retail_value: retailValue.amount,
      minimum_bid: minimumBid.amount,
      bid_increment: bidIncrement.amount,
      donor_url: donorUrl,
      category: value.category,
      status: intent === "publish" ? "published" : "draft",
    },
  };
}
