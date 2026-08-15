export const AUTH_EXPIRED_EVENT = "campoai:auth-expired";

/** Notify the active app shell that an authenticated API request was rejected. */
export function notifyAuthExpired() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(AUTH_EXPIRED_EVENT));
}

/** Listen for a session-expiry signal without coupling callers to the DOM event name. */
export function subscribeToAuthExpired(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(AUTH_EXPIRED_EVENT, listener);
  return () => window.removeEventListener(AUTH_EXPIRED_EVENT, listener);
}
