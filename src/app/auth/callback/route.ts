import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";
import { safeNextPath } from "@/lib/navigation";
import { fetchWithTimeout } from "@/lib/fetch";

const SUPABASE_CALLBACK_TIMEOUT_MS = 5000;

// Handles Supabase auth redirects (email confirmation, magic links, etc.)
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNextPath(searchParams.get("next"));

  if (code) {
    const response = NextResponse.redirect(`${origin}${next}`);
    const supabase = createServerClient(
      env.supabaseUrl,
      env.supabaseAnonKey,
      {
        global: {
          fetch: (input, init) => fetchWithTimeout(input, init, SUPABASE_CALLBACK_TIMEOUT_MS),
        },
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet) {
            for (const { name, value, options } of cookiesToSet) {
              response.cookies.set(name, value, options);
            }
          },
        },
      }
    );

    try {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) return NextResponse.redirect(`${origin}/login?error=auth_callback`);
      return response;
    } catch {
      return NextResponse.redirect(`${origin}/login?error=auth_unavailable`);
    }
  }

  return NextResponse.redirect(`${origin}/login`);
}
