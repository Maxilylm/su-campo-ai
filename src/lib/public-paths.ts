export const PUBLIC_PREFIXES = [
  "/login",
  "/reset-password",
  "/auth",
  "/invite",
  "/api/status",
  "/api/whatsapp",
  "/manifest.webmanifest",
  "/sw.js",
  "/robots.txt",
] as const;

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/** API route handlers perform their own authentication and farm authorization. */
export function isApiPath(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}
