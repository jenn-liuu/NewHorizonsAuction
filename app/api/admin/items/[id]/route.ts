import { authorizeApprovedAdmin, jsonResponse, parseItemInput } from "../shared";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeApprovedAdmin(request);
  if (!authorization.ok) return authorization.response;
  const { id } = await context.params;

  try {
    const { data, error } = await authorization.client
      .from("items")
      .select(
        "id, title, description, retail_value, minimum_bid, bid_increment, donor_url, category, status, created_at",
      )
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.error("Could not load the requested auction item.", error);
      return jsonResponse(
        { message: "This item could not be loaded. Check the reviewed admin SELECT policy." },
        503,
      );
    }
    if (!data) return jsonResponse({ message: "Auction item not found." }, 404);
    return jsonResponse({ item: data }, 200);
  } catch (error) {
    console.error("Auction item lookup failed.", error);
    return jsonResponse(
      { message: "This item could not be loaded. Check the database connection." },
      503,
    );
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeApprovedAdmin(request);
  if (!authorization.ok) return authorization.response;
  const { id } = await context.params;

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
      .update(validation.item)
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      console.error("Supabase rejected the auction item update.", error);
      return jsonResponse(
        {
          message:
            "The database did not save this item. Check the reviewed schema and RLS setup; your entries are still in the form.",
        },
        400,
      );
    }
    if (!data) return jsonResponse({ message: "Auction item not found." }, 404);

    return jsonResponse(
      {
        id: data.id,
        message:
          validation.item.status === "published"
            ? "Item published successfully."
            : "Draft saved successfully.",
      },
      200,
    );
  } catch (error) {
    console.error("Auction item update failed.", error);
    return jsonResponse(
      {
        message:
          "The item could not be saved. Check the database connection; your entries are still in the form.",
      },
      503,
    );
  }
}
