import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { coreEnvPresence, env } from "./lib/env";
import { fetchWithTimeout } from "./lib/fetch";
import { loginRedirectFor } from "./lib/navigation";
import { isApiPath, isPublicPath } from "./lib/public-paths";
import { shouldBlockCrossSiteMutation } from "./lib/csrf";
import { isRouterPrefetch } from "./lib/proxy-request";

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
  // All app screens hydrate their data on the client. A Next router prefetch
  // only warms the shell, so avoid spending a Supabase auth round trip on it;
  // the actual navigation still passes through the full session check.
  if (isRouterPrefetch(request.headers)) {
    return NextResponse.next({ request });
  }
  if (isPublicPath(pathname)) {
    return NextResponse.next({ request });
  }

  // Keep a missing deployment configuration from surfacing as an opaque
  // middleware failure. The login and status pages remain reachable so the
  // owner can see the actionable configuration diagnosis.
  const presence = coreEnvPresence();
  if (!presence.NEXT_PUBLIC_SUPABASE_URL || !presence.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = loginRedirectFor(pathname, request.nextUrl.search, "auth_unavailable").slice("/login".length);
    return NextResponse.redirect(url);
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

  let authTimer: ReturnType<typeof setTimeout> | undefined;
  const authResult = await Promise.race([
    supabase.auth.getUser().then(({ data: { user }, error }) => ({
      user,
      unavailable: Boolean(error && error.name !== "AuthSessionMissingError" && error.status !== 401),
    })),
    new Promise<{ user: null; unavailable: true }>((resolve) =>
      authTimer = setTimeout(() => resolve({ user: null, unavailable: true }), SUPABASE_AUTH_TIMEOUT_MS)
    ),
  ]).finally(() => {
    if (authTimer) clearTimeout(authTimer);
  }).catch(() => ({ user: null, unavailable: true }));

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
    {
      source: "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
