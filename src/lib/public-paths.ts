export const PUBLIC_PREFIXES = [
  "/login",
  "/auth",
  "/api/status",
  "/api/whatsapp",
  "/manifest.webmanifest",
  "/sw.js",
] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** API route handlers perform their own authentication and farm authorization. */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}
