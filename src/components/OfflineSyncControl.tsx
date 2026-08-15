"use client";

import { useState } from "react";
import { CheckCircle2, CloudDownload, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useFarm, type Farm } from "@/contexts/FarmContext";
import { fetchWithTimeout } from "@/lib/fetch";
import { notifyDataChanged } from "@/lib/mutate";
import {
  buildOfflineSyncBundle,
  offlineActivitySnapshotKey,
  offlineAgendaSnapshotKey,
  offlineEntitySnapshotKey,
  offlineSnapshotKey,
} from "@/lib/offline";
import { Button } from "@/components/ui/button";

type SyncEndpointResult = { data: unknown; cattleTruncated: boolean; tasksTruncated: boolean };

async function readSyncEndpointWithMeta(url: string): Promise<SyncEndpointResult> {
  const response = await fetchWithTimeout(url, {}, 10_000);
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
  };
}

async function readSyncEndpoint(url: string): Promise<unknown> {
  return (await readSyncEndpointWithMeta(url)).data;
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

export function OfflineSyncControl({ onSynced }: { onSynced?: (savedAt: string) => void }) {
  const { userId, isOnline, offlineMode } = useFarm();
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unavailable = !userId || !isOnline || offlineMode;

  async function sync() {
    if (unavailable || syncing) return;
    setSyncing(true);
    setError(null);
    try {
      const [farmPayload, sectionsResponse, alertsPayload, tasksResponse, cattleResponse, crops, inventory, healthEvents, vaccinations, activities] = await Promise.all([
        readSyncEndpoint("/api/farm"),
        readSyncEndpointWithMeta("/api/sections"),
        readSyncEndpoint("/api/alerts"),
        readSyncEndpointWithMeta("/api/tasks"),
        readSyncEndpointWithMeta("/api/cattle"),
        readSyncEndpoint("/api/crops"),
        readSyncEndpoint("/api/inventory"),
        readSyncEndpoint("/api/health"),
        readSyncEndpoint("/api/vaccinations"),
        readSyncEndpoint("/api/activities?limit=5"),
      ]);

      const farm = farmPayload && typeof farmPayload === "object" && "farm" in farmPayload ? farmPayload.farm : null;
      const sections = sectionsResponse.data;
      const cattle = cattleResponse.data;
      const alerts = alertsPayload && typeof alertsPayload === "object" && "alerts" in alertsPayload ? alertsPayload.alerts : null;
      const tasksPayload = tasksResponse.data;
      const tasks = tasksPayload && typeof tasksPayload === "object" && "tasks" in tasksPayload ? tasksPayload.tasks : null;
      if (!isFarm(farm) || !Array.isArray(sections) || !Array.isArray(alerts) || !Array.isArray(tasks)) {
        throw new Error("La respuesta de sincronización está incompleta.");
      }

      const savedAt = new Date().toISOString();
      const bundle = buildOfflineSyncBundle({
        farm,
        sections,
        alerts,
        tasks,
        cattle: Array.isArray(cattle) ? cattle : [],
        crops: Array.isArray(crops) ? crops : [],
        inventory: Array.isArray(inventory) ? inventory : [],
        healthEvents: Array.isArray(healthEvents) ? healthEvents : [],
        vaccinations: Array.isArray(vaccinations) ? vaccinations : [],
        activities: Array.isArray(activities) ? activities : [],
        cattleTruncated: sectionsResponse.cattleTruncated || cattleResponse.cattleTruncated,
        tasksTruncated: tasksResponse.tasksTruncated,
        migrationRequired: tasksPayload && typeof tasksPayload === "object" && "migrationRequired" in tasksPayload
          ? tasksPayload.migrationRequired === true
          : false,
      }, savedAt);

      window.localStorage.setItem(offlineSnapshotKey(userId), JSON.stringify(bundle.farm));
      window.localStorage.setItem(offlineAgendaSnapshotKey(userId), JSON.stringify(bundle.agenda));
      window.localStorage.setItem(offlineEntitySnapshotKey(userId), JSON.stringify(bundle.entities));
      window.localStorage.setItem(offlineActivitySnapshotKey(userId), JSON.stringify(bundle.activity));
      // Keep the mounted dashboard, search palette, and other data consumers
      // aligned with the new server snapshot without requiring a full reload.
      notifyDataChanged();
      setSyncedAt(savedAt);
      onSynced?.(savedAt);
      toast.success("Copias offline actualizadas", { description: "Panel, agenda, actividad y búsqueda listos para usar sin conexión." });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "No se pudo completar la sincronización.";
      setError(message);
      toast.error("No se pudieron actualizar las copias offline", { description: message });
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-3.5">
      <div className="flex items-start gap-3 text-sm">
        <CloudDownload className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div>
          <p className="font-medium">Preparar modo offline</p>
          <p className="text-xs text-muted-foreground">Descarga una copia privada del panel, agenda, actividad y búsqueda.</p>
          {syncedAt && <p role="status" className="mt-1 flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="h-3 w-3" />Actualizado {new Date(syncedAt).toLocaleString("es-UY")}</p>}
          {error && <p role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>}
        </div>
      </div>
      <Button variant="outline" size="sm" onClick={() => void sync()} disabled={unavailable || syncing} title={unavailable ? "Necesitás conexión con el servidor" : undefined}>
        <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />
        {syncing ? "Sincronizando…" : "Sincronizar ahora"}
      </Button>
    </div>
  );
}
