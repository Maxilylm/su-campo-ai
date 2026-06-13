import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "./env";

// Server client for Server Components and Route Handlers
// Reads auth session from cookies — respects RLS
export async function getSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
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
