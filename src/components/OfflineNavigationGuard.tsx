"use client";

import { useEffect } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { offlineNavigationHref } from "@/lib/navigation";

/** Use cached document shells for internal links when the app is read-only. */
export function OfflineNavigationGuard() {
  const { offlineMode, isOnline } = useFarm();

  useEffect(() => {
    if (!offlineMode && isOnline) return;

    const onClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target && anchor.target !== "_self" || anchor.hasAttribute("download")) return;
      const href = offlineNavigationHref(anchor.href, window.location.href);
      if (!href) return;
      event.preventDefault();
      window.location.assign(href);
    };

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [isOnline, offlineMode]);

  return null;
}
