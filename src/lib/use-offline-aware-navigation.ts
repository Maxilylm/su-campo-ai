"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { offlineNavigationHref } from "@/lib/navigation";

/** Navigate through the cached document shell when the app is read-only. */
export function useOfflineAwareNavigation() {
  const router = useRouter();
  const { offlineMode, isOnline } = useFarm();

  return useCallback((href: string) => {
    if (offlineMode || !isOnline) {
      const nextHref = offlineNavigationHref(href, window.location.href);
      if (nextHref) window.location.assign(nextHref);
      return;
    }
    router.push(href);
  }, [isOnline, offlineMode, router]);
}
