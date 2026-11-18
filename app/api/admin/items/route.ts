import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "@/supabase-url";

type AuthorizationResult =
  | { ok: true; client: SupabaseClient }
  | { ok: false; response: Response };

type CreateItemInput = {
  title: string;
  description: string;
  retail_value: number;
  minimum_bid: number;
  bid_increment: number;
  donor_url: string | null;
  status: "draft" | "published";
};

function jsonResponse(
  body: { message: string },
  status: number,
): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

async function authorizeApprovedAdmin(
  request: Request,
): Promise<AuthorizationResult> {
  const authorization = request.headers.get("authorization");
  const tokenMatch = /^Bearer ([^\s]+)$/i.exec(authorization ?? "");
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
              "Could not verify approved-admin access. Apply and verify the reviewed database migration before enabling saves.",
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
            "Saving is disabled until the reviewed migration is applied and database admin protection is verified.",
        },
        503,
      ),
    };
  }

  return { ok: true, client };
}

type MoneyResult =
  | { ok: true; amount: number }
  | { ok: false; error: string };

function parseMoney(
  value: unknown,
  label: string,
  mustBePositive = false,
): MoneyResult {
  if (
    typeof value !== "string" ||
    !/^\d+(?:\.\d{1,2})?$/.test(value.trim())
  ) {
    return {
      ok: false,
      error: `${label} must be a non-negative dollar amount with up to two decimals.`,
    };
  }

  const amount = Number(value);
  if (!Number.isFinite(amount) || !Number.isSafeInteger(Math.round(amount * 100))) {
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

function validateCreateItem(value: unknown):
  | { ok: true; item: CreateItemInput }
  | { ok: false; message: string } {
  if (!isRecord(value)) {
    return { ok: false, message: "The item form data is invalid." };
  }

  const input = value;
  const title = input.title;
  const description = input.description;
  if (typeof title !== "string" || !title.trim()) {
    return { ok: false, message: "Enter an item title." };
  }
  if (title.trim().length > 200) {
    return { ok: false, message: "The item title must be 200 characters or fewer." };
  }
  if (typeof description !== "string" || !description.trim()) {
    return { ok: false, message: "Enter an item description." };
  }
  if (description.trim().length > 5000) {
    return {
      ok: false,
      message: "The item description must be 5,000 characters or fewer.",
    };
  }

  const retailValue = parseMoney(input.retailValue, "Retail value");
  if (!retailValue.ok) {
    return { ok: false, message: retailValue.error };
  }
  const minimumBid = parseMoney(input.startingBid, "Starting bid");
  if (!minimumBid.ok) {
    return { ok: false, message: minimumBid.error };
  }
  const bidIncrement = parseMoney(
    input.bidIncrement,
    "Bid increment",
    true,
  );
  if (!bidIncrement.ok) {
    return { ok: false, message: bidIncrement.error };
  }

  if (input.status !== "draft" && input.status !== "published") {
    return { ok: false, message: "Choose Draft or Published for the item status." };
  }

  const donorWebsiteInput = input.donorWebsite;
  if (
    typeof donorWebsiteInput !== "string" ||
    donorWebsiteInput.length > 2048
  ) {
    return { ok: false, message: "The donor website must be 2,048 characters or fewer." };
  }

  let donorUrl: string | null = null;
  if (donorWebsiteInput.trim()) {
    try {
      const donorWebsite = new URL(donorWebsiteInput.trim());
      if (donorWebsite.protocol !== "https:" && donorWebsite.protocol !== "http:") {
        return { ok: false, message: "The donor website must use HTTP or HTTPS." };
      }
      donorUrl = donorWebsite.toString();
    } catch {
      return { ok: false, message: "Enter a valid donor website URL." };
    }
  }

  return {
    ok: true,
    item: {
      title: title.trim(),
      description: description.trim(),
      retail_value: retailValue.amount,
      minimum_bid: minimumBid.amount,
      bid_increment: bidIncrement.amount,
      donor_url: donorUrl,
      status: input.status,
    },
  };
}

export async function GET(request: Request) {
  const authorization = await authorizeApprovedAdmin(request);
  if (!authorization.ok) return authorization.response;
  return jsonResponse({ message: "Approved admin access is enabled." }, 200);
}

export async function POST(request: Request) {
  const authorization = await authorizeApprovedAdmin(request);
  if (!authorization.ok) return authorization.response;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ message: "The item form data must be valid JSON." }, 400);
  }

  const validation = validateCreateItem(input);
  if (!validation.ok) {
    return jsonResponse({ message: validation.message }, 400);
  }

  try {
    const { error } = await authorization.client
      .from("items")
      .insert(validation.item);

    if (error) {
      console.error("Supabase rejected the auction item insert.", error);
      return jsonResponse(
        {
          message:
            "The database did not save this item. Check the reviewed schema and RLS setup; your entries are still in the form.",
        },
        400,
      );
    }
  } catch (error) {
    console.error("Auction item insert failed.", error);
    return jsonResponse(
      {
        message:
          "The item could not be saved. Check the database connection; your entries are still in the form.",
      },
      503,
    );
  }

  return jsonResponse({ message: "Item saved successfully." }, 201);
}
