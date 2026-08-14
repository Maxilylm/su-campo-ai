import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "./lib/env";

// /manifest.webmanifest and /sw.js must stay public: browsers fetch both without
// credentials, so redirecting them to /login breaks PWA install and the service worker.
const PUBLIC_PREFIXES = ["/auth", "/api/status", "/api/whatsapp", "/manifest.webmanifest", "/sw.js"];
const SUPABASE_AUTH_TIMEOUT_MS = 2500;

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  if (PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) {
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

  const authResult = await Promise.race([
    supabase.auth.getUser().then(({ data: { user }, error }) => ({
      user,
      unavailable: Boolean(error && error.name !== "AuthSessionMissingError" && error.status !== 401),
    })),
    new Promise<{ user: null; unavailable: true }>((resolve) =>
      setTimeout(() => resolve({ user: null, unavailable: true }), SUPABASE_AUTH_TIMEOUT_MS)
    ),
  ]).catch(() => ({ user: null, unavailable: true }));

  const user = authResult.user;

  if (!user && !pathname.startsWith("/login") && !pathname.startsWith("/auth")) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json(
        { error: authResult.unavailable ? "Authentication service unavailable" : "Unauthorized" },
        { status: authResult.unavailable ? 503 : 401 }
      );
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  if (user && pathname.startsWith("/login")) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    // "webmanifest" is in the extension exclusion list as belt-and-braces alongside
    // the PUBLIC_PREFIXES check above — the manifest must never redirect to /login.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|webmanifest)$).*)",
  ],
};
