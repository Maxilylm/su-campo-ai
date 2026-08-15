import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "./lib/env";
import { fetchWithTimeout } from "./lib/fetch";
import { loginRedirectFor } from "./lib/navigation";
import { isApiPath, isPublicPath } from "./lib/public-paths";
import { shouldBlockCrossSiteMutation } from "./lib/csrf";

const SUPABASE_AUTH_TIMEOUT_MS = 2500;

function boundedSupabaseFetch(input: RequestInfo | URL, init?: RequestInit) {
  return fetchWithTimeout(input, init, SUPABASE_AUTH_TIMEOUT_MS);
}

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Route handlers authorize API requests themselves. Skipping the proxy
  // lookup avoids doing the same Supabase auth request twice per API call.
  if (isApiPath(pathname)) {
    if (shouldBlockCrossSiteMutation({
      method: request.method,
      pathname,
      expectedOrigin: request.nextUrl.origin,
      origin: request.headers.get("origin"),
      referer: request.headers.get("referer"),
      secFetchSite: request.headers.get("sec-fetch-site"),
    })) {
      return NextResponse.json({ error: "Solicitud de origen no permitido." }, { status: 403 });
    }
    return NextResponse.next({ request });
  }
  if (isPublicPath(pathname)) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    env.supabaseUrl,
    env.supabaseAnonKey,
    {
      global: { fetch: boundedSupabaseFetch },
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
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    const redirectError = authResult.unavailable ? "auth_unavailable" : undefined;
    url.search = loginRedirectFor(pathname, request.nextUrl.search, redirectError).slice("/login".length);
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
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
