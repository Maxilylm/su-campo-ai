"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch";
import { isOfflineSnapshotFresh, offlineEntitySnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import type { CattleOption, HealthEvent, Vaccination } from "./types";

/** Vaccinations, health events and lot options — online from the API, or
 * read-only from the fresh offline snapshot. Refreshes on data changes. */
export function useSanidadData(offlineReadOnly: boolean, userId: string | null) {
  const [vaccinations, setVaccinations] = useState<Vaccination[]>([]);
  const [cattleOptions, setCattleOptions] = useState<CattleOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [healthEvents, setHealthEvents] = useState<HealthEvent[]>([]);
  const [vaccinationsTruncated, setVaccinationsTruncated] = useState(false);
  const [healthEventsTruncated, setHealthEventsTruncated] = useState(false);
  const [offlineHealthSavedAt, setOfflineHealthSavedAt] = useState<string | null>(null);
  const healthDataRequestRef = useRef<AbortController | null>(null);

  const loadData = useCallback(async () => {
    healthDataRequestRef.current?.abort();
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
        setVaccinations(snapshot.vaccinations as Vaccination[]);
        setHealthEvents(snapshot.healthEvents as HealthEvent[]);
        setCattleOptions(snapshot.cattle as CattleOption[]);
        setVaccinationsTruncated(snapshot.vaccinationsTruncated === true);
        setHealthEventsTruncated(snapshot.healthEventsTruncated === true);
        setOfflineHealthSavedAt(snapshot.savedAt);
        setLoadError(false);
      } else {
        setVaccinations([]);
        setHealthEvents([]);
        setCattleOptions([]);
        setOfflineHealthSavedAt(null);
        setLoadError(true);
      }
      setLoaded(true);
      return;
    }
    const controller = new AbortController();
    healthDataRequestRef.current = controller;
    setOfflineHealthSavedAt(null);
    setLoadError(false);
    setVaccinationsTruncated(false);
    setHealthEventsTruncated(false);
    try {
      const [vaccinationResponse, healthResponse, cattleResponse] = await Promise.all([
        fetchWithTimeout("/api/vaccinations", { cache: "no-store", signal: controller.signal }, 8000),
        fetchWithTimeout("/api/health", { cache: "no-store", signal: controller.signal }, 8000),
        fetchWithTimeout("/api/cattle", { cache: "no-store", signal: controller.signal }, 8000),
      ]);
      if (!vaccinationResponse.ok || !healthResponse.ok) throw new Error("health request failed");
      const [vacc, health] = await Promise.all([vaccinationResponse.json(), healthResponse.json()]);
      const cattle = cattleResponse.ok ? await cattleResponse.json() : [];
      if (controller.signal.aborted || healthDataRequestRef.current !== controller) return;
      setVaccinations(Array.isArray(vacc) ? vacc : []);
      setHealthEvents(Array.isArray(health) ? health : []);
      setVaccinationsTruncated(vaccinationResponse.headers.get("X-CampoAI-Vaccinations-Truncated") === "true");
      setHealthEventsTruncated(healthResponse.headers.get("X-CampoAI-Health-Truncated") === "true");
      setCattleOptions(Array.isArray(cattle) ? cattle : []);
    } catch (e) {
      if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      console.error("Load sanidad error:", e);
      setLoadError(true);
    } finally {
      if (healthDataRequestRef.current === controller) {
        healthDataRequestRef.current = null;
        setLoaded(true);
      }
    }
  }, [offlineReadOnly, userId]);

  useEffect(() => {
    void loadData();
    return () => healthDataRequestRef.current?.abort();
  }, [loadData]);
  useDataChangedRefresh(loadData, !offlineReadOnly);
  useOfflineSnapshotRefresh(loadData, userId, offlineReadOnly);

  return {
    vaccinations, healthEvents, cattleOptions, loaded, loadError,
    vaccinationsTruncated, healthEventsTruncated, offlineHealthSavedAt, loadData,
  };
}
