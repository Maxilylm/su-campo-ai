"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, CloudDownload, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useFarm, type Farm, type Section } from "@/contexts/FarmContext";
import type { Alert } from "@/lib/alerts";
import { fetchWithTimeout } from "@/lib/fetch";
import { notifyDataChanged } from "@/lib/mutate";
import {
  buildOfflineSyncBundle,
  offlineActivitySnapshotKey,
  offlineAgendaSnapshotKey,
  offlineEntitySnapshotKey,
  offlineSnapshotKey,
  offlineWeatherSnapshotKey,
  parseOfflineActivitySnapshot,
  parseOfflineAgendaSnapshot,
  parseOfflineEntitySnapshot,
  parseOfflineSnapshot,
  persistOfflineSyncBundle,
} from "@/lib/offline";
import { Button } from "@/components/ui/button";

type SyncEndpointResult = {
  data: unknown;
  cattleTruncated: boolean;
  tasksTruncated: boolean;
  alertsTruncated: boolean;
  sectionsTruncated: boolean;
  vaccinationsTruncated: boolean;
  healthEventsTruncated: boolean;
  cropsTruncated: boolean;
  padronesTruncated: boolean;
  mapFeaturesTruncated: boolean;
};

async function readSyncEndpointWithMeta(url: string, signal?: AbortSignal): Promise<SyncEndpointResult> {
  const response = await fetchWithTimeout(url, { signal }, 10_000);
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
      ? payload.error
      : "No se pudo sincronizar toda la información.";
    throw new Error(message);
  }
  return {
    data: payload,
    cattleTruncated: response.headers.get("X-CampoAI-Cattle-Truncated") === "true",
    tasksTruncated: response.headers.get("X-CampoAI-Tasks-Truncated") === "true",
    alertsTruncated: Boolean(payload && typeof payload === "object" && "alertsTruncated" in payload && payload.alertsTruncated === true),
    sectionsTruncated: response.headers.get("X-CampoAI-Sections-Truncated") === "true",
    vaccinationsTruncated: response.headers.get("X-CampoAI-Vaccinations-Truncated") === "true",
    healthEventsTruncated: response.headers.get("X-CampoAI-Health-Truncated") === "true",
    cropsTruncated: response.headers.get("X-CampoAI-Crops-Truncated") === "true",
    padronesTruncated: response.headers.get("X-CampoAI-Padrones-Truncated") === "true",
    mapFeaturesTruncated: response.headers.get("X-CampoAI-Map-Features-Truncated") === "true",
  };
}

async function readSyncEndpoint(url: string, signal?: AbortSignal): Promise<unknown> {
  return (await readSyncEndpointWithMeta(url, signal)).data;
}

function isFarm(value: unknown): value is Farm {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<Farm>;
  return typeof candidate.id === "string"
    && typeof candidate.name === "string"
    && (candidate.total_hectares === null || typeof candidate.total_hectares === "number")
    && (candidate.location === null || typeof candidate.location === "string")
    && (candidate.operation_type === "livestock" || candidate.operation_type === "crops" || candidate.operation_type === "mixed");
}

function hasUsableWeather(value: unknown): value is { available: true; current: object } {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { available?: unknown; current?: unknown };
  return candidate.available === true && Boolean(candidate.current && typeof candidate.current === "object" && !Array.isArray(candidate.current));
}

function hasNoWeatherLocation(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && (value as { reason?: unknown }).reason === "no_location");
}

export function OfflineSyncControl({ onSynced }: { onSynced?: (savedAt: string) => void }) {
  const { userId, isOnline, offlineMode, clearOfflineSnapshotStale: clearStaleStatus } = useFarm();
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const mountedRef = useRef(true);
  const syncRequestRef = useRef<AbortController | null>(null);
  const unavailable = !userId || !isOnline || offlineMode;

  useEffect(() => () => {
    mountedRef.current = false;
    syncRequestRef.current?.abort();
  }, []);

  useEffect(() => {
    if (unavailable) syncRequestRef.current?.abort();
  }, [unavailable]);

  useEffect(() => {
    if (!userId) return;
    try {
      const storedFarm = parseOfflineSnapshot(window.localStorage.getItem(offlineSnapshotKey(userId)));
      const storedAgenda = parseOfflineAgendaSnapshot(window.localStorage.getItem(offlineAgendaSnapshotKey(userId)));
      const storedEntities = parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)));
      const storedActivity = parseOfflineActivitySnapshot(window.localStorage.getItem(offlineActivitySnapshotKey(userId)));
      const storedWarnings = [
        ...(storedFarm?.syncWarnings ?? []),
        ...(storedAgenda?.syncWarnings ?? []),
        ...(storedEntities?.syncWarnings ?? []),
        ...(storedActivity?.syncWarnings ?? []),
      ];
      setSyncedAt(storedFarm?.savedAt ?? storedAgenda?.savedAt ?? storedActivity?.savedAt ?? null);
      setWarnings([...new Set(storedWarnings)]);
    } catch {
      // Storage is optional; the online sync control remains usable without it.
    }
  }, [userId]);

  async function sync() {
    if (unavailable || syncing) return;
    setSyncing(true);
    setError(null);
    setWarnings([]);
    const controller = new AbortController();
    syncRequestRef.current = controller;
    try {
      const [farmResult, sectionsResult, alertsResult, tasksResult, cattleResult, cropsResult, inventoryResult, healthResult, vaccinationsResult, activitiesResult, padronesResult, mapFeaturesResult, weatherResult] = await Promise.allSettled([
        readSyncEndpoint("/api/farm", controller.signal),
        readSyncEndpointWithMeta("/api/sections", controller.signal),
        readSyncEndpointWithMeta("/api/alerts", controller.signal),
        readSyncEndpointWithMeta("/api/tasks", controller.signal),
        readSyncEndpointWithMeta("/api/cattle", controller.signal),
        readSyncEndpointWithMeta("/api/crops", controller.signal),
        readSyncEndpoint("/api/inventory", controller.signal),
        readSyncEndpointWithMeta("/api/health", controller.signal),
        readSyncEndpointWithMeta("/api/vaccinations", controller.signal),
        readSyncEndpoint("/api/activities?limit=5", controller.signal),
        readSyncEndpointWithMeta("/api/padrones", controller.signal),
        readSyncEndpointWithMeta("/api/map-features", controller.signal),
        readSyncEndpoint("/api/weather", controller.signal),
      ]);
      if (controller.signal.aborted) return;

      const previousFarm = parseOfflineSnapshot(window.localStorage.getItem(offlineSnapshotKey(userId)));
      const previousAgenda = parseOfflineAgendaSnapshot(window.localStorage.getItem(offlineAgendaSnapshotKey(userId)));
      const previousEntities = parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)));
      const previousActivity = parseOfflineActivitySnapshot(window.localStorage.getItem(offlineActivitySnapshotKey(userId)));
      const syncWarnings: string[] = [];

      function failed(label: string) {
        syncWarnings.push(`${label} no se actualizó; conservamos la última copia disponible.`);
      }

      function readArrayResult(
        result: PromiseSettledResult<unknown>,
        label: string,
        fallback: unknown[],
        fallbackMeta: Partial<SyncEndpointResult> = {},
      ) {
        const response = result.status === "fulfilled" ? result.value as SyncEndpointResult : null;
        if (response && Array.isArray(response.data)) return response;
        failed(label);
        return {
          data: fallback,
          cattleTruncated: false,
          tasksTruncated: false,
          alertsTruncated: false,
          sectionsTruncated: false,
          vaccinationsTruncated: false,
          healthEventsTruncated: false,
          cropsTruncated: false,
          padronesTruncated: false,
          mapFeaturesTruncated: false,
          ...fallbackMeta,
        } satisfies SyncEndpointResult;
      }

      function readNestedArrayResult(
        result: PromiseSettledResult<unknown>,
        label: string,
        field: "alerts" | "tasks",
        fallback: unknown[],
        fallbackMeta: Partial<SyncEndpointResult> = {},
      ) {
        const response = result.status === "fulfilled" ? result.value as SyncEndpointResult : null;
        const payload = response?.data ?? null;
        const values = payload && typeof payload === "object" && field in payload
          ? (payload as Record<string, unknown>)[field]
          : null;
        if (response && Array.isArray(values)) return { ...response, data: values };
        failed(label);
        return {
          data: fallback,
          cattleTruncated: false,
          tasksTruncated: false,
          alertsTruncated: false,
          sectionsTruncated: false,
          vaccinationsTruncated: false,
          healthEventsTruncated: false,
          cropsTruncated: false,
          padronesTruncated: false,
          mapFeaturesTruncated: false,
          ...fallbackMeta,
        } satisfies SyncEndpointResult;
      }

      const farmPayload = farmResult.status === "fulfilled" ? (farmResult.value as SyncEndpointResult).data : null;
      const farmCandidate = farmPayload && typeof farmPayload === "object" && "farm" in farmPayload ? farmPayload.farm : null;
      const farm = isFarm(farmCandidate) ? farmCandidate : previousFarm?.farm;
      if (!isFarm(farm)) {
        failed("El campo");
        throw new Error("No se pudo obtener el campo para crear la copia offline.");
      }
      if (farmResult.status !== "fulfilled" || !isFarm(farmCandidate)) failed("El campo");

      const sectionsResponse = readArrayResult(
        sectionsResult,
        "Las secciones",
        previousFarm?.sections ?? previousEntities?.sections ?? [],
        { sectionsTruncated: previousFarm?.sectionsTruncated ?? previousEntities?.sectionsTruncated },
      );
      const alertsResponse = readNestedArrayResult(
        alertsResult,
        "Los pendientes",
        "alerts",
        previousFarm?.alerts ?? [],
        { alertsTruncated: previousFarm?.alertsTruncated },
      );
      const tasksResponse = readNestedArrayResult(
        tasksResult,
        "Las tareas",
        "tasks",
        previousAgenda?.tasks ?? previousEntities?.tasks ?? [],
        { tasksTruncated: previousAgenda?.tasksTruncated ?? previousEntities?.tasksTruncated },
      );
      const cattleResponse = readArrayResult(
        cattleResult,
        "La hacienda",
        previousAgenda?.cattle ?? previousEntities?.cattle ?? [],
        { cattleTruncated: previousAgenda?.cattleTruncated ?? previousEntities?.cattleTruncated },
      );
      const cropsResponse = readArrayResult(
        cropsResult,
        "Los cultivos",
        previousAgenda?.crops ?? previousEntities?.crops ?? [],
        { cropsTruncated: previousEntities?.cropsTruncated },
      );
      const inventoryResponse = readArrayResult(inventoryResult, "El inventario", previousEntities?.inventory ?? []);
      const healthEventsResponse = readArrayResult(
        healthResult,
        "La sanidad",
        previousEntities?.healthEvents ?? [],
        { healthEventsTruncated: previousEntities?.healthEventsTruncated },
      );
      const vaccinationsResponse = readArrayResult(
        vaccinationsResult,
        "Las vacunaciones",
        previousEntities?.vaccinations ?? [],
        { vaccinationsTruncated: previousEntities?.vaccinationsTruncated },
      );
      const activitiesResponse = readArrayResult(activitiesResult, "La actividad", previousActivity?.activities ?? []);
      const padronesResponse = readArrayResult(padronesResult, "Los padrones", previousEntities?.padrones ?? [], { padronesTruncated: previousEntities?.padronesTruncated });
      const mapFeaturesResponse = readArrayResult(mapFeaturesResult, "La infraestructura del mapa", previousEntities?.mapFeatures ?? [], { mapFeaturesTruncated: previousEntities?.mapFeaturesTruncated });
      const tasksPayload = tasksResult.status === "fulfilled"
        ? (tasksResult.value as SyncEndpointResult).data
        : null;

      const savedAt = new Date().toISOString();
      const weatherPayload = weatherResult.status === "fulfilled" ? weatherResult.value : null;
      if (!hasUsableWeather(weatherPayload) && (weatherResult.status !== "fulfilled" || !hasNoWeatherLocation(weatherPayload))) {
        failed("El clima");
      }
      if (hasUsableWeather(weatherPayload)) {
        try {
          window.localStorage.setItem(offlineWeatherSnapshotKey(userId), JSON.stringify({
            data: weatherPayload,
            farmId: farm.id,
            location: farm.location,
            savedAt,
          }));
        } catch {
          failed("El clima");
        }
      }
      const bundle = buildOfflineSyncBundle({
        farm,
        sections: sectionsResponse.data as Section[],
        alerts: alertsResponse.data as Alert[],
        tasks: tasksResponse.data as unknown[],
        cattle: cattleResponse.data as unknown[],
        crops: cropsResponse.data as unknown[],
        inventory: inventoryResponse.data as unknown[],
        healthEvents: healthEventsResponse.data as unknown[],
        vaccinations: vaccinationsResponse.data as unknown[],
        padrones: padronesResponse.data as unknown[],
        mapFeatures: mapFeaturesResponse.data as unknown[],
        activities: activitiesResponse.data as unknown[],
        cattleTruncated: sectionsResponse.cattleTruncated || cattleResponse.cattleTruncated,
        tasksTruncated: tasksResponse.tasksTruncated,
        alertsTruncated: alertsResponse.alertsTruncated,
        sectionsTruncated: sectionsResponse.sectionsTruncated,
        vaccinationsTruncated: vaccinationsResponse.vaccinationsTruncated,
        healthEventsTruncated: healthEventsResponse.healthEventsTruncated,
        cropsTruncated: cropsResponse.cropsTruncated,
        padronesTruncated: padronesResponse.padronesTruncated,
        mapFeaturesTruncated: mapFeaturesResponse.mapFeaturesTruncated,
        migrationRequired: tasksPayload && typeof tasksPayload === "object" && "migrationRequired" in tasksPayload
          ? tasksPayload.migrationRequired === true
          : previousAgenda?.migrationRequired === true,
        alertsSyncedAt: alertsResult.status === "fulfilled"
          ? savedAt
          : previousFarm?.alertsSyncedAt ?? previousFarm?.savedAt ?? null,
        syncWarnings,
      }, savedAt);

      persistOfflineSyncBundle(window.localStorage, userId, bundle);
      // Keep the mounted dashboard, search palette, and other data consumers
      // aligned with the new server snapshot without requiring a full reload.
      notifyDataChanged();
      clearStaleStatus();
      setSyncedAt(savedAt);
      setWarnings(syncWarnings);
      onSynced?.(savedAt);
      if (syncWarnings.length > 0) {
        toast.warning("Copias offline actualizadas parcialmente", { description: `${syncWarnings.length} conjunto(s) conserva(n) su última copia disponible.` });
      } else {
        toast.success("Copias offline actualizadas", { description: "Panel, agenda, actividad, clima, mapa y búsqueda listos para usar sin conexión." });
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : "No se pudo completar la sincronización.";
      setError(message);
      toast.error("No se pudieron actualizar las copias offline", { description: message });
    } finally {
      if (syncRequestRef.current === controller) syncRequestRef.current = null;
      if (mountedRef.current) setSyncing(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3.5">
      <div className="flex items-start gap-3 text-sm">
        <CloudDownload className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="font-medium">Preparar modo offline</p>
          <p className="text-xs text-muted-foreground">Descarga una copia privada del panel, agenda, actividad, clima, mapa y búsqueda.</p>
          {syncedAt && <p role="status" className="mt-1 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" />Actualizado {new Date(syncedAt).toLocaleString("es-UY")}</p>}
          {error && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          {warnings.length > 0 && <div role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-300"><p className="font-medium">Sincronización parcial</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => void sync()} disabled={unavailable || syncing} title={unavailable ? "Necesitás conexión con el servidor" : undefined}>
        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Sincronizando…" : "Sincronizar ahora"}
      </Button>
    </div>
  );
}
