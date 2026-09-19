const SAME_ORIGIN_PROBE = "https://campoai.invalid";

/** Browsers normalize "\" to "/" and strip tabs/newlines, so "/\evil.com" or
 * "/%09/evil.com" would still leave the site. Accept only paths that resolve
 * to this origin, with or without percent-decoding. */
export function safeNextPath(value: string | null | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return "/";
  }
  for (const candidate of [value, decoded]) {
    if (/[\\\u0000-\u001f\u007f]/.test(candidate)) return "/";
    try {
      if (new URL(candidate, SAME_ORIGIN_PROBE).origin !== SAME_ORIGIN_PROBE) return "/";
    } catch {
      return "/";
    }
  }
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
