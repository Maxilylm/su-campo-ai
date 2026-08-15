import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "./env";
import { fetchWithTimeout } from "./fetch";

const SUPABASE_REQUEST_TIMEOUT_MS = 8000;

function boundedSupabaseFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetchWithTimeout(input, init, SUPABASE_REQUEST_TIMEOUT_MS);
}

// Server client for Server Components and Route Handlers
// Reads auth session from cookies — respects RLS
export async function getSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      global: { fetch: boundedSupabaseFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // setAll can fail in Server Components (read-only).
            // This is fine — the middleware handles cookie refreshes.
          }
        },
      },
    }
  );
}
