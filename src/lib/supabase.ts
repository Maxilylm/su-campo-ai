import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { env } from "./env";
import { fetchWithTimeout } from "./fetch";

const SUPABASE_REQUEST_TIMEOUT_MS = 8000;

function boundedSupabaseFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetchWithTimeout(input, init, SUPABASE_REQUEST_TIMEOUT_MS);
}

// Browser client (for client components — handles auth cookies automatically)
export function getSupabaseBrowser() {
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey, {
    global: { fetch: boundedSupabaseFetch },
  });
}

// Server admin client (service role — bypasses RLS, for API routes that need full access)
export function getSupabaseAdmin() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    global: { fetch: boundedSupabaseFetch },
  });
}
