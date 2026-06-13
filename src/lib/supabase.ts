import { createClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import { env } from "./env";

// Browser client (for client components — handles auth cookies automatically)
export function getSupabaseBrowser() {
  return createBrowserClient(env.supabaseUrl, env.supabaseAnonKey);
}

// Server admin client (service role — bypasses RLS, for API routes that need full access)
export function getSupabaseAdmin() {
  return createClient(env.supabaseUrl, env.supabaseServiceRoleKey);
}
