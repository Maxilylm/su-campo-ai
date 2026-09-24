"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch";
import { isOfflineSnapshotFresh, offlineEntitySnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import type { Crop } from "./types";

/** Crops with their applications — online from the API, or read-only from the
 * fresh offline snapshot. Refreshes on data changes. */
export function useCropsData(offlineReadOnly: boolean, userId: string | null) {
  const [crops, setCrops] = useState<Crop[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [cropsTruncated, setCropsTruncated] = useState(false);
  const [applicationsTruncated, setApplicationsTruncated] = useState(false);
  const [offlineCropsSavedAt, setOfflineCropsSavedAt] = useState<string | null>(null);
  const cropsRequestRef = useRef<AbortController | null>(null);

  const loadCrops = useCallback(async () => {
    cropsRequestRef.current?.abort();
    if (offlineReadOnly) {
      let snapshot = null;
      try {
        snapshot = userId
          ? parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)))
          : null;
      } catch {
        snapshot = null;
      }
      if (snapshot && isOfflineSnapshotFresh(snapshot.savedAt)) {
        setCrops(snapshot.crops as Crop[]);
        setCropsTruncated(snapshot.cropsTruncated === true);
        setApplicationsTruncated(snapshot.cropApplicationsTruncated === true);
        setOfflineCropsSavedAt(snapshot.savedAt);
        setLoadError(false);
      } else {
        setCrops([]);
        setOfflineCropsSavedAt(null);
        setLoadError(true);
      }
      setLoaded(true);
      return;
    }
    const controller = new AbortController();
    cropsRequestRef.current = controller;
    setOfflineCropsSavedAt(null);
    setLoadError(false);
    setCropsTruncated(false);
    setApplicationsTruncated(false);
    try {
      const res = await fetchWithTimeout("/api/crops", { cache: "no-store", signal: controller.signal }, 8000);
      if (!res.ok) throw new Error("crops request failed");
      const nextCrops = await res.json();
      if (controller.signal.aborted) return;
      setCrops(Array.isArray(nextCrops) ? nextCrops : []);
      setCropsTruncated(res.headers.get("X-CampoAI-Crops-Truncated") === "true");
      setApplicationsTruncated(res.headers.get("X-CampoAI-Crop-Applications-Truncated") === "true");
    } catch (e) {
      if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      console.error("Load crops error:", e);
      setLoadError(true);
    } finally {
      if (cropsRequestRef.current === controller) {
        cropsRequestRef.current = null;
        setLoaded(true);
      }
    }
  }, [offlineReadOnly, userId]);

  useEffect(() => {
    void loadCrops();
    return () => cropsRequestRef.current?.abort();
  }, [loadCrops]);
  useDataChangedRefresh(loadCrops, !offlineReadOnly);
  useOfflineSnapshotRefresh(loadCrops, userId, offlineReadOnly);


  return { crops, loaded, loadError, cropsTruncated, applicationsTruncated, offlineCropsSavedAt, loadCrops };
}
