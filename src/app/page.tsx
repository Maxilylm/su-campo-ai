"use client";

import { useCallback, useEffect, useState } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { StatStrip } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
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
import { Button } from "@/components/ui/button";
import { AlertTriangle, ArrowRight, ClipboardCheck, DollarSign, RefreshCw, MapPin, Wheat } from "lucide-react";
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
  const { farm, sections, loading, noFarm, error, sectionsError, userId, offlineMode, isOnline, refreshFarm } = useFarm();
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
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6">
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
    if (hour < 12) return "Buen día";
    if (hour < 20) return "Buenas tardes";
    return "Buenas noches";
  })();
  const today = new Date().toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long" });

  function openSectionTask(section: Section) {
    const params = new URLSearchParams({
      new: "1",
      title: `Revisar potrero ${section.name}`,
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

  const livestock = farm.operation_type !== "crops";
  const cropsFarm = farm.operation_type !== "livestock";
  const readouts = [
    ...(livestock ? [{
      label: "Hacienda",
      value: typeof totalCattle === "number" ? totalCattle.toLocaleString("es-UY") : totalCattle,
      unit: "cab.",
      hint: unassignedCattle > 0 ? `${unassignedCattle} sin potrero asignado` : undefined,
    }] : []),
    { label: "Potreros", value: sections.length },
    { label: "Superficie", value: Math.round(totalHectares).toLocaleString("es-UY"), unit: "ha" },
    ...(cropsFarm ? [{ label: "Cultivos en curso", value: canShowCrops ? activeCrops.length : "—" }] : []),
  ];

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-muted-foreground first-letter:uppercase">{greeting}, hoy es {today}.</p>
          <h1 className="mt-1 truncate text-[2rem] font-semibold leading-tight">{farm.name}</h1>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refreshDashboard()} disabled={refreshing || offlineMode || !isOnline} className="self-start sm:self-auto">
          <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
          {refreshing ? "Actualizando…" : "Actualizar"}
        </Button>
      </header>

      {sectionsError && !offlineMode && isOnline && (
        <div role="status" className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-sm text-warn">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span className="flex-1">Los potreros no se pudieron actualizar; algunas cifras pueden estar desactualizadas.</span>
          <Button variant="ghost" size="sm" onClick={() => void refreshFarm()} className="h-7 px-2">Reintentar</Button>
        </div>
      )}

      <StatStrip items={readouts} className="mb-3" />
      {cattleIncomplete && (
        <p role="status" className="mb-3 text-xs text-warn">
          {offlineCattleUnavailable
            ? "No hay una copia completa de la hacienda en este dispositivo; el total se muestra al sincronizar con conexión."
            : "La hacienda tiene más registros de los que muestra el panel; el total se oculta para no mostrar una cifra incompleta."}
          {isOnline && !offlineMode && <>{" "}<AuthenticatedDownloadLink href="/api/export?format=csv&table=cattle" filename="campoai-hacienda.csv" className="font-medium text-primary underline-offset-2 hover:underline">Descargar hacienda (CSV)</AuthenticatedDownloadLink></>}
        </p>
      )}

      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0 space-y-8">
          <InsightsCard />
          <AlertsPanel />
          <UpcomingAgendaCard />
        </div>
        <div className="min-w-0 space-y-8">
          <WeatherPanel />
          <RecentActivityPanel />
        </div>
      </div>

      <section className="mt-10" aria-labelledby="potreros-title">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="potreros-title" className="text-base font-semibold">Potreros</h2>
          <Button variant="ghost" size="sm" onClick={() => navigate("/mapa")}>
            <MapPin className="h-4 w-4" /> Ver en el mapa
          </Button>
        </div>
        {sections.length === 0 ? (
          <EmptyState
            icon={MapPin}
            title="Todavía no hay potreros"
            description="Cargá tu primer potrero en Hacienda para ver ocupación, pasturas y aguadas acá."
            actionLabel="Cargar un potrero"
            onAction={() => navigate("/produccion/hacienda")}
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {sections.map((s) => {
              const headCount = ((s as SectionWithCattle).cattle || []).reduce((sum, c) => sum + c.count, 0);
              const sectionCrops = canShowCrops ? crops.filter((crop) => crop.section_id === s.id) : [];
              const waterClass = s.water_status === "seco" || s.water_status === "inundado" ? "text-bad" : s.water_status === "bajo" ? "text-warn" : undefined;
              const pastureTone = s.pasture_status === "sobrepastoreado" || s.pasture_status === "seco" ? "warn" : null;
              return (
                <li key={s.id} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
                  <button
                    type="button"
                    onClick={() => navigate(`/produccion/hacienda?sectionId=${encodeURIComponent(s.id)}`)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left outline-none focus-visible:underline"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{s.name}</span>
                      <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                        {s.size_hectares ? <span className="figure">{s.size_hectares} ha</span> : null}
                        {headCount > 0 && <span className="figure text-foreground">{headCount} cab.</span>}
                        {headCount > 0 && <span className={waterClass}>Agua {s.water_status}</span>}
                        {headCount > 0 && <span className={pastureTone ? "text-warn" : undefined}>Pastura {s.pasture_status}</span>}
                        {sectionCrops.slice(0, 2).map((crop) => (
                          <span key={crop.id} className="flex items-center gap-1">
                            <Wheat className="h-3 w-3" aria-hidden="true" />
                            {crop.crop_type}{crop.variety ? ` ${crop.variety}` : ""}, {CROP_STATUS_LABELS[crop.status] || crop.status}
                          </span>
                        ))}
                        {sectionCrops.length > 2 && <span>+{sectionCrops.length - 2} cultivos</span>}
                        {headCount === 0 && sectionCrops.length === 0 && canShowCrops && <span>Libre</span>}
                      </span>
                    </span>
                  </button>
                  <div className="flex shrink-0 gap-1.5 pl-5 sm:pl-0">
                    <Button variant="outline" size="sm" onClick={() => openSectionTask(s)}>
                      <ClipboardCheck className="h-3.5 w-3.5" /> Tarea
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => openSectionExpense(s)}>
                      <DollarSign className="h-3.5 w-3.5" /> Gasto
                    </Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => navigate(`/produccion/hacienda?sectionId=${encodeURIComponent(s.id)}`)} aria-label={`Ver ${s.name}`}>
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
