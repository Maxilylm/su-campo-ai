"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch";
import { retryTransientResponse } from "@/lib/retry";
import { DATA_CHANGED_EVENT, subscribeToAppEvent } from "@/lib/mutate";
import { normalizeWaterPoint, type WaterPoint } from "@/lib/water-points";

/**
 * Aguadas (water_points, 055) for the map. `migrationRequired` means the
 * table isn't there yet: the map then keeps the legacy aguada markers and
 * the drawing tool stores aguadas as plain map features.
 */
export function useWaterPoints({ offlineReadOnly }: { offlineReadOnly: boolean }) {
  const [waterPoints, setWaterPoints] = useState<WaterPoint[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [migrationRequired, setMigrationRequired] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const loadWaterPoints = useCallback(async () => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const res = await retryTransientResponse(() => fetchWithTimeout("/api/water-points", { cache: "no-store", signal: controller.signal }, 10000), { signal: controller.signal });
      if (!res.ok) throw new Error("water points request failed");
      const body = await res.json();
      if (controller.signal.aborted || requestRef.current !== controller) return;
      const items = Array.isArray(body?.items) ? body.items.map(normalizeWaterPoint).filter((point: WaterPoint | null): point is WaterPoint => point !== null) : [];
      setWaterPoints(items);
      setMigrationRequired(body?.migrationRequired === true);
      setTruncated(body?.truncated === true);
      setLoadError(false);
    } catch {
      if (!controller.signal.aborted) setLoadError(true);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoaded(true);
      }
    }
  }, []);

  useEffect(() => {
    if (offlineReadOnly) {
      // Not part of the offline snapshot: offline, the legacy markers stay.
      requestRef.current?.abort();
      setWaterPoints([]);
      setLoaded(true);
      return;
    }
    void loadWaterPoints();
    return () => { requestRef.current?.abort(); };
  }, [loadWaterPoints, offlineReadOnly]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToAppEvent(DATA_CHANGED_EVENT, () => {
      if (offlineReadOnly) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { void loadWaterPoints(); }, 300);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [loadWaterPoints, offlineReadOnly]);

  /** Optimistic local replace after a successful write (the reload follows). */
  const replaceLocal = useCallback((point: WaterPoint) => {
    setWaterPoints((current) => current.some((item) => item.id === point.id)
      ? current.map((item) => (item.id === point.id ? point : item))
      : [...current, point]);
  }, []);

  const removeLocal = useCallback((id: string) => {
    setWaterPoints((current) => current.filter((item) => item.id !== id));
  }, []);

  return { waterPoints, loaded, loadError, migrationRequired, truncated, loadWaterPoints, replaceLocal, removeLocal };
}
