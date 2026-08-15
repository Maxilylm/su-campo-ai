"use client";

import { useEffect } from "react";
import { DATA_CHANGED_EVENT, subscribeToAppEvent } from "./mutate";

/**
 * Re-run a stable loader after a mutation in this tab or another CampoAI tab.
 * A short debounce coalesces the DATA_CHANGED + specialized event pair and
 * prevents a burst of edits from producing one request per keystroke/action.
 */
export function useDataChangedRefresh(
  refresh: () => void | Promise<void>,
  enabled = true,
  delayMs = 300,
) {
  useEffect(() => {
    if (!enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onDataChanged = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void refresh(); }, delayMs);
    };
    const unsubscribe = subscribeToAppEvent(DATA_CHANGED_EVENT, onDataChanged);
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [delayMs, enabled, refresh]);
}
