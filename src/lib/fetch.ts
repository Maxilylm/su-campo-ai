import { notifyAuthExpired } from "./auth-session";

function isLocalApiRequest(input: RequestInfo | URL): boolean {
  if (typeof input === "string") return input.startsWith("/api/");
  if (typeof window === "undefined") return false;
  if (input instanceof URL) return input.origin === window.location.origin && input.pathname.startsWith("/api/");
  return input.url.startsWith(window.location.origin + "/api/");
}

/** Fetch with an upper bound so third-party outages do not consume a server
 * invocation until the platform timeout. */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 10000
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const parentSignal = init.signal;
  const abortFromParent = () => controller.abort(parentSignal?.reason);

  if (parentSignal) {
    if (parentSignal.aborted) abortFromParent();
    else parentSignal.addEventListener("abort", abortFromParent, { once: true });
  }

  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    if (response.status === 401 && typeof window !== "undefined" && isLocalApiRequest(input)) {
      notifyAuthExpired();
    }
    return response;
  } finally {
    clearTimeout(timer);
    parentSignal?.removeEventListener("abort", abortFromParent);
  }
}
