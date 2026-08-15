"use client";

import { useCallback, useEffect, useState } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { PageHeader } from "@/components/PageHeader";
import { LoadingPage } from "@/components/LoadingPage";
import { AlertsPanel } from "@/components/AlertsPanel";
import { WeatherPanel } from "@/components/WeatherPanel";
import { InsightsCard } from "@/components/InsightsCard";
import { RecentActivityPanel } from "@/components/RecentActivityPanel";
import { UpcomingAgendaCard } from "@/components/UpcomingAgendaCard";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";
import { fetchWithTimeout } from "@/lib/fetch";
import { DATA_CHANGED_EVENT, subscribeToAppEvent } from "@/lib/mutate";
import { isOfflineSnapshotFresh, offlineEntitySnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowRight, Beef, ClipboardCheck, DollarSign, LayoutGrid, RefreshCw, Ruler, Tractor, MapPin, Wheat } from "lucide-react";
import type { Section } from "@/contexts/FarmContext";

type CattleLite = { count: number; section_id?: string | null };
type SectionWithCattle = Section & { cattle?: CattleLite[] };
type CropLite = {
  id: string;
  section_id: string | null;
  crop_type: string;
  variety: string | null;
  planted_hectares: number | null;
  expected_harvest: string | null;
  status: string;
};

const CROP_STATUS_LABELS: Record<string, string> = {
  planted: "sembrado",
  growing: "creciendo",
  harvested: "cosechado",
  failed: "fallido",
};

function isCattleLite(value: unknown): value is CattleLite {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CattleLite>;
  return typeof candidate.count === "number"
    && Number.isFinite(candidate.count)
    && (candidate.section_id === undefined || candidate.section_id === null || typeof candidate.section_id === "string");
}

function isCropLite(value: unknown): value is CropLite {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<CropLite>;
  return typeof candidate.id === "string"
    && typeof candidate.status === "string"
    && (candidate.section_id === null || typeof candidate.section_id === "string")
    && typeof candidate.crop_type === "string"
    && (candidate.variety === null || typeof candidate.variety === "string");
}

export default function InicioPage() {
  const { farm, sections, loading, noFarm, error, sectionsError, userEmail, userId, offlineMode, isOnline, refreshFarm } = useFarm();
  const offlineReadOnly = offlineMode || !isOnline;
  const navigate = useOfflineAwareNavigation();
  const [crops, setCrops] = useState<CropLite[]>([]);
  const [cropsRequestKey, setCropsRequestKey] = useState("");
  const [cropsLoadError, setCropsLoadError] = useState(false);
  const [cattle, setCattle] = useState<CattleLite[]>([]);
  const [cattleRequestKey, setCattleRequestKey] = useState("");
  const [cattleLoadError, setCattleLoadError] = useState(false);
  const [cattleLoadTruncated, setCattleLoadTruncated] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshOfflineDashboard = useCallback(() => {
    setRefreshKey((version) => version + 1);
  }, []);

  useEffect(() => subscribeToAppEvent(DATA_CHANGED_EVENT, () => setRefreshKey((version) => version + 1)), []);
  useOfflineSnapshotRefresh(refreshOfflineDashboard, userId, offlineMode || !isOnline);

  useEffect(() => {
    if (!loading && noFarm) navigate("/setup");
  }, [loading, navigate, noFarm]);

  useEffect(() => {
    let active = true;
    const farmId = farm?.id;
    if (!farmId || offlineMode || !isOnline) return () => { active = false; };
    const requestKey = `${farmId}:online`;
    const controller = new AbortController();
    fetchWithTimeout("/api/crops", { signal: controller.signal }, 8000)
      .then(async (res) => {
        if (!res.ok) throw new Error("crops request failed");
        const data = await res.json();
        if (active && !controller.signal.aborted) {
          setCrops(Array.isArray(data) ? data : []);
          setCropsLoadError(false);
          setCropsRequestKey(requestKey);
        }
      })
      .catch(() => {
        if (active && !controller.signal.aborted) {
          setCropsLoadError(true);
          setCropsRequestKey(requestKey);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [farm?.id, offlineMode, isOnline, refreshKey]);

  useEffect(() => {
    let active = true;
    const farmId = farm?.id;
    const isReadOnly = offlineMode || !isOnline;
    if (!farmId || !userId || !isReadOnly) return () => { active = false; };

    try {
      const snapshot = parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)));
      if (!snapshot || !isOfflineSnapshotFresh(snapshot.savedAt)) return () => { active = false; };
      if (!active) return () => { active = false; };

      setCattle(snapshot.cattle.filter(isCattleLite));
      setCattleLoadError(false);
      setCattleLoadTruncated(snapshot.cattleTruncated === true);
      setCattleRequestKey(`${farmId}:offline`);
      setCrops(snapshot.crops.filter(isCropLite));
      setCropsLoadError(false);
      setCropsRequestKey(`${farmId}:offline`);
    } catch {
      // Offline data is an enhancement; a malformed local copy must not block the dashboard.
    }

    return () => { active = false; };
  }, [farm?.id, isOnline, offlineMode, refreshKey, userId]);

  useEffect(() => {
    let active = true;
    const farmId = farm?.id;
    if (!farmId || offlineMode || !isOnline) return () => { active = false; };
    const requestKey = `${farmId}:online`;
    const controller = new AbortController();
    fetchWithTimeout("/api/cattle", { signal: controller.signal }, 8000)
      .then(async (res) => {
        if (!res.ok) throw new Error("cattle request failed");
        const data = await res.json();
        if (active && !controller.signal.aborted) {
          setCattle(Array.isArray(data) ? data : []);
          setCattleLoadError(false);
          setCattleLoadTruncated(res.headers.get("X-CampoAI-Cattle-Truncated") === "true");
          setCattleRequestKey(requestKey);
        }
      })
      .catch(() => {
        if (active && !controller.signal.aborted) {
          setCattleLoadError(true);
          setCattleLoadTruncated(false);
          setCattleRequestKey(requestKey);
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [farm?.id, offlineMode, isOnline, refreshKey]);

  if (loading) return <LoadingPage />;
  if (error) {
    return (
      <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-12">
        <EmptyState
          icon={AlertTriangle}
          title={offlineReadOnly ? "Campo no disponible sin conexión" : "No se pudo cargar el campo"}
          description={offlineReadOnly ? "Conectate a internet para sincronizar el campo y volver a consultar el panel." : error}
          actionLabel={offlineReadOnly ? undefined : "Reintentar"}
          onAction={offlineReadOnly ? undefined : () => void refreshFarm()}
        />
      </main>
    );
  }
  if (!farm) return null;

  const allCattle = (sections as SectionWithCattle[]).flatMap((s) => s.cattle || []);
  // Sections intentionally omit unassigned batches. Prefer the complete
  // cattle endpoint for the KPI and fall back to the embedded section data
  // if that independent request is unavailable.
  const usingOnlineCattle = cattleRequestKey === `${farm.id}:online` && !cattleLoadError;
  const usingOfflineCattle = cattleRequestKey === `${farm.id}:offline` && !cattleLoadError;
  const offlineCattleUnavailable = (offlineMode || !isOnline) && !usingOfflineCattle;
  const cattleIncomplete = (usingOnlineCattle && cattleLoadTruncated)
    || (usingOfflineCattle && cattleLoadTruncated)
    || offlineCattleUnavailable;
  const cattleForKpi = usingOnlineCattle || usingOfflineCattle ? cattle : allCattle;
  const totalCattle = cattleIncomplete ? "—" : cattleForKpi.reduce((sum, c) => sum + c.count, 0);
  const unassignedCattle = cattleIncomplete ? 0 : cattleForKpi.filter((c) => !c.section_id).reduce((sum, c) => sum + c.count, 0);
  const sectionHectares = sections.reduce((sum, s) => sum + (s.size_hectares || 0), 0);
  // The farm total is the authoritative establishment surface. Section sizes
  // are only a fallback for older records that never stored that total.
  const totalHectares = farm.total_hectares ?? sectionHectares;
  const canShowCrops = (isOnline && !offlineMode && cropsRequestKey === `${farm.id}:online` && !cropsLoadError)
    || ((offlineMode || !isOnline) && cropsRequestKey === `${farm.id}:offline` && !cropsLoadError);
  const activeCrops = crops.filter((crop) => crop.status === "planted" || crop.status === "growing");

  const greeting = (() => {
    const hour = new Date().getHours();
    if (hour < 12) return "Buenos dias";
    if (hour < 18) return "Buenas tardes";
    return "Buenas noches";
  })();

  const displayName = userEmail ? userEmail.split("@")[0] : "";

  function openSectionTask(section: Section) {
    const params = new URLSearchParams({
      new: "1",
      title: `Revisar sección ${section.name}`,
      sectionId: section.id,
    });
    navigate(`/gestion/tareas?${params.toString()}`);
  }

  function openSectionExpense(section: Section) {
    const params = new URLSearchParams({
      new: "1",
      type: "egreso",
      category: "otro",
      description: `Gasto: ${section.name}`,
      sectionId: section.id,
    });
    navigate(`/gestion/finanzas?${params.toString()}`);
  }

  async function refreshDashboard() {
    setRefreshing(true);
    setRefreshKey((version) => version + 1);
    try {
      await refreshFarm();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-6 py-6">
      <PageHeader
        title={`${greeting}${displayName ? `, ${displayName}` : ""}`}
        description={`${farm.name} — ${new Date().toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" })}`}
        actions={
          <Button variant="outline" size="sm" onClick={() => void refreshDashboard()} disabled={refreshing || offlineMode || !isOnline}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Actualizando…" : "Actualizar"}
          </Button>
        }
      />

      {sectionsError && !offlineMode && isOnline && (
        <div role="status" className="mb-6 flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
          <span className="flex-1">Las secciones no se pudieron actualizar; algunas cifras pueden estar desactualizadas.</span>
          <Button variant="ghost" size="sm" onClick={() => void refreshFarm()} className="h-7 px-2 text-xs text-primary hover:bg-transparent hover:underline">Reintentar</Button>
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="Cabezas" value={totalCattle} accent="emerald" icon={Beef} />
        <StatCard label="Secciones" value={sections.length} accent="blue" icon={LayoutGrid} />
        <StatCard label="Hectareas" value={totalHectares} accent="amber" icon={Ruler} />
        <StatCard label="Cultivos activos" value={canShowCrops ? activeCrops.length : "—"} accent="emerald" icon={Wheat} />
        <StatCard
          label="Operacion"
          value={farm.operation_type === "livestock" ? "Ganaderia" : farm.operation_type === "crops" ? "Agricultura" : "Mixto"}
          accent="purple"
          icon={Tractor}
        />
      </div>
      {unassignedCattle > 0 && (
        <div role="status" className="-mt-5 mb-8 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          El total incluye {unassignedCattle} {unassignedCattle === 1 ? "cabeza" : "cabezas"} sin sección asignada.
        </div>
      )}
      {cattleIncomplete && (
        <div role="status" className="-mt-5 mb-8 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          {offlineCattleUnavailable
            ? "No hay una copia completa de la hacienda en este dispositivo. El total de cabezas se oculta hasta sincronizarlo con conexión."
            : "La copia de hacienda tiene más registros de los que muestra el panel. El total de cabezas se oculta para no presentar una cifra incompleta."}
          {isOnline && !offlineMode && <>{" "}<AuthenticatedDownloadLink href="/api/export?format=csv&table=cattle" filename="campoai-hacienda.csv" className="font-medium text-primary underline-offset-2 hover:underline">Descargar hacienda CSV</AuthenticatedDownloadLink></>}
        </div>
      )}

      <InsightsCard />
      <AlertsPanel />
      <UpcomingAgendaCard />
      <WeatherPanel />
      <RecentActivityPanel />

      {sections.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="Sin secciones"
          description="Agrega tu primera seccion en Produccion → Hacienda para empezar."
          actionLabel="Ir a Hacienda"
          onAction={() => navigate("/produccion/hacienda")}
        />
      ) : (
        <div>
          <h2 className="text-lg font-medium mb-4">Secciones</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {sections.map((s) => {
              const sectionCattle = (s as SectionWithCattle).cattle || [];
              const headCount = sectionCattle.reduce((sum, c) => sum + c.count, 0);
              const sectionCrops = canShowCrops ? crops.filter((crop) => crop.section_id === s.id) : [];
              const visibleCrops = sectionCrops.slice(0, 3);
              return (
                <div key={s.id} className="rounded-xl border border-border bg-card p-5" style={{ borderLeftWidth: 4, borderLeftColor: s.color }}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-muted-foreground text-xs">{s.size_hectares || "?"} ha</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {headCount > 0 && <span className="text-sm font-semibold tabular-nums">{headCount} cabezas</span>}
                      {headCount > 0 && <Badge variant="outline">Agua: {s.water_status}</Badge>}
                      {headCount > 0 && <Badge variant="outline">Pastura: {s.pasture_status}</Badge>}
                      {visibleCrops.map((crop) => (
                        <Badge key={crop.id} variant="outline" className="text-emerald-700 dark:text-emerald-400 border-emerald-500/30">
                          <Wheat className="mr-1 h-3 w-3" />
                          {crop.crop_type}{crop.variety ? ` (${crop.variety})` : ""} · {CROP_STATUS_LABELS[crop.status] || crop.status}
                        </Badge>
                      ))}
                      {sectionCrops.length > visibleCrops.length && (
                        <Badge variant="outline">+{sectionCrops.length - visibleCrops.length} cultivos</Badge>
                      )}
                      {headCount === 0 && sectionCrops.length === 0 && canShowCrops && (
                        <span className="text-sm text-muted-foreground">Sin registros productivos</span>
                      )}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/produccion/hacienda?sectionId=${encodeURIComponent(s.id)}`)}>
                      Ver detalle <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openSectionTask(s)}>
                      <ClipboardCheck className="mr-1.5 h-3.5 w-3.5" />Tarea
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openSectionExpense(s)}>
                      <DollarSign className="mr-1.5 h-3.5 w-3.5" />Gasto
                    </Button>
                    {sectionCrops.length > 0 && (
                      <Button variant="outline" size="sm" onClick={() => navigate(`/produccion/agricultura?sectionId=${encodeURIComponent(s.id)}`)}>
                        <Wheat className="mr-1.5 h-3.5 w-3.5" />Cultivos
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}
