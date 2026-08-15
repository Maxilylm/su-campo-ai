/** Clear cached authenticated page shells when the local session ends. */
export function clearAuthenticatedShellCache(): void {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  void navigator.serviceWorker.ready
    .then((registration) => {
      registration.active?.postMessage({ type: "CLEAR_AUTHENTICATED_SHELL" });
    })
    .catch(() => {
      // The app remains usable when the service worker is unavailable.
    });
}
