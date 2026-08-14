import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "./lib/env";

const PUBLIC_PREFIXES = ["/auth", "/api/status", "/api/whatsapp"];
const SUPABASE_AUTH_TIMEOUT_MS = 2500;

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // These routes must remain reachable while Supabase is unavailable. The
  // status endpoint reports the outage itself, and the auth callback manages
  // its own session exchange.
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          supabaseResponse = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            supabaseResponse.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // Refresh session (important — keeps tokens alive), but never let a stalled
  // Supabase request take down the whole deployment with a Vercel 504.
  const user = await Promise.race([
    supabase.auth.getUser().then(({ data: { user } }) => user),
    new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), SUPABASE_AUTH_TIMEOUT_MS)
    ),
  ]).catch(() => null);

  // Redirect unauthenticated users to login (except login page itself and auth callback)
  if (
    !user &&
    !pathname.startsWith("/login") &&
    !pathname.startsWith("/auth")
  ) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Redirect authenticated users away from login page
  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // Match all routes except static files, images, and the PWA manifest —
    // browsers may fetch the manifest without credentials, so it must never
    // be auth-redirected.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest)$).*)",
  ],
};
