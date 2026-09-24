"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch";
import { retryTransientResponse } from "@/lib/retry";
import { DATA_CHANGED_EVENT, subscribeToAppEvent } from "@/lib/mutate";
import { isOfflineSnapshotFresh, offlineEntitySnapshotKey, offlineFieldStatusSnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";
import { parseOfflineFieldStatusSnapshot } from "@/lib/field-status-offline";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import type { FieldTotals, RotationMove, SectionFieldStatus } from "@/lib/grazing";
import type { FieldGraph } from "@/lib/field-graph";
import type { MapFeature, Padron } from "./constants";

/**
 * Padrones, infrastructure and per-potrero status for the map: loaded live
 * (and refreshed on the shared data-changed event) or, offline, from the last
 * synced snapshot.
 */
export function useFarmMapData({ userId, offlineReadOnly }: { userId: string | null; offlineReadOnly: boolean }) {
  const [padrones, setPadrones] = useState<Padron[]>([]);
  const [mapFeatures, setMapFeatures] = useState<MapFeature[]>([]);
  const [padronesLoadError, setPadronesLoadError] = useState(false);
  const [featuresLoadError, setFeaturesLoadError] = useState(false);
  const [padronesTruncated, setPadronesTruncated] = useState(false);
  const [featuresTruncated, setFeaturesTruncated] = useState(false);
  const [padronesLoaded, setPadronesLoaded] = useState(false);
  const [featuresLoaded, setFeaturesLoaded] = useState(false);
  const [offlineMapSavedAt, setOfflineMapSavedAt] = useState<string | null>(null);
  const [offlineMapAvailable, setOfflineMapAvailable] = useState<boolean | null>(null);
  const [offlineRefreshKey, setOfflineRefreshKey] = useState(0);
  const padronesRequestRef = useRef<AbortController | null>(null);
  const featuresRequestRef = useRef<AbortController | null>(null);

  const [fieldStatuses, setFieldStatuses] = useState<SectionFieldStatus[]>([]);
  const [fieldTotals, setFieldTotals] = useState<FieldTotals | null>(null);
  const [rotation, setRotation] = useState<RotationMove[]>([]);
  const [graph, setGraph] = useState<FieldGraph | null>(null);
  const [fieldLoading, setFieldLoading] = useState(false);
  const [fieldError, setFieldError] = useState(false);
  const fieldRequestRef = useRef<AbortController | null>(null);

  const loadFieldStatus = useCallback(async () => {
    fieldRequestRef.current?.abort();
    const controller = new AbortController();
    fieldRequestRef.current = controller;
    setFieldLoading(true);
    try {
      const res = await retryTransientResponse(() => fetchWithTimeout("/api/field-status", { cache: "no-store", signal: controller.signal }, 10000), { signal: controller.signal });
      if (!res.ok) throw new Error("field status request failed");
      const body = await res.json();
      if (controller.signal.aborted || fieldRequestRef.current !== controller) return;
      const nextSections = Array.isArray(body?.sections) ? body.sections : [];
      const nextRotation = Array.isArray(body?.rotation) ? body.rotation : [];
      const nextGraph: FieldGraph | null = body?.graph && Array.isArray(body.graph.nodes) && Array.isArray(body.graph.edges) ? body.graph : null;
      setFieldStatuses(nextSections);
      setFieldTotals(body?.totals ?? null);
      setRotation(nextRotation);
      setGraph(nextGraph);
      setFieldError(false);
      if (userId) {
        try {
          window.localStorage.setItem(offlineFieldStatusSnapshotKey(userId), JSON.stringify({
            savedAt: new Date().toISOString(),
            sections: nextSections,
            totals: body?.totals ?? null,
            rotation: nextRotation,
            graph: nextGraph,
          }));
        } catch {
          // Storage is optional; the live panel is unaffected.
        }
      }
    } catch {
      if (!controller.signal.aborted) setFieldError(true);
    } finally {
      if (fieldRequestRef.current === controller) {
        fieldRequestRef.current = null;
        setFieldLoading(false);
      }
    }
  }, [userId]);

  const refreshOfflineMap = useCallback(() => {
    setOfflineRefreshKey((version) => version + 1);
  }, []);

  const loadPadrones = useCallback(async () => {
    padronesRequestRef.current?.abort();
    const controller = new AbortController();
    padronesRequestRef.current = controller;
    setPadronesLoaded(false);
    setPadronesTruncated(false);
    try {
      const res = await retryTransientResponse(() => fetchWithTimeout("/api/padrones", { cache: "no-store", signal: controller.signal }, 10000), { signal: controller.signal });
      if (!res.ok) throw new Error("padrones request failed");
      const nextPadrones = await res.json();
      if (controller.signal.aborted || padronesRequestRef.current !== controller) return;
      setPadrones(Array.isArray(nextPadrones) ? nextPadrones : []);
      setPadronesTruncated(res.headers.get("X-CampoAI-Padrones-Truncated") === "true");
      setPadronesLoadError(false);
    } catch {
      if (!controller.signal.aborted) setPadronesLoadError(true);
    } finally {
      if (padronesRequestRef.current === controller) {
        padronesRequestRef.current = null;
        setPadronesLoaded(true);
      }
    }
  }, []);

  const loadFeatures = useCallback(async () => {
    featuresRequestRef.current?.abort();
    const controller = new AbortController();
    featuresRequestRef.current = controller;
    setFeaturesLoaded(false);
    setFeaturesTruncated(false);
    try {
      const res = await retryTransientResponse(() => fetchWithTimeout("/api/map-features", { cache: "no-store", signal: controller.signal }, 10000), { signal: controller.signal });
      if (!res.ok) throw new Error("map features request failed");
      const nextFeatures = await res.json();
      if (controller.signal.aborted || featuresRequestRef.current !== controller) return;
      setMapFeatures(Array.isArray(nextFeatures) ? nextFeatures : []);
      setFeaturesTruncated(res.headers.get("X-CampoAI-Map-Features-Truncated") === "true");
      setFeaturesLoadError(false);
    } catch {
      if (!controller.signal.aborted) setFeaturesLoadError(true);
    } finally {
      if (featuresRequestRef.current === controller) {
        featuresRequestRef.current = null;
        setFeaturesLoaded(true);
      }
    }
  }, []);

  useEffect(() => () => {
    padronesRequestRef.current?.abort();
    featuresRequestRef.current?.abort();
  }, []);

  useEffect(() => {
    if (offlineReadOnly) return;
    setOfflineMapAvailable(null);
    setOfflineMapSavedAt(null);
    void Promise.all([loadPadrones(), loadFeatures(), loadFieldStatus()]);
    return () => {
      padronesRequestRef.current?.abort();
      featuresRequestRef.current?.abort();
      fieldRequestRef.current?.abort();
    };
  }, [loadFeatures, loadFieldStatus, loadPadrones, offlineReadOnly]);

  useEffect(() => {
    if (!offlineReadOnly) return;
    let snapshot = null;
    try {
      snapshot = userId
        ? parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)))
        : null;
    } catch {
      snapshot = null;
    }
    let fieldSnapshot = null;
    try {
      fieldSnapshot = userId ? parseOfflineFieldStatusSnapshot(window.localStorage.getItem(offlineFieldStatusSnapshotKey(userId))) : null;
    } catch {
      fieldSnapshot = null;
    }
    setFieldStatuses(fieldSnapshot?.sections ?? []);
    setFieldTotals(fieldSnapshot?.totals ?? null);
    setRotation(fieldSnapshot?.rotation ?? []);
    setGraph(fieldSnapshot?.graph ?? null);
    setFieldError(false);
    if (snapshot && isOfflineSnapshotFresh(snapshot.savedAt)) {
      setPadrones(snapshot.padrones as Padron[]);
      setMapFeatures(snapshot.mapFeatures as MapFeature[]);
      setPadronesTruncated(snapshot.padronesTruncated === true);
      setFeaturesTruncated(snapshot.mapFeaturesTruncated === true);
      setPadronesLoadError(false);
      setFeaturesLoadError(false);
      setPadronesLoaded(true);
      setFeaturesLoaded(true);
      setOfflineMapSavedAt(snapshot.savedAt);
      setOfflineMapAvailable(true);
    } else {
      setPadrones([]);
      setMapFeatures([]);
      setPadronesTruncated(false);
      setFeaturesTruncated(false);
      setPadronesLoadError(false);
      setFeaturesLoadError(false);
      setPadronesLoaded(true);
      setFeaturesLoaded(true);
      setOfflineMapSavedAt(null);
      setOfflineMapAvailable(false);
    }
  }, [offlineRefreshKey, offlineReadOnly, userId]);

  useOfflineSnapshotRefresh(refreshOfflineMap, userId, offlineReadOnly);

  // Keep the map current when another page or browser tab changes a section,
  // padrón, or infrastructure feature. Mutations already emit this shared
  // event, so the map can refresh without requiring a full route reload.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onDataChanged = () => {
      if (offlineReadOnly) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void Promise.all([loadPadrones(), loadFeatures(), loadFieldStatus()]);
      }, 300);
    };
    const unsubscribe = subscribeToAppEvent(DATA_CHANGED_EVENT, onDataChanged);
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [loadFeatures, loadFieldStatus, loadPadrones, offlineReadOnly]);

  return {
    padrones, mapFeatures,
    padronesLoaded, featuresLoaded, padronesLoadError, featuresLoadError, padronesTruncated, featuresTruncated,
    offlineMapSavedAt, offlineMapAvailable,
    fieldStatuses, fieldTotals, rotation, graph, fieldLoading, fieldError,
    loadPadrones, loadFeatures, loadFieldStatus,
  };
}
