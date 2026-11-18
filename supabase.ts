import { createClient } from "@supabase/supabase-js";
import { normalizeSupabaseUrl } from "./supabase-url";

const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const url = configuredUrl ? normalizeSupabaseUrl(configuredUrl) : undefined;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const supabase =
  url && publishableKey ? createClient(url, publishableKey) : null;
