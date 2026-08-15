export function safeNextPath(value: string | null | undefined): string {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//")) return "/";
  return value;
}

export function loginRedirectFor(pathname: string, search = "", error?: string): string {
  const next = safeNextPath(pathname + search);
  const params = new URLSearchParams({ next });
  if (error) params.set("error", error);
  return "/login?" + params.toString();
}
