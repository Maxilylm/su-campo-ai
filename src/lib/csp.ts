// Content-Security-Policy for every page, built once at build time in
// next.config.ts so the pages stay statically prerendered.
//
// Why script-src keeps 'unsafe-inline' instead of a nonce: a nonce must be
// fresh per request, which forces every page to render on demand (no static
// prerendering, no CDN cache, one function invocation per navigation on a $0
// Hobby plan). Hashes are no alternative either: each prerendered page inlines
// its own `self.__next_f.push(...)` RSC payload that changes every build, and
// `experimental.sri` only adds `integrity` to external <script src> tags. So the
// policy locks down *where* code and data can come from (no third-party script
// hosts, no exfiltration to arbitrary origins) and leaves inline scripts on.

/** Map tiles drawn by Leaflet in FarmMap (satellite imagery + labels). */
export const MAP_TILE_ORIGINS = ["https://server.arcgisonline.com"] as const;

export interface ContentSecurityPolicyOptions {
  /** NEXT_PUBLIC_SUPABASE_URL; the browser client talks to it directly. */
  supabaseUrl?: string | null;
  /** `next dev` needs eval (React debug stacks) and a ws: HMR socket. */
  isDev?: boolean;
}

/**
 * The http(s) origin of the Supabase project plus its websocket twin, or none
 * when the URL is missing or malformed (the app then only talks to itself).
 */
export function supabaseOrigins(supabaseUrl?: string | null): string[] {
  const raw = supabaseUrl?.trim();
  if (!raw) return [];
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return [];
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return [];
  const ws = url.protocol === "https:" ? "wss:" : "ws:";
  return [url.origin, `${ws}//${url.host}`];
}

export function buildContentSecurityPolicy({ supabaseUrl, isDev = false }: ContentSecurityPolicyOptions = {}): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    // Next.js inlines its hydration payload in every page (see header comment).
    "script-src": ["'self'", "'unsafe-inline'", ...(isDev ? ["'unsafe-eval'"] : [])],
    // React style props, Leaflet, Radix and sonner set inline styles at runtime.
    "style-src": ["'self'", "'unsafe-inline'"],
    // Leaflet CSS images are bundled (self); data:/blob: cover generated images.
    "img-src": ["'self'", "data:", "blob:", ...MAP_TILE_ORIGINS],
    // next/font self-hosts Geist under /_next/static/media.
    "font-src": ["'self'"],
    // Same-origin API routes plus the Supabase browser client (auth pages).
    // Weather, Groq and SNIG are only called from the server.
    "connect-src": ["'self'", ...supabaseOrigins(supabaseUrl), ...(isDev ? ["ws:"] : [])],
    // public/sw.js (offline shell); nothing else spawns workers.
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "frame-src": ["'none'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const policy = Object.entries(directives).map(([name, sources]) => `${name} ${sources.join(" ")}`);
  // Production is https-only; `next dev` (and a dev Supabase on http) is not.
  if (!isDev) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}
