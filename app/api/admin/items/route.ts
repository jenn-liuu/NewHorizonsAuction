import {
  authorizeApprovedAdmin,
  jsonResponse,
  parseItemInput,
} from "./shared";

type ItemRecord = {
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

export async function GET(request: Request) {
  const authorization = await authorizeApprovedAdmin(request);
  if (!authorization.ok) return authorization.response;

  const url = new URL(request.url);
  if (url.searchParams.get("list") !== "true") {
    return jsonResponse(
      { message: "Approved admin access is enabled." },
      200,
    );
  }

  try {
    const { data, error } = await authorization.client
      .from("items")
      .select(
        "id, title, description, retail_value, minimum_bid, bid_increment, donor_url, status, created_at",
      )
      .in("status", ["draft", "published"])
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Could not load auction items for an approved admin.", error);
      return jsonResponse(
        { message: "The item list could not be loaded. Check the reviewed admin SELECT policy." },
        503,
      );
    }

    return jsonResponse(
      { items: (data ?? []) as ItemRecord[] },
      200,
    );
  } catch (error) {
    console.error("Auction item listing failed.", error);
    return jsonResponse(
      { message: "The item list could not be loaded. Check the database connection." },
      503,
    );
  }
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

  const validation = parseItemInput(input);
  if (!validation.ok) {
    return jsonResponse({ message: validation.message }, 400);
  }

  try {
    const { data, error } = await authorization.client
      .from("items")
      .insert(validation.item)
      .select("id")
      .single();

    if (error || !data) {
      console.error("Supabase rejected the auction item insert.", error);
      return jsonResponse(
        {
          message:
            "The database did not save this item. Check the reviewed schema and RLS setup; your entries are still in the form.",
        },
        400,
      );
    }

    return jsonResponse(
      {
        id: data.id,
        message:
          validation.item.status === "published"
            ? "Item published successfully."
            : "Draft saved successfully.",
      },
      201,
    );
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
}
