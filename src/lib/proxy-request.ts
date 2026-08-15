export function isRouterPrefetch(headers: Pick<Headers, "get">): boolean {
  return headers.get("next-router-prefetch") === "1"
    || headers.get("purpose")?.toLowerCase() === "prefetch";
}
