"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { WeatherPanel } from "@/components/WeatherPanel";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter,
  SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { fetchWithTimeout } from "@/lib/fetch";
import { inventoryUseHref } from "@/lib/inventory-navigation";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";
import { useUnsavedChangesWarning } from "@/lib/use-unsaved-changes-warning";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { isOfflineSnapshotFresh, offlineEntitySnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";
import {
  Wheat, Plus, MoreHorizontal, Pencil, Trash2, Sprout, MapPin, BarChart3, Layers, DollarSign,
} from "lucide-react";

// ─── Types ──────────────────────────────────

interface CropApplication {
  id: string;
  type: string;
  product_name: string | null;
  dose_per_hectare: string | null;
  total_applied: string | null;
  date_applied: string | null;
  applied_by: string | null;
  weather_conditions: string | null;
  notes: string | null;
}

interface Crop {
  id: string;
  section_id: string | null;
  crop_type: string;
  variety: string | null;
  planted_hectares: number | null;
  planting_date: string | null;
  expected_harvest: string | null;
  actual_harvest: string | null;
  yield_kg: number | null;
  yield_per_hectare: number | null;
  status: string;
  soil_type: string | null;
  irrigation_type: string | null;
  notes: string | null;
  sections?: { name: string } | null;
  crop_applications?: CropApplication[];
}

type AgricultureSheetMode = "add-crop" | "edit-crop" | "add-app";

interface AgricultureFormSnapshot {
  mode: AgricultureSheetMode;
  editId: string | null;
  appCropId: string | null;
  cropSection: string;
  cropType: string;
  cropVariety: string;
  cropHectares: string;
  cropPlantingDate: string;
  cropExpectedHarvest: string;
  cropActualHarvest: string;
  cropYieldKg: string;
  cropStatus: string;
  cropSoilType: string;
  cropIrrigationType: string;
  cropNotes: string;
  appType: string;
  appProduct: string;
  appDose: string;
  appTotal: string;
  appDate: string;
  appAppliedBy: string;
  appWeather: string;
  appNotes: string;
}

function agricultureFormSignature(form: AgricultureFormSnapshot): string {
  return JSON.stringify(form.mode === "add-app"
    ? {
      mode: form.mode, appCropId: form.appCropId, appType: form.appType, appProduct: form.appProduct,
      appDose: form.appDose, appTotal: form.appTotal, appDate: form.appDate, appAppliedBy: form.appAppliedBy,
      appWeather: form.appWeather, appNotes: form.appNotes,
    }
    : {
      mode: form.mode, editId: form.editId, cropSection: form.cropSection, cropType: form.cropType,
      cropVariety: form.cropVariety, cropHectares: form.cropHectares, cropPlantingDate: form.cropPlantingDate,
      cropExpectedHarvest: form.cropExpectedHarvest, cropActualHarvest: form.cropActualHarvest,
      cropYieldKg: form.cropYieldKg, cropStatus: form.cropStatus, cropSoilType: form.cropSoilType,
      cropIrrigationType: form.cropIrrigationType, cropNotes: form.cropNotes,
    });
}

// ─── Constants ──────────────────────────────

const CROP_TYPES = ["soja", "trigo", "maiz", "girasol", "sorgo", "cebada", "arroz", "avena", "otro"];
const SOIL_TYPES = ["arcilloso", "arenoso", "limoso", "franco"];
const IRRIGATION_TYPES = ["secano", "pivot", "aspersion", "goteo"];
const APP_TYPES = ["fertilizante", "herbicida", "insecticida", "fungicida"];
const WEATHER_OPTIONS = ["soleado", "nublado", "lluvioso", "ventoso"];

const STATUS_LABELS: Record<string, string> = {
  planted: "Sembrado",
  growing: "Creciendo",
  harvested: "Cosechado",
  failed: "Fallido",
};

const STATUS_BADGE_CLASSES: Record<string, string> = {
  planted: "text-blue-600 dark:text-blue-400 border-blue-500/30",
  growing: "text-emerald-600 dark:text-emerald-400 border-emerald-500/30",
  harvested: "text-amber-600 dark:text-amber-400 border-amber-500/30",
  failed: "text-red-600 dark:text-red-400 border-red-500/30",
};

// ─── Page Component ─────────────────────────

function AgriculturaPageContent() {
  const { sections, userId, readOnly } = useFarm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigationQuery = searchParams.toString();
  const [crops, setCrops] = useState<Crop[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [cropsTruncated, setCropsTruncated] = useState(false);
  const [applicationsTruncated, setApplicationsTruncated] = useState(false);
  const [offlineCropsSavedAt, setOfflineCropsSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const cropAttempt = useRef<{ key: string; signature: string } | null>(null);
  const applicationAttempt = useRef<{ key: string; signature: string } | null>(null);
  const cropsRequestRef = useRef<AbortController | null>(null);
  const handledNavigationQueryRef = useRef<string | null>(null);
  const [focusedCropId, setFocusedCropId] = useState<string | null>(null);
  const [focusedApplicationId, setFocusedApplicationId] = useState<string | null>(null);
  const [sectionFilterId, setSectionFilterId] = useState<string | null>(() => typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("sectionId"));

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<AgricultureSheetMode>("add-crop");
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [appCropId, setAppCropId] = useState<string | null>(null);
  const formBaselineRef = useRef<string | null>(null);

  // Crop form state
  const [cropSection, setCropSection] = useState("");
  const [cropType, setCropType] = useState("soja");
  const [cropVariety, setCropVariety] = useState("");
  const [cropHectares, setCropHectares] = useState("");
  const [cropPlantingDate, setCropPlantingDate] = useState("");
  const [cropExpectedHarvest, setCropExpectedHarvest] = useState("");
  const [cropActualHarvest, setCropActualHarvest] = useState("");
  const [cropYieldKg, setCropYieldKg] = useState("");
  const [cropStatus, setCropStatus] = useState("planted");
  const [cropSoilType, setCropSoilType] = useState("");
  const [cropIrrigationType, setCropIrrigationType] = useState("");
  const [cropNotes, setCropNotes] = useState("");

  // Application form state
  const [appType, setAppType] = useState("fertilizante");
  const [appProduct, setAppProduct] = useState("");
  const [appDose, setAppDose] = useState("");
  const [appTotal, setAppTotal] = useState("");
  const [appDate, setAppDate] = useState("");
  const [appAppliedBy, setAppAppliedBy] = useState("");
  const [appWeather, setAppWeather] = useState("");
  const [appNotes, setAppNotes] = useState("");

  function setFormBaseline(snapshot: AgricultureFormSnapshot) {
    formBaselineRef.current = agricultureFormSignature(snapshot);
  }

  function currentFormSignature() {
    return agricultureFormSignature({
      mode: sheetMode,
      editId,
      appCropId,
      cropSection,
      cropType,
      cropVariety,
      cropHectares,
      cropPlantingDate,
      cropExpectedHarvest,
      cropActualHarvest,
      cropYieldKg,
      cropStatus,
      cropSoilType,
      cropIrrigationType,
      cropNotes,
      appType,
      appProduct,
      appDose,
      appTotal,
      appDate,
      appAppliedBy,
      appWeather,
      appNotes,
    });
  }

  useUnsavedChangesWarning(sheetOpen && hasUnsavedChanges(formBaselineRef.current, currentFormSignature()));

  const loadCrops = useCallback(async () => {
    cropsRequestRef.current?.abort();
    if (readOnly) {
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
  }, [readOnly, userId]);

  useEffect(() => {
    void loadCrops();
    return () => cropsRequestRef.current?.abort();
  }, [loadCrops]);
  useDataChangedRefresh(loadCrops, !readOnly);
  useOfflineSnapshotRefresh(loadCrops, userId, readOnly);

  useEffect(() => {
    if (!loaded || handledNavigationQueryRef.current === navigationQuery) return;
    const params = new URLSearchParams(navigationQuery);
    const requestedSectionId = params.get("sectionId");
    const cropId = params.get("cropId");
    const applicationId = params.get("applicationId");
    setSectionFilterId(requestedSectionId || null);
    const crop = cropId
      ? crops.find((candidate) => candidate.id === cropId)
      : applicationId
        ? crops.find((candidate) => candidate.crop_applications?.some((application) => application.id === applicationId))
        : null;
    if (crop) {
      setFocusedCropId(crop.id);
      if (applicationId) setFocusedApplicationId(applicationId);
      window.requestAnimationFrame(() => {
        document.getElementById(applicationId ? `agriculture-application-${applicationId}` : `agriculture-crop-${crop.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    handledNavigationQueryRef.current = navigationQuery;
    if (navigationQuery) router.replace(window.location.pathname, { scroll: false });
  }, [crops, loaded, navigationQuery, router]);

  function resetCropForm() {
    setCropSection(""); setCropType("soja"); setCropVariety(""); setCropHectares("");
    setCropPlantingDate(""); setCropExpectedHarvest(""); setCropActualHarvest("");
    setCropYieldKg(""); setCropStatus("planted"); setCropSoilType("");
    setCropIrrigationType(""); setCropNotes(""); setEditId(null);
    formBaselineRef.current = null;
  }

  function resetAppForm() {
    setAppType("fertilizante"); setAppProduct(""); setAppDose(""); setAppTotal("");
    setAppDate(""); setAppAppliedBy(""); setAppWeather(""); setAppNotes("");
    setAppCropId(null);
    formBaselineRef.current = null;
  }

  function openAddCrop() {
    resetCropForm();
    setSheetMode("add-crop");
    setFormBaseline({
      mode: "add-crop", editId: null, appCropId: null,
      cropSection: "", cropType: "soja", cropVariety: "", cropHectares: "", cropPlantingDate: "", cropExpectedHarvest: "", cropActualHarvest: "", cropYieldKg: "", cropStatus: "planted", cropSoilType: "", cropIrrigationType: "", cropNotes: "",
      appType: "fertilizante", appProduct: "", appDose: "", appTotal: "", appDate: "", appAppliedBy: "", appWeather: "", appNotes: "",
    });
    setSheetOpen(true);
  }

  function openEditCrop(c: Crop) {
    setCropSection(c.section_id || ""); setCropType(c.crop_type);
    setCropVariety(c.variety || ""); setCropHectares(c.planted_hectares?.toString() || "");
    setCropPlantingDate(c.planting_date || ""); setCropExpectedHarvest(c.expected_harvest || "");
    setCropActualHarvest(c.actual_harvest || ""); setCropYieldKg(c.yield_kg?.toString() || "");
    setCropStatus(c.status); setCropSoilType(c.soil_type || "");
    setCropIrrigationType(c.irrigation_type || ""); setCropNotes(c.notes || "");
    setEditId(c.id); setSheetMode("edit-crop"); setSheetOpen(true);
    setFormBaseline({
      mode: "edit-crop", editId: c.id, appCropId: null,
      cropSection: c.section_id || "", cropType: c.crop_type, cropVariety: c.variety || "", cropHectares: c.planted_hectares?.toString() || "", cropPlantingDate: c.planting_date || "", cropExpectedHarvest: c.expected_harvest || "", cropActualHarvest: c.actual_harvest || "", cropYieldKg: c.yield_kg?.toString() || "", cropStatus: c.status, cropSoilType: c.soil_type || "", cropIrrigationType: c.irrigation_type || "", cropNotes: c.notes || "",
      appType: "fertilizante", appProduct: "", appDose: "", appTotal: "", appDate: "", appAppliedBy: "", appWeather: "", appNotes: "",
    });
  }

  function openAddApp(cropId: string) {
    resetAppForm();
    setAppCropId(cropId);
    setSheetMode("add-app");
    setFormBaseline({
      mode: "add-app", editId: null, appCropId: cropId,
      cropSection: "", cropType: "soja", cropVariety: "", cropHectares: "", cropPlantingDate: "", cropExpectedHarvest: "", cropActualHarvest: "", cropYieldKg: "", cropStatus: "planted", cropSoilType: "", cropIrrigationType: "", cropNotes: "",
      appType: "fertilizante", appProduct: "", appDose: "", appTotal: "", appDate: "", appAppliedBy: "", appWeather: "", appNotes: "",
    });
    setSheetOpen(true);
  }

  function discardFormChanges() {
    setDiscardDialogOpen(false);
    setSheetOpen(false);
    resetCropForm();
    resetAppForm();
    setSheetMode("add-crop");
  }

  function requestSheetClose() {
    if (saving) return;
    if (hasUnsavedChanges(formBaselineRef.current, currentFormSignature())) {
      setDiscardDialogOpen(true);
      return;
    }
    setSheetOpen(false);
    resetCropForm();
    resetAppForm();
    setSheetMode("add-crop");
  }

  function openCropCost(crop: Crop) {
    const params = new URLSearchParams({
      new: "1",
      type: "egreso",
      category: "otro",
      description: `Costo: ${crop.crop_type}`,
      cropId: crop.id,
    });
    if (crop.section_id) params.set("sectionId", crop.section_id);
    router.push(`/gestion/finanzas?${params.toString()}`);
  }

  async function saveCrop() {
    if (readOnly) return;
    setSaving(true);
    const payload = {
      sectionId: cropSection || null,
      cropType,
      variety: cropVariety || null,
      plantedHectares: cropHectares ? Number(cropHectares) : null,
      plantingDate: cropPlantingDate || null,
      expectedHarvest: cropExpectedHarvest || null,
      actualHarvest: cropActualHarvest || null,
      yieldKg: cropYieldKg ? Number(cropYieldKg) : null,
      status: cropStatus,
      soilType: cropSoilType || null,
      irrigationType: cropIrrigationType || null,
      notes: cropNotes || null,
    };
    const editing = sheetMode === "edit-crop" && editId;
    const creating = !editing;
    const signature = JSON.stringify(payload);
    if (creating && (!cropAttempt.current || cropAttempt.current.signature !== signature)) {
      cropAttempt.current = { key: createIdempotencyKey(), signature };
    }
    const result = editing
      ? await sendJsonResult("/api/crops", "PUT", { id: editId, ...payload })
      : await sendJsonResult("/api/crops", "POST", payload, { idempotencyKey: cropAttempt.current!.key });
    if (result.ok) {
      if (creating) cropAttempt.current = null;
      toast.success(editing ? "Cultivo actualizado" : "Cultivo creado");
      setSheetOpen(false);
      resetCropForm();
      await loadCrops();
    } else {
      toast.error(result.error || "No se pudo guardar el cultivo", result.code === "operational_idempotency_migration_required" ? {
        action: { label: "Abrir diagnóstico", onClick: () => router.push("/gestion/campo") },
      } : undefined);
    }
    setSaving(false);
  }

  async function deleteCrop(id: string) {
    if (readOnly) return;
    const result = await sendJsonResult("/api/crops", "DELETE", { id });
    if (result.ok) { toast.success("Cultivo eliminado"); await loadCrops(); }
    else toast.error(result.error || "No se pudo eliminar el cultivo");
  }

  async function saveApplication() {
    if (readOnly || !appCropId) return;
    setSaving(true);
    const appCrop = crops.find((crop) => crop.id === appCropId);
    const inventoryUsePath = inventoryUseHref({
      cropId: appCropId,
      sectionId: appCrop?.section_id,
      itemName: appProduct,
      date: appDate,
      notes: `Aplicación ${appType}${appProduct.trim() ? `: ${appProduct.trim()}` : ""}`,
    });
    const payload = {
      cropId: appCropId,
      type: appType,
      productName: appProduct || null,
      dosePerHectare: appDose || null,
      totalApplied: appTotal || null,
      dateApplied: appDate || null,
      appliedBy: appAppliedBy || null,
      weatherConditions: appWeather || null,
      notes: appNotes || null,
    };
    const signature = JSON.stringify(payload);
    if (!applicationAttempt.current || applicationAttempt.current.signature !== signature) {
      applicationAttempt.current = { key: createIdempotencyKey(), signature };
    }
    const result = await sendJsonResult("/api/crop-applications", "POST", payload, {
      idempotencyKey: applicationAttempt.current.key,
    });
    if (result.ok) {
      applicationAttempt.current = null;
      toast.success("Aplicacion registrada", {
        action: {
          label: "Descontar insumo",
          onClick: () => router.push(inventoryUsePath),
        },
      });
      setSheetOpen(false);
      resetAppForm();
      await loadCrops();
    } else {
      toast.error(result.error || "No se pudo registrar la aplicacion", result.code === "operational_idempotency_migration_required" ? {
        action: { label: "Abrir diagnóstico", onClick: () => router.push("/gestion/campo") },
      } : undefined);
    }
    setSaving(false);
  }

  const isEditing = sheetMode === "edit-crop";
  const isCropForm = sheetMode === "add-crop" || sheetMode === "edit-crop";
  const isAppForm = sheetMode === "add-app";

  // Stats
  const visibleCrops = sectionFilterId ? crops.filter((crop) => crop.section_id === sectionFilterId) : crops;
  const sectionFilterName = sections.find((section) => section.id === sectionFilterId)?.name;
  const totalHa = visibleCrops.reduce((sum, c) => sum + (c.planted_hectares || 0), 0);
  const activeCrops = visibleCrops.filter((c) => c.status === "planted" || c.status === "growing").length;
  const pendingHarvests = visibleCrops.filter((c) => c.expected_harvest && !c.actual_harvest && c.status !== "failed").length;

  if (!loaded) return <LoadingPage />;
  if (loadError) return <LoadErrorState title={readOnly ? "No hay una copia local de Agricultura" : "No se pudo cargar Agricultura"} description={readOnly ? "Sincronizá Agricultura cuando recuperes la conexión para consultarla sin conexión." : undefined} onRetry={loadCrops} />;

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[
          { label: "Produccion", href: "/produccion/hacienda" },
          { label: "Agricultura" },
        ]}
        title="Agricultura"
        description="Gestiona cultivos, siembras y aplicaciones"
        actions={
          <Button onClick={openAddCrop} disabled={readOnly}>
            <Plus className="h-4 w-4 mr-1.5" />Nuevo cultivo
          </Button>
        }
      />

      {offlineCropsSavedAt && <Alert role="status">
        <AlertDescription>Mostrando cultivos y aplicaciones de la copia sincronizada el {new Date(offlineCropsSavedAt).toLocaleString("es-UY")}. Las modificaciones se habilitarán al recuperar la conexión.</AlertDescription>
      </Alert>}

      <WeatherPanel />

      {cropsTruncated && (
        <Alert>
          <AlertDescription>
            Se muestran solo los 500 cultivos más recientes. Para consultar el registro completo, descargá Cultivos CSV: <a href="/api/export?format=csv&table=crops" className="font-medium text-primary underline-offset-2 hover:underline">Descargar Cultivos CSV</a>
          </AlertDescription>
        </Alert>
      )}

      {applicationsTruncated && (
        <Alert>
          <AlertDescription>
            Se muestran solo las 500 aplicaciones agrícolas más recientes de los cultivos visibles. Para consultar el historial completo, descargá <a href="/api/export?format=csv&table=crop_applications" className="font-medium text-primary underline-offset-2 hover:underline">Aplicaciones agrícolas CSV</a>.
          </AlertDescription>
        </Alert>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Ha sembradas" value={totalHa} accent="emerald" icon={MapPin} />
        <StatCard label="Cultivos activos" value={activeCrops} accent="blue" icon={Sprout} />
        <StatCard label="Cosechas pendientes" value={pendingHarvests} accent="amber" icon={BarChart3} />
        <StatCard label="Total cultivos" value={cropsTruncated ? `${crops.length}+` : crops.length} accent="purple" icon={Layers} />
      </div>

      {sectionFilterId && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm">
          <span>Mostrando cultivos de <strong>{sectionFilterName || "la sección seleccionada"}</strong>.</span>
          <Button variant="ghost" size="sm" onClick={() => setSectionFilterId(null)}>Ver todos</Button>
        </div>
      )}

      {/* Crop cards */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Cultivos</h2>
          <span className="text-xs text-muted-foreground">{visibleCrops.length}{sectionFilterId ? ` de ${crops.length}` : ""}{cropsTruncated ? "+ registros visibles" : " registros"}</span>
        </div>

        {visibleCrops.length === 0 ? (
          <EmptyState
            icon={Wheat}
            title={sectionFilterId ? "Sin cultivos en esta sección" : "Sin cultivos"}
            description={sectionFilterId ? "Probá con otra sección o volvé a ver todos los cultivos." : "Agrega tu primer cultivo para empezar."}
            actionLabel={sectionFilterId ? "Ver todos" : "Nuevo cultivo"}
            onAction={sectionFilterId ? () => setSectionFilterId(null) : openAddCrop}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {visibleCrops.map((c) => (
              <div id={`agriculture-crop-${c.id}`} key={c.id} className={`rounded-xl border bg-card p-5 space-y-3 ${focusedCropId === c.id ? "border-primary ring-2 ring-primary/20" : "border-border"}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">
                      {c.crop_type.charAt(0).toUpperCase() + c.crop_type.slice(1)}
                    </span>
                    {c.variety && <span className="text-muted-foreground text-xs">({c.variety})</span>}
                    <Badge variant="outline" className={STATUS_BADGE_CLASSES[c.status] || ""}>
                      {STATUS_LABELS[c.status] || c.status}
                    </Badge>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label="Acciones" className="h-8 w-8 shrink-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditCrop(c)}>
                        <Pencil className="mr-2 h-4 w-4" />Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openAddApp(c.id)}>
                        <Sprout className="mr-2 h-4 w-4" />Agregar aplicacion
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => router.push(`/gestion/inventario?use=1&cropId=${encodeURIComponent(c.id)}${c.section_id ? `&sectionId=${encodeURIComponent(c.section_id)}` : ""}`)}>
                        <Layers className="mr-2 h-4 w-4" />Registrar uso de insumo
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openCropCost(c)}>
                        <DollarSign className="mr-2 h-4 w-4" />Registrar gasto del cultivo
                      </DropdownMenuItem>
                      <ConfirmDialog
                        trigger={
                          <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                            <Trash2 className="mr-2 h-4 w-4" />Eliminar
                          </DropdownMenuItem>
                        }
                        title="Eliminar cultivo"
                        description={`Esto eliminara el cultivo "${c.crop_type}" y sus aplicaciones. Esta accion no se puede deshacer.`}
                        onConfirm={() => deleteCrop(c.id)}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.sections?.name && (
                    <Badge variant="secondary">{c.sections.name}</Badge>
                  )}
                  {c.planted_hectares && (
                    <Badge variant="outline">{c.planted_hectares} ha</Badge>
                  )}
                  {c.planting_date && (
                    <Badge variant="outline">Siembra: {c.planting_date}</Badge>
                  )}
                  {c.expected_harvest && (
                    <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/30">
                      Cosecha: {c.expected_harvest}
                    </Badge>
                  )}
                  {c.actual_harvest && (
                    <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                      Cosechado: {c.actual_harvest}
                    </Badge>
                  )}
                  {c.yield_kg != null && (
                    <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                      {c.yield_kg} kg
                    </Badge>
                  )}
                  {c.yield_per_hectare != null && (
                    <Badge variant="outline">{c.yield_per_hectare} kg/ha</Badge>
                  )}
                  {c.soil_type && (
                    <Badge variant="outline">Suelo: {c.soil_type}</Badge>
                  )}
                  {c.irrigation_type && (
                    <Badge variant="outline" className="text-blue-600 dark:text-blue-400 border-blue-500/30">
                      Riego: {c.irrigation_type}
                    </Badge>
                  )}
                  {c.crop_applications && c.crop_applications.length > 0 && (
                    <Badge variant="outline" className="text-purple-600 dark:text-purple-400 border-purple-500/30">
                      {c.crop_applications.length} aplicaciones
                    </Badge>
                  )}
                </div>
                {c.notes && <p className="text-xs text-muted-foreground">{c.notes}</p>}
                {c.crop_applications && c.crop_applications.length > 0 && (
                  <div className="space-y-2 border-t border-border pt-3">
                    <p className="text-xs font-medium text-muted-foreground">Últimas aplicaciones</p>
                    {c.crop_applications.filter((application, index) => index < 3 || application.id === focusedApplicationId).map((application) => (
                      <div
                        id={`agriculture-application-${application.id}`}
                        key={application.id}
                        className={`rounded-lg border px-3 py-2 text-xs ${focusedApplicationId === application.id ? "border-primary bg-accent ring-1 ring-primary/20" : "border-border"}`}
                      >
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium">{application.product_name || application.type}</span>
                          <Badge variant="outline" className="text-[10px]">{application.type}</Badge>
                          {application.date_applied && <span className="text-muted-foreground">{application.date_applied}</span>}
                        </div>
                        {(application.dose_per_hectare || application.total_applied || application.applied_by) && (
                          <p className="mt-1 text-muted-foreground">
                            {[application.dose_per_hectare && `Dosis: ${application.dose_per_hectare}`, application.total_applied && `Total: ${application.total_applied}`, application.applied_by && `Por: ${application.applied_by}`].filter(Boolean).join(" · ")}
                          </p>
                        )}
                      </div>
                    ))}
                    {c.crop_applications.length > 3 && <p className="text-[11px] text-muted-foreground">+ {c.crop_applications.length - 3} aplicaciones anteriores</p>}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sheet for forms */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { if (open) { setSheetOpen(true); return; } requestSheetClose(); }}>
        <SheetContent className="overflow-y-auto">
          {isCropForm && (
            <>
              <SheetHeader>
                <SheetTitle>{isEditing ? "Editar cultivo" : "Nuevo cultivo"}</SheetTitle>
                <SheetDescription>
                  {isEditing ? "Modifica los datos del cultivo." : "Agrega un nuevo cultivo a tu campo."}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="space-y-2">
                  <Label>Tipo de cultivo</Label>
                  <Select value={cropType} onValueChange={setCropType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CROP_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Variedad</Label>
                  <Input value={cropVariety} onChange={(e) => setCropVariety(e.target.value)} placeholder="Ej: DM 46i17" />
                </div>
                <div className="space-y-2">
                  <Label>Seccion</Label>
                  <Select value={cropSection} onValueChange={setCropSection}>
                    <SelectTrigger><SelectValue placeholder="Elegir seccion..." /></SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Hectareas</Label>
                  <Input type="number" value={cropHectares} onChange={(e) => setCropHectares(e.target.value)} placeholder="100" />
                </div>
                <div className="space-y-2">
                  <Label>Fecha de siembra</Label>
                  <Input type="date" value={cropPlantingDate} onChange={(e) => setCropPlantingDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Cosecha esperada</Label>
                  <Input type="date" value={cropExpectedHarvest} onChange={(e) => setCropExpectedHarvest(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Cosecha real</Label>
                  <Input type="date" value={cropActualHarvest} onChange={(e) => setCropActualHarvest(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Rendimiento (kg)</Label>
                  <Input type="number" value={cropYieldKg} onChange={(e) => setCropYieldKg(e.target.value)} placeholder="3500" />
                </div>
                <div className="space-y-2">
                  <Label>Estado</Label>
                  <Select value={cropStatus} onValueChange={setCropStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(STATUS_LABELS).map(([k, v]) => (
                        <SelectItem key={k} value={k}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Tipo de suelo</Label>
                  <Select value={cropSoilType} onValueChange={setCropSoilType}>
                    <SelectTrigger><SelectValue placeholder="Elegir..." /></SelectTrigger>
                    <SelectContent>
                      {SOIL_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Riego</Label>
                  <Select value={cropIrrigationType} onValueChange={setCropIrrigationType}>
                    <SelectTrigger><SelectValue placeholder="Elegir..." /></SelectTrigger>
                    <SelectContent>
                      {IRRIGATION_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Notas</Label>
                  <Input value={cropNotes} onChange={(e) => setCropNotes(e.target.value)} placeholder="Observaciones..." />
                </div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={requestSheetClose} disabled={saving}>Cancelar</Button>
                <Button onClick={saveCrop} disabled={readOnly || saving}>
                  {saving ? "Guardando..." : isEditing ? "Guardar cambios" : "Crear cultivo"}
                </Button>
              </SheetFooter>
            </>
          )}
          {isAppForm && (
            <>
              <SheetHeader>
                <SheetTitle>Nueva aplicacion</SheetTitle>
                <SheetDescription>Registra una aplicacion de producto al cultivo.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={appType} onValueChange={setAppType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {APP_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Producto</Label>
                  <Input value={appProduct} onChange={(e) => setAppProduct(e.target.value)} placeholder="Ej: Glifosato" />
                </div>
                <div className="space-y-2">
                  <Label>Dosis por hectarea</Label>
                  <Input value={appDose} onChange={(e) => setAppDose(e.target.value)} placeholder="2 L/ha" />
                </div>
                <div className="space-y-2">
                  <Label>Total aplicado</Label>
                  <Input value={appTotal} onChange={(e) => setAppTotal(e.target.value)} placeholder="200 L" />
                </div>
                <div className="space-y-2">
                  <Label>Fecha</Label>
                  <Input type="date" value={appDate} onChange={(e) => setAppDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Aplicado por</Label>
                  <Input value={appAppliedBy} onChange={(e) => setAppAppliedBy(e.target.value)} placeholder="Nombre" />
                </div>
                <div className="space-y-2">
                  <Label>Clima</Label>
                  <Select value={appWeather} onValueChange={setAppWeather}>
                    <SelectTrigger><SelectValue placeholder="Elegir..." /></SelectTrigger>
                    <SelectContent>
                      {WEATHER_OPTIONS.map((w) => (
                        <SelectItem key={w} value={w}>{w.charAt(0).toUpperCase() + w.slice(1)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Notas</Label>
                  <Input value={appNotes} onChange={(e) => setAppNotes(e.target.value)} placeholder="Observaciones..." />
                </div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={requestSheetClose} disabled={saving}>Cancelar</Button>
                <Button onClick={saveApplication} disabled={readOnly || saving}>
                  {saving ? "Guardando..." : "Registrar aplicacion"}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
      <UnsavedChangesDialog
        open={discardDialogOpen}
        onOpenChange={setDiscardDialogOpen}
        onDiscard={discardFormChanges}
      />
    </div>
  );
}

export default function AgriculturaPage() {
  return <Suspense fallback={<LoadingPage />}><AgriculturaPageContent /></Suspense>;
}
