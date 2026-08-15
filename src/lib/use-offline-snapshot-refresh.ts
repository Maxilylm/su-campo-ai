"use client";

import { useEffect } from "react";
import { OFFLINE_SYNC_EVENT, subscribeToAppEvent } from "./mutate";
import { offlineSnapshotKeys } from "./offline";
import { createRefreshScheduler } from "./use-data-changed-refresh";

export function isOfflineStorageEventForUser(userId: string, key: string | null): boolean {
  return key === null || offlineSnapshotKeys(userId).includes(key);
}

/** Refresh a view that reads local snapshots when another tab changes them. */
export function useOfflineSnapshotRefresh(
  refresh: () => void | Promise<void>,
  userId: string | null,
  enabled = true,
  delayMs = 300,
) {
  useEffect(() => {
    if (!enabled || !userId) return;
    const scheduler = createRefreshScheduler(refresh, delayMs);
    const onStorage = (event: StorageEvent) => {
      if (isOfflineStorageEventForUser(userId, event.key)) scheduler.schedule();
    };
    const unsubscribe = subscribeToAppEvent(OFFLINE_SYNC_EVENT, scheduler.schedule);
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener("storage", onStorage);
      scheduler.dispose();
    };
  }, [delayMs, enabled, refresh, userId]);
}
