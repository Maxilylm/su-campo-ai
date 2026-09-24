"use client";

import { useCallback, useSyncExternalStore } from "react";

export type AgendaView = "list" | "calendar";

const VIEW_EVENT = "campoai:agenda-view";

// In-memory fallback when localStorage throws, so the toggle still works for
// this visit.
const memoryFallback = new Map<string, AgendaView>();

function viewKey(userId: string | null): string {
  return `campoai:agenda-view:${encodeURIComponent(userId ?? "anon")}`;
}

function readView(key: string): string | null {
  try {
    const stored = window.localStorage.getItem(key);
    if (stored) return stored;
  } catch {
    // Storage blocked: fall through to the in-memory choice.
  }
  return memoryFallback.get(key) ?? null;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(VIEW_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(VIEW_EVENT, onChange);
  };
}

const noopSubscribe = () => () => {};

/**
 * Lista / Calendario, remembered per user in this browser. Returns null until
 * the component is hydrated, so the page never fetches for the wrong view.
 */
export function useAgendaView(userId: string | null): [AgendaView | null, (view: AgendaView) => void] {
  const key = viewKey(userId);
  const hydrated = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const stored = useSyncExternalStore(subscribe, () => readView(key), () => null);
  const setView = useCallback((view: AgendaView) => {
    memoryFallback.set(key, view);
    try {
      window.localStorage.setItem(key, view);
    } catch {
      // Not persisted; the in-memory choice still switches this page.
    }
    window.dispatchEvent(new Event(VIEW_EVENT));
  }, [key]);

  if (!hydrated) return [null, setView];
  return [stored === "calendar" ? "calendar" : "list", setView];
}
