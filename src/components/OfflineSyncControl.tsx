"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, CloudDownload, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useFarm, type Farm, type Section } from "@/contexts/FarmContext";
import type { Alert } from "@/lib/alerts";
import { fetchWithTimeout } from "@/lib/fetch";
import { notifyDataChanged, notifyOfflineSync, OFFLINE_SYNC_EVENT, subscribeToAppEvent } from "@/lib/mutate";
import { warmOfflineAppRoutes } from "@/lib/offline-app-routes";
import { allSettledWithConcurrency, extractFarmFromSyncResponse } from "@/lib/offline-sync";
import {
  buildOfflineSyncBundle,
  offlineActivitySnapshotKey,
  offlineAgendaSnapshotKey,
  offlineEntitySnapshotKey,
  offlineMetricsSnapshotKey,
  offlineSnapshotKey,
  offlineSnapshotKeys,
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
  financialTruncated: boolean;
  cropsTruncated: boolean;
  inventoryTruncated: boolean;
  inventoryMovementsTruncated: boolean;
  weightTruncated: boolean;
  cropApplicationsTruncated: boolean;
  activitiesTruncated: boolean;
  padronesTruncated: boolean;
  mapFeaturesTruncated: boolean;
};

const OFFLINE_METRIC_TYPES = ["general", "livestock", "crops"] as const;
const OFFLINE_METRIC_PERIODS = ["30d", "90d", "year"] as const;
const OFFLINE_ROUTES_WARNING = "Las pantallas offline";
const SYNC_WARNING_SUFFIX = " no se actualizó; conservamos la última copia disponible.";

type SyncTaskDefinition = {
  key: string;
  label: string;
  run: (signal: AbortSignal) => Promise<unknown>;
};

function warningFor(label: string): string {
  return `${label}${SYNC_WARNING_SUFFIX}`;
}

function warningMatchesLabel(warning: string, label: string): boolean {
  return warning === label || warning.startsWith(`${label} `);
}

function warningLabel(warning: string): string {
  if (warning.includes("no se actualizó")) return warning.replace(SYNC_WARNING_SUFFIX, "");
  if (warning.startsWith(OFFLINE_ROUTES_WARNING)) return OFFLINE_ROUTES_WARNING;
  return warning;
}

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
    financialTruncated: response.headers.get("X-CampoAI-Financial-Truncated") === "true",
    cropsTruncated: response.headers.get("X-CampoAI-Crops-Truncated") === "true",
    inventoryTruncated: response.headers.get("X-CampoAI-Inventory-Truncated") === "true",
    inventoryMovementsTruncated: response.headers.get("X-CampoAI-Movements-Truncated") === "true",
    weightTruncated: response.headers.get("X-CampoAI-Weight-Truncated") === "true",
    cropApplicationsTruncated: response.headers.get("X-CampoAI-Crop-Applications-Truncated") === "true",
    activitiesTruncated: response.headers.get("X-Has-More") === "true",
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

function hasUsableMetrics(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  return Boolean(payload.snapshot && typeof payload.snapshot === "object"
    && payload.livestock && typeof payload.livestock === "object"
    && payload.crops && typeof payload.crops === "object"
    && payload.trends && typeof payload.trends === "object");
}

export function OfflineSyncControl({ onSynced }: { onSynced?: (savedAt: string) => void }) {
  const { userId, isOnline, offlineMode, clearOfflineSnapshotStale: clearStaleStatus } = useFarm();
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [syncProgress, setSyncProgress] = useState<{ completed: number; total: number } | null>(null);
  const mountedRef = useRef(true);
  const syncRequestRef = useRef<AbortController | null>(null);
  const unavailable = !userId || !isOnline || offlineMode;

  const readStoredSyncStatus = useCallback(() => {
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

  useEffect(() => () => {
    mountedRef.current = false;
    syncRequestRef.current?.abort();
  }, []);

  useEffect(() => {
    if (unavailable) syncRequestRef.current?.abort();
  }, [unavailable]);

  useEffect(() => {
    readStoredSyncStatus();
    const userStorageKeys = new Set(offlineSnapshotKeys(userId ?? ""));
    const onStorage = (event: StorageEvent) => {
      if (!event.key || !userStorageKeys.has(event.key)) return;
      readStoredSyncStatus();
    };
    window.addEventListener("storage", onStorage);
    const unsubscribe = subscribeToAppEvent(OFFLINE_SYNC_EVENT, readStoredSyncStatus);
    return () => {
      window.removeEventListener("storage", onStorage);
      unsubscribe();
    };
  }, [readStoredSyncStatus, userId]);

  async function sync(options: { onlyWarnings?: string[] } = {}) {
    if (unavailable || syncing) return;
    setSyncing(true);
    setError(null);
    setWarnings([]);
    const controller = new AbortController();
    syncRequestRef.current = controller;
    try {
      const previousWarnings = [...new Set([
        ...(parseOfflineSnapshot(window.localStorage.getItem(offlineSnapshotKey(userId)))?.syncWarnings ?? []),
        ...(parseOfflineAgendaSnapshot(window.localStorage.getItem(offlineAgendaSnapshotKey(userId)))?.syncWarnings ?? []),
        ...(parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)))?.syncWarnings ?? []),
        ...(parseOfflineActivitySnapshot(window.localStorage.getItem(offlineActivitySnapshotKey(userId)))?.syncWarnings ?? []),
      ])];
      const retryLabels = options.onlyWarnings?.length
        ? new Set([
          ...options.onlyWarnings.map(warningLabel),
        ])
        : null;
      const shouldAttempt = (label: string) => retryLabels === null || retryLabels.has(label);
      const syncTaskDefinitions: SyncTaskDefinition[] = [
        { key: "farm", label: "El campo", run: (signal) => readSyncEndpoint("/api/farm", signal) },
        { key: "sections", label: "Las secciones", run: (signal) => readSyncEndpointWithMeta("/api/sections", signal) },
        { key: "alerts", label: "Los pendientes", run: (signal) => readSyncEndpointWithMeta("/api/alerts", signal) },
        { key: "tasks", label: "Las tareas", run: (signal) => readSyncEndpointWithMeta("/api/tasks", signal) },
        { key: "cattle", label: "La hacienda", run: (signal) => readSyncEndpointWithMeta("/api/cattle", signal) },
        { key: "crops", label: "Los cultivos", run: (signal) => readSyncEndpointWithMeta("/api/crops", signal) },
        { key: "inventory", label: "El inventario", run: (signal) => readSyncEndpointWithMeta("/api/inventory", signal) },
        { key: "inventoryMovements", label: "Los movimientos de inventario", run: (signal) => readSyncEndpointWithMeta("/api/inventory/movements", signal) },
        { key: "weight", label: "Los pesajes", run: (signal) => readSyncEndpointWithMeta("/api/weight", signal) },
        { key: "health", label: "La sanidad", run: (signal) => readSyncEndpointWithMeta("/api/health", signal) },
        { key: "financial", label: "Las finanzas", run: (signal) => readSyncEndpointWithMeta("/api/financial?period=year", signal) },
        ...OFFLINE_METRIC_PERIODS.map((period) => ({
          key: `metrics:${period}`,
          label: "Las métricas",
          run: (signal: AbortSignal) => readSyncEndpoint(`/api/metrics?period=${period}`, signal),
        })),
        { key: "vaccinations", label: "Las vacunaciones", run: (signal) => readSyncEndpointWithMeta("/api/vaccinations", signal) },
        { key: "activities", label: "La actividad", run: (signal) => readSyncEndpointWithMeta("/api/activities?limit=5", signal) },
        { key: "padrones", label: "Los padrones", run: (signal) => readSyncEndpointWithMeta("/api/padrones", signal) },
        { key: "mapFeatures", label: "La infraestructura del mapa", run: (signal) => readSyncEndpointWithMeta("/api/map-features", signal) },
        { key: "weather", label: "El clima", run: (signal) => readSyncEndpoint("/api/weather", signal) },
      ];
      const selectedTaskDefinitions = syncTaskDefinitions.filter(({ label }) => shouldAttempt(label));
      const syncTasks = selectedTaskDefinitions.map(({ run }) => () => run(controller.signal));
      setSyncProgress({ completed: 0, total: syncTasks.length });
      const syncResults = await allSettledWithConcurrency(
        syncTasks,
        4,
        (completed, total) => {
          if (mountedRef.current) setSyncProgress({ completed, total });
        },
      );
      if (controller.signal.aborted) return;
      const syncResultByKey = new Map(selectedTaskDefinitions.map(({ key }, index) => [key, syncResults[index]]));
      const farmResult = syncResultByKey.get("farm");
      const sectionsResult = syncResultByKey.get("sections");
      const alertsResult = syncResultByKey.get("alerts");
      const tasksResult = syncResultByKey.get("tasks");
      const cattleResult = syncResultByKey.get("cattle");
      const cropsResult = syncResultByKey.get("crops");
      const inventoryResult = syncResultByKey.get("inventory");
      const inventoryMovementsResult = syncResultByKey.get("inventoryMovements");
      const weightResult = syncResultByKey.get("weight");
      const healthResult = syncResultByKey.get("health");
      const financialResult = syncResultByKey.get("financial");
      const metricsResults = OFFLINE_METRIC_PERIODS.map((period) => syncResultByKey.get(`metrics:${period}`));
      const vaccinationsResult = syncResultByKey.get("vaccinations");
      const activitiesResult = syncResultByKey.get("activities");
      const padronesResult = syncResultByKey.get("padrones");
      const mapFeaturesResult = syncResultByKey.get("mapFeatures");
      const weatherResult = syncResultByKey.get("weather");

      const previousFarm = parseOfflineSnapshot(window.localStorage.getItem(offlineSnapshotKey(userId)));
      const previousAgenda = parseOfflineAgendaSnapshot(window.localStorage.getItem(offlineAgendaSnapshotKey(userId)));
      const previousEntities = parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)));
      const previousActivity = parseOfflineActivitySnapshot(window.localStorage.getItem(offlineActivitySnapshotKey(userId)));
      const syncWarnings: string[] = retryLabels === null
        ? []
        : previousWarnings.filter((warning) => ![...retryLabels].some((label) => warningMatchesLabel(warning, label)));

      function failed(label: string) {
        if (!shouldAttempt(label)) return;
        const warning = warningFor(label);
        if (!syncWarnings.includes(warning)) syncWarnings.push(warning);
      }

      function readArrayResult(
        result: PromiseSettledResult<unknown> | undefined,
        label: string,
        fallback: unknown[],
        fallbackMeta: Partial<SyncEndpointResult> = {},
      ) {
        const response = result?.status === "fulfilled" ? result.value as SyncEndpointResult : null;
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
          financialTruncated: false,
          cropsTruncated: false,
          inventoryTruncated: false,
          inventoryMovementsTruncated: false,
          weightTruncated: false,
          cropApplicationsTruncated: false,
          activitiesTruncated: false,
          padronesTruncated: false,
          mapFeaturesTruncated: false,
          ...fallbackMeta,
        } satisfies SyncEndpointResult;
      }

      function readNestedArrayResult(
        result: PromiseSettledResult<unknown> | undefined,
        label: string,
        field: "alerts" | "tasks",
        fallback: unknown[],
        fallbackMeta: Partial<SyncEndpointResult> = {},
      ) {
        const response = result?.status === "fulfilled" ? result.value as SyncEndpointResult : null;
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
          financialTruncated: false,
          cropsTruncated: false,
          inventoryTruncated: false,
          inventoryMovementsTruncated: false,
          weightTruncated: false,
          cropApplicationsTruncated: false,
          activitiesTruncated: false,
          padronesTruncated: false,
          mapFeaturesTruncated: false,
          ...fallbackMeta,
        } satisfies SyncEndpointResult;
      }

      const farmCandidate = extractFarmFromSyncResponse(farmResult?.status === "fulfilled" ? farmResult.value : null);
      const farm = isFarm(farmCandidate) ? farmCandidate : previousFarm?.farm;
      if (!isFarm(farm)) {
        failed("El campo");
        throw new Error("No se pudo obtener el campo para crear la copia offline.");
      }
      if (farmResult?.status !== "fulfilled" || !isFarm(farmCandidate)) failed("El campo");

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
        {
          cropsTruncated: previousEntities?.cropsTruncated,
          cropApplicationsTruncated: previousEntities?.cropApplicationsTruncated,
        },
      );
      const inventoryResponse = readArrayResult(
        inventoryResult,
        "El inventario",
        previousEntities?.inventory ?? [],
        { inventoryTruncated: previousEntities?.inventoryTruncated },
      );
      const inventoryMovementsResponse = readArrayResult(
        inventoryMovementsResult,
        "Los movimientos de inventario",
        previousEntities?.inventoryMovements ?? [],
        { inventoryMovementsTruncated: previousEntities?.inventoryMovementsTruncated },
      );
      const weightResponse = readArrayResult(
        weightResult,
        "Los pesajes",
        previousEntities?.weightRecords ?? [],
        { weightTruncated: previousEntities?.weightTruncated },
      );
      const healthEventsResponse = readArrayResult(
        healthResult,
        "La sanidad",
        previousEntities?.healthEvents ?? [],
        { healthEventsTruncated: previousEntities?.healthEventsTruncated },
      );
      const financialResponse = readArrayResult(
        financialResult,
        "Las finanzas",
        previousEntities?.financialTransactions ?? [],
        { financialTruncated: previousEntities?.financialTruncated },
      );
      const vaccinationsResponse = readArrayResult(
        vaccinationsResult,
        "Las vacunaciones",
        previousEntities?.vaccinations ?? [],
        { vaccinationsTruncated: previousEntities?.vaccinationsTruncated },
      );
      const activitiesResponse = readArrayResult(
        activitiesResult,
        "La actividad",
        previousActivity?.activities ?? [],
        { activitiesTruncated: previousActivity?.activitiesTruncated },
      );
      const padronesResponse = readArrayResult(padronesResult, "Los padrones", previousEntities?.padrones ?? [], { padronesTruncated: previousEntities?.padronesTruncated });
      const mapFeaturesResponse = readArrayResult(mapFeaturesResult, "La infraestructura del mapa", previousEntities?.mapFeatures ?? [], { mapFeaturesTruncated: previousEntities?.mapFeaturesTruncated });
      const tasksPayload = tasksResult?.status === "fulfilled"
        ? (tasksResult.value as SyncEndpointResult).data
        : null;

      const savedAt = new Date().toISOString();
      const weatherPayload = weatherResult?.status === "fulfilled" ? weatherResult.value : null;
      if (shouldAttempt("El clima")) {
        if (!hasUsableWeather(weatherPayload) && (weatherResult?.status !== "fulfilled" || !hasNoWeatherLocation(weatherPayload))) {
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
      }
      let metricsFailed = false;
      if (shouldAttempt("Las métricas")) {
        for (const [index, period] of OFFLINE_METRIC_PERIODS.entries()) {
          const metricsResult = metricsResults[index];
          const metricsPayload = metricsResult?.status === "fulfilled" ? metricsResult.value : null;
          if (!hasUsableMetrics(metricsPayload)) {
            metricsFailed = true;
            continue;
          }
          for (const type of OFFLINE_METRIC_TYPES) {
            try {
              window.localStorage.setItem(offlineMetricsSnapshotKey(userId, type, period), JSON.stringify({
                data: metricsPayload,
                type,
                period,
                savedAt,
              }));
            } catch {
              metricsFailed = true;
            }
          }
        }
      }
      if (metricsFailed) failed("Las métricas");
      if (shouldAttempt(OFFLINE_ROUTES_WARNING)) {
        const routeShellsReady = await warmOfflineAppRoutes();
        if (!routeShellsReady) {
          const routeWarning = "Las pantallas offline no terminaron de prepararse; abrí cada sección con conexión antes de salir del área.";
          if (!syncWarnings.includes(routeWarning)) syncWarnings.push(routeWarning);
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
        inventoryMovements: inventoryMovementsResult?.status === "fulfilled"
          && Array.isArray((inventoryMovementsResult.value as SyncEndpointResult).data)
          ? inventoryMovementsResponse.data as unknown[]
          : previousEntities?.inventoryMovements,
        weightRecords: weightResult?.status === "fulfilled"
          && Array.isArray((weightResult.value as SyncEndpointResult).data)
          ? weightResponse.data as unknown[]
          : previousEntities?.weightRecords,
        healthEvents: healthEventsResponse.data as unknown[],
        financialTransactions: financialResult?.status === "fulfilled"
          && Array.isArray((financialResult.value as SyncEndpointResult).data)
          ? financialResponse.data as unknown[]
          : previousEntities?.financialTransactions,
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
        financialTruncated: financialResponse.financialTruncated,
        inventoryTruncated: inventoryResponse.inventoryTruncated,
        inventoryMovementsTruncated: inventoryMovementsResponse.inventoryMovementsTruncated,
        weightTruncated: weightResponse.weightTruncated,
        cropApplicationsTruncated: cropsResponse.cropApplicationsTruncated,
        cropsTruncated: cropsResponse.cropsTruncated,
        activitiesTruncated: activitiesResponse.activitiesTruncated,
        padronesTruncated: padronesResponse.padronesTruncated,
        mapFeaturesTruncated: mapFeaturesResponse.mapFeaturesTruncated,
        migrationRequired: tasksPayload && typeof tasksPayload === "object" && "migrationRequired" in tasksPayload
          ? tasksPayload.migrationRequired === true
          : previousAgenda?.migrationRequired === true,
        alertsSyncedAt: alertsResult?.status === "fulfilled"
          ? savedAt
          : previousFarm?.alertsSyncedAt ?? previousFarm?.savedAt ?? null,
        syncWarnings,
      }, savedAt);

      persistOfflineSyncBundle(window.localStorage, userId, bundle);
      // Keep the mounted dashboard, search palette, and other data consumers
      // aligned with the new server snapshot without requiring a full reload.
      notifyOfflineSync();
      notifyDataChanged();
      clearStaleStatus();
      setSyncedAt(savedAt);
      setWarnings(syncWarnings);
      onSynced?.(savedAt);
      if (syncWarnings.length > 0) {
        toast.warning("Copias offline actualizadas parcialmente", { description: `${syncWarnings.length} conjunto(s) conserva(n) su última copia disponible.` });
      } else {
        toast.success("Copias offline actualizadas", { description: "Panel, agenda, finanzas, inventario, métricas, pesajes, actividad, clima, mapa y búsqueda listos para usar sin conexión." });
      }
    } catch (cause) {
      if (controller.signal.aborted) return;
      const message = cause instanceof Error ? cause.message : "No se pudo completar la sincronización.";
      setError(message);
      toast.error("No se pudieron actualizar las copias offline", { description: message });
    } finally {
      if (syncRequestRef.current === controller) syncRequestRef.current = null;
      if (mountedRef.current) {
        setSyncing(false);
        setSyncProgress(null);
      }
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3.5">
      <div className="flex items-start gap-3 text-sm">
        <CloudDownload className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="font-medium">Preparar modo offline</p>
          <p className="text-xs text-muted-foreground">Descarga una copia privada del panel, agenda, finanzas, inventario, métricas, pesajes, actividad, clima, mapa y búsqueda.</p>
          {syncedAt && <p role="status" className="mt-1 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" />Actualizado {new Date(syncedAt).toLocaleString("es-UY")}</p>}
          {syncing && syncProgress && <p role="status" className="mt-1 text-xs text-muted-foreground">Sincronizando {syncProgress.completed} de {syncProgress.total} conjuntos…</p>}
          {error && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
          {warnings.length > 0 && <div role="status" className="mt-2 text-xs text-amber-700 dark:text-amber-300"><p className="font-medium">Sincronización parcial</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul><Button variant="ghost" size="sm" className="mt-1 h-7 px-2 text-xs text-amber-800 hover:text-amber-950 dark:text-amber-200 dark:hover:text-amber-100" onClick={() => void sync({ onlyWarnings: warnings })} disabled={unavailable || syncing}><RefreshCw className={`mr-1.5 h-3 w-3 ${syncing ? "animate-spin" : ""}`} />Reintentar solo lo pendiente</Button></div>}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => void sync()} disabled={unavailable || syncing} title={unavailable ? "Necesitás conexión con el servidor" : undefined}>
        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? syncProgress ? `${syncProgress.completed}/${syncProgress.total}` : "Sincronizando…" : "Sincronizar ahora"}
      </Button>
    </div>
  );
}
