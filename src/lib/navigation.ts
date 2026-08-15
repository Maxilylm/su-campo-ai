export function safeNextPath(value: string | null | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

/** Return a same-origin path suitable for a full navigation while offline. */
export function offlineNavigationHref(href: string, currentHref: string): string | null {
  try {
    const target = new URL(href, currentHref);
    const current = new URL(currentHref);
    if (target.origin !== current.origin || target.pathname.startsWith("/api/") || target.href === current.href) return null;
    return `${target.pathname}${target.search}${target.hash}`;
  } catch {
    return null;
  }
}

export function loginRedirectFor(pathname: string, search = "", error?: string): string {
  const next = safeNextPath(pathname + search);
  const params = new URLSearchParams({ next });
  if (error) params.set("error", error);
  return "/login?" + params.toString();
}
