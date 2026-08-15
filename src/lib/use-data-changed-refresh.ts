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
 * Debounce refresh signals without losing one that arrives while the current
 * request is still running. Kept separate from the React hook so the race
 * behavior can be verified without a browser or component renderer.
 */
export function createRefreshScheduler(
  refresh: () => void | Promise<void>,
  delayMs = 300,
): { schedule: () => void; dispose: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let refreshQueued = false;
  let disposed = false;

  function runRefresh() {
    if (disposed) return;
    if (inFlight) {
      // A mutation can arrive after a refresh has started but before its
      // response reflects that mutation. Keep one follow-up refresh queued
      // instead of silently dropping the event.
      refreshQueued = true;
      return;
    }
    inFlight = true;
    Promise.resolve().then(refresh).catch(() => {}).finally(() => {
      inFlight = false;
      if (!disposed && refreshQueued) {
        refreshQueued = false;
        schedule();
      }
    });
  }

  function schedule() {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      runRefresh();
    }, delayMs);
  }

  return {
    schedule,
    dispose: () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    },
  };
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
    let lastRefreshAt = Date.now();
    const scheduler = createRefreshScheduler(() => {
      lastRefreshAt = Date.now();
      return refresh();
    }, delayMs);

    const onDataChanged = () => {
      scheduler.schedule();
    };
    const onForeground = () => {
      if (document.visibilityState !== "visible") return;
      if (shouldRefreshAfterForeground(lastRefreshAt)) scheduler.schedule();
    };
    const unsubscribe = subscribeToAppEvent(DATA_CHANGED_EVENT, onDataChanged);
    window.addEventListener("focus", onForeground);
    document.addEventListener("visibilitychange", onForeground);
    return () => {
      unsubscribe();
      window.removeEventListener("focus", onForeground);
      document.removeEventListener("visibilitychange", onForeground);
      scheduler.dispose();
    };
  }, [delayMs, enabled, refresh]);
}
