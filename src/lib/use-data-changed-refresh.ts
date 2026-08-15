"use client";

import { useEffect } from "react";
import { DATA_CHANGED_EVENT, subscribeToAppEvent } from "./mutate";

const FOREGROUND_REFRESH_MIN_INTERVAL_MS = 60_000;

export function shouldRefreshAfterForeground(
  lastRefreshAt: number,
  now = Date.now(),
  minimumIntervalMs = FOREGROUND_REFRESH_MIN_INTERVAL_MS,
): boolean {
  return !Number.isFinite(lastRefreshAt) || now - lastRefreshAt >= minimumIntervalMs;
}

/**
 * Re-run a stable loader after a mutation in this tab or another CampoAI tab,
 * and after a long-lived tab becomes visible again.
 * A short debounce coalesces the DATA_CHANGED + specialized event pair and
 * prevents a burst of edits from producing one request per keystroke/action.
 * The foreground guard keeps returning to a tab from creating a request on
 * every focus event while still recovering stale data after background work.
 */
export function useDataChangedRefresh(
  refresh: () => void | Promise<void>,
  enabled = true,
  delayMs = 300,
) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    let lastRefreshAt = Date.now();

    const runRefresh = () => {
      if (inFlight) return;
      inFlight = true;
      lastRefreshAt = Date.now();
      Promise.resolve().then(refresh).catch(() => {}).finally(() => { inFlight = false; });
    };

    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        runRefresh();
      }, delayMs);
    };

    const onDataChanged = () => {
      scheduleRefresh();
    };
    const onForeground = () => {
      if (document.visibilityState !== "visible") return;
      if (shouldRefreshAfterForeground(lastRefreshAt)) scheduleRefresh();
    };
    const unsubscribe = subscribeToAppEvent(DATA_CHANGED_EVENT, onDataChanged);
    window.addEventListener("focus", onForeground);
    document.addEventListener("visibilitychange", onForeground);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onForeground);
      document.removeEventListener("visibilitychange", onForeground);
      if (timer) clearTimeout(timer);
    };
  }, [delayMs, enabled, refresh]);
}
