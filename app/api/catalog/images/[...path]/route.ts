import { createClient } from "@supabase/supabase-js";
import {
  isItemPhotoPath,
  ITEM_PHOTO_MIME_TYPES,
  ITEM_PHOTO_BUCKET,
} from "@/item-photos";
import { normalizeSupabaseUrl } from "@/supabase-url";

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  const objectPath = path.join("/");
  if (!isItemPhotoPath(objectPath)) {
    return new Response("Not found", { status: 404 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !publishableKey) {
    return new Response("Image service is not configured.", { status: 503 });
  }

  const client = createClient(normalizeSupabaseUrl(url), publishableKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  try {
    const { data, error } = await client.storage
      .from(ITEM_PHOTO_BUCKET)
      .download(objectPath);
    if (error || !data) {
      return new Response("Not found", {
        status: 404,
        headers: { "Cache-Control": "private, no-store" },
      });
    }
    const contentType = ITEM_PHOTO_MIME_TYPES.find(
      (mimeType) => mimeType === data.type,
    );
    if (!contentType) {
      return new Response("Not found", {
        status: 404,
        headers: { "Cache-Control": "private, no-store" },
      });
    }

    return new Response(data.stream(), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Length": String(data.size),
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("Could not load a published auction item photo.", error);
    return new Response("Image service is temporarily unavailable.", {
      status: 503,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
}
