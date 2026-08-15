export function safeNextPath(value: string | null | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function loginRedirectFor(pathname: string, search = ""): string {
  const next = safeNextPath(pathname + search);
  return "/login?" + new URLSearchParams({ next }).toString();
}
