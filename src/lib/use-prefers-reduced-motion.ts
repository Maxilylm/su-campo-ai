"use client";

import { useSyncExternalStore } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** True when the OS asks for less motion — charts then render without animation.
 * The server snapshot assumes reduced motion so nothing animates before hydration. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => typeof window !== "undefined" && !!window.matchMedia && window.matchMedia(QUERY).matches,
    () => true,
  );
}
