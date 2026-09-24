"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { StatStrip } from "@/components/StatCard";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { WeatherPanel } from "@/components/WeatherPanel";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { Button } from "@/components/ui/button";
import { Notice, noticeLinkClass } from "@/components/produccion/Notice";
import { CropList } from "@/components/produccion/agricultura/CropList";
import { AgriculturaFormSheet } from "@/components/produccion/agricultura/AgriculturaFormSheet";
import { useCropsData } from "@/components/produccion/agricultura/useCropsData";
import type { Crop } from "@/components/produccion/agricultura/types";
import { toast } from "sonner";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { dateInputValue } from "@/lib/date";
import { inventoryUseHref } from "@/lib/inventory-navigation";
import {
  EMPTY_APPLICATION_FORM, EMPTY_CROP_FORM, agricultureFormSignature, cropFormFrom,
  type AgricultureFormSnapshot, type AgricultureSheetMode, type ApplicationFormValues, type CropFormValues,
} from "@/lib/agricultura-form";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";
import { useUnsavedChangesWarning } from "@/lib/use-unsaved-changes-warning";
import { useOfflineAwareNavigation, useOfflineAwareReplace } from "@/lib/use-offline-aware-navigation";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";
import { CampoAIButton } from "@/components/CampoAIButton";
import { parseLocalizedNumber } from "@/lib/number";
import { Plus } from "lucide-react";

function AgriculturaPageContent() {
  const { sections, userId, readOnly, offlineMode, isOnline } = useFarm();
  const offlineReadOnly = offlineMode || !isOnline;
  const navigate = useOfflineAwareNavigation();
  const replace = useOfflineAwareReplace();
  const searchParams = useSearchParams();
  const navigationQuery = searchParams.toString();
  const { crops, loaded, loadError, cropsTruncated, applicationsTruncated, offlineCropsSavedAt, loadCrops } = useCropsData(offlineReadOnly, userId);
  const [saving, setSaving] = useState(false);
  const cropAttempt = useRef<{ key: string; signature: string } | null>(null);
  const applicationAttempt = useRef<{ key: string; signature: string } | null>(null);
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

  const [cropForm, setCropForm] = useState<CropFormValues>(EMPTY_CROP_FORM);
  const [appForm, setAppForm] = useState<ApplicationFormValues>(EMPTY_APPLICATION_FORM);
  const patchCropForm = useCallback((patch: Partial<CropFormValues>) => setCropForm((form) => ({ ...form, ...patch })), []);
  const patchAppForm = useCallback((patch: Partial<ApplicationFormValues>) => setAppForm((form) => ({ ...form, ...patch })), []);

  function setFormBaseline(snapshot: AgricultureFormSnapshot) {
    formBaselineRef.current = agricultureFormSignature(snapshot);
  }

  function currentFormSignature() {
    return agricultureFormSignature({ mode: sheetMode, editId, appCropId, crop: cropForm, application: appForm });
  }

  useUnsavedChangesWarning(sheetOpen && hasUnsavedChanges(formBaselineRef.current, currentFormSignature()));

  useEffect(() => {
    if (!loaded || handledNavigationQueryRef.current === navigationQuery) return;
    const params = new URLSearchParams(navigationQuery);
    const requestedSectionId = params.get("sectionId");
    const cropId = params.get("cropId");
    const applicationId = params.get("applicationId");
    const crop = cropId
      ? crops.find((candidate) => candidate.id === cropId)
      : applicationId
        ? crops.find((candidate) => candidate.crop_applications?.some((application) => application.id === applicationId))
        : null;
    const applicationExists = applicationId
      ? Boolean(crop?.crop_applications?.some((application) => application.id === applicationId))
      : true;
    if ((cropId && !crop) || !applicationExists) return;
    setSectionFilterId(requestedSectionId || null);
    if (crop) {
      setFocusedCropId(crop.id);
      if (applicationId) setFocusedApplicationId(applicationId);
      window.requestAnimationFrame(() => {
        document.getElementById(applicationId ? `agriculture-application-${applicationId}` : `agriculture-crop-${crop.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    handledNavigationQueryRef.current = navigationQuery;
    if (navigationQuery) replace(window.location.pathname, { scroll: false });
  }, [crops, loaded, navigationQuery, replace]);

  function resetCropForm() {
    setCropForm(EMPTY_CROP_FORM);
    setEditId(null);
    formBaselineRef.current = null;
  }

  function resetAppForm() {
    setAppForm(EMPTY_APPLICATION_FORM);
    setAppCropId(null);
    formBaselineRef.current = null;
  }

  function openAddCrop() {
    resetCropForm();
    setSheetMode("add-crop");
    setFormBaseline({ mode: "add-crop", editId: null, appCropId: null, crop: EMPTY_CROP_FORM, application: EMPTY_APPLICATION_FORM });
    setSheetOpen(true);
  }

  function openEditCrop(c: Crop) {
    const form = cropFormFrom(c);
    setCropForm(form);
    setEditId(c.id); setSheetMode("edit-crop"); setSheetOpen(true);
    setFormBaseline({ mode: "edit-crop", editId: c.id, appCropId: null, crop: form, application: EMPTY_APPLICATION_FORM });
  }

  function openAddApp(cropId: string) {
    resetAppForm();
    setAppCropId(cropId);
    setSheetMode("add-app");
    setFormBaseline({ mode: "add-app", editId: null, appCropId: cropId, crop: EMPTY_CROP_FORM, application: EMPTY_APPLICATION_FORM });
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
    navigate(`/gestion/finanzas?${params.toString()}`);
  }

  async function saveCrop() {
    if (readOnly) return;
    setSaving(true);
    try {
      const f = cropForm;
      const payload = {
        sectionId: f.section || null,
        cropType: f.type,
        variety: f.variety || null,
        plantedHectares: f.hectares ? parseLocalizedNumber(f.hectares) : null,
        plantingDate: f.plantingDate || null,
        expectedHarvest: f.expectedHarvest || null,
        actualHarvest: f.actualHarvest || null,
        yieldKg: f.yieldKg ? parseLocalizedNumber(f.yieldKg) : null,
        status: f.status,
        soilType: f.soilType || null,
        irrigationType: f.irrigationType || null,
        notes: f.notes || null,
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
        toast.error(result.error || "No se pudo guardar el cultivo. Revisá los datos e intentá de nuevo.", result.code === "operational_idempotency_migration_required" ? {
          action: { label: "Abrir diagnóstico", onClick: () => navigate("/gestion/campo") },
        } : undefined);
      }
    } catch {
      toast.error("No se pudo guardar el cultivo. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteCrop(id: string) {
    if (readOnly) return;
    const result = await sendJsonResult("/api/crops", "DELETE", { id });
    if (result.ok) { toast.success("Cultivo eliminado"); await loadCrops(); }
    else toast.error(result.error || "No se pudo eliminar el cultivo. Intentá de nuevo.");
  }

  async function saveApplication() {
    if (readOnly || !appCropId) return;
    setSaving(true);
    try {
      const f = appForm;
      const appCrop = crops.find((crop) => crop.id === appCropId);
      const inventoryUsePath = inventoryUseHref({
        cropId: appCropId,
        sectionId: appCrop?.section_id,
        itemName: f.product,
        date: f.date,
        notes: `Aplicación ${f.type}${f.product.trim() ? `: ${f.product.trim()}` : ""}`,
      });
      const payload = {
        cropId: appCropId,
        type: f.type,
        productName: f.product || null,
        dosePerHectare: f.dose || null,
        totalApplied: f.total || null,
        dateApplied: f.date || null,
        appliedBy: f.appliedBy || null,
        weatherConditions: f.weather || null,
        notes: f.notes || null,
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
        toast.success("Aplicación registrada", {
          action: {
            label: "Descontar insumo",
            onClick: () => navigate(inventoryUsePath),
          },
        });
        setSheetOpen(false);
        resetAppForm();
        await loadCrops();
      } else {
        toast.error(result.error || "No se pudo registrar la aplicación. Revisá los datos e intentá de nuevo.", result.code === "operational_idempotency_migration_required" ? {
          action: { label: "Abrir diagnóstico", onClick: () => navigate("/gestion/campo") },
        } : undefined);
      }
    } catch {
      toast.error("No se pudo registrar la aplicación. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  // Stats
  const visibleCrops = sectionFilterId ? crops.filter((crop) => crop.section_id === sectionFilterId) : crops;
  const sectionFilterName = sections.find((section) => section.id === sectionFilterId)?.name;
  const totalHa = visibleCrops.reduce((sum, c) => sum + (c.planted_hectares || 0), 0);
  const activeCrops = visibleCrops.filter((c) => c.status === "planted" || c.status === "growing").length;
  const pendingHarvests = visibleCrops.filter((c) => c.expected_harvest && !c.actual_harvest && c.status !== "failed").length;
  const agricultureAIFacts = [
    `Filtro de sección: ${sectionFilterName || "todas"}`,
    `Hectáreas sembradas: ${totalHa.toFixed(1)}`,
    `Cultivos activos: ${activeCrops}`,
    `Cosechas pendientes: ${pendingHarvests}`,
    `Cultivos visibles: ${visibleCrops.length}${cropsTruncated ? "+" : ""}`,
    ...visibleCrops.slice(0, 30).map((crop) => `${crop.crop_type}${crop.variety ? ` ${crop.variety}` : ""}: ${crop.planted_hectares || 0} ha, estado ${crop.status}${crop.yield_kg ? `, rinde ${crop.yield_kg} kg/ha` : ""}, aplicaciones ${crop.crop_applications?.length || 0}`),
  ];

  if (!loaded) return <LoadingPage />;
  if (loadError) return <LoadErrorState title={offlineReadOnly ? "No hay una copia local de Agricultura" : "No se pudo cargar Agricultura"} description={offlineReadOnly ? "Sincronizá Agricultura cuando recuperes la conexión para consultarla sin conexión." : undefined} onRetry={offlineReadOnly ? undefined : loadCrops} />;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Agricultura"
        description="Cultivos, siembras, aplicaciones y cosechas."
        actions={
          <>
            <CampoAIButton title="Agricultura" facts={agricultureAIFacts} partial={cropsTruncated || applicationsTruncated} instruction="Ayudame a priorizar labores agrícolas y, cuando corresponda, relacioná la decisión con el clima actual sin reemplazar una recomendación técnica profesional." />
            <Button onClick={openAddCrop} disabled={readOnly}><Plus className="h-4 w-4" aria-hidden="true" />Nuevo cultivo</Button>
          </>
        }
      />

      {(offlineCropsSavedAt || cropsTruncated || applicationsTruncated) && (
        <div className="space-y-2">
          {offlineCropsSavedAt && (
            <Notice tone="offline">
              Mostrando cultivos y aplicaciones de la copia sincronizada el {new Date(offlineCropsSavedAt).toLocaleString("es-UY")}. Vas a poder modificarlos cuando recuperes la conexión.
            </Notice>
          )}
          {cropsTruncated && (
            <Notice tone="warn">
              Se muestran solo los 500 cultivos más recientes. Para ver el registro completo, <AuthenticatedDownloadLink href="/api/export?format=csv&table=crops" filename="campoai-cultivos.csv" className={noticeLinkClass}>descargá los cultivos en CSV</AuthenticatedDownloadLink>.
            </Notice>
          )}
          {applicationsTruncated && (
            <Notice tone="warn">
              Se muestran solo las 500 aplicaciones agrícolas más recientes de los cultivos visibles. Para ver el historial completo, <AuthenticatedDownloadLink href="/api/export?format=csv&table=crop_applications" filename="campoai-aplicaciones-agricolas.csv" className={noticeLinkClass}>descargá las aplicaciones en CSV</AuthenticatedDownloadLink>.
            </Notice>
          )}
        </div>
      )}

      <StatStrip
        items={[
          { label: "Hectáreas sembradas", value: totalHa.toLocaleString("es-UY", { maximumFractionDigits: 1 }), unit: "ha" },
          { label: "Cultivos activos", value: activeCrops },
          { label: "Cosechas pendientes", value: pendingHarvests },
          { label: "Total de cultivos", value: cropsTruncated ? `${crops.length}+` : crops.length },
        ]}
      />

      <WeatherPanel />

      {sectionFilterId && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm">
          <span>Mostrando cultivos de <strong className="font-semibold">{sectionFilterName || "la sección elegida"}</strong>.</span>
          <Button variant="ghost" size="sm" onClick={() => setSectionFilterId(null)}>Ver todos</Button>
        </div>
      )}

      <CropList
        crops={visibleCrops}
        totalCount={crops.length}
        truncated={cropsTruncated}
        filtered={Boolean(sectionFilterId)}
        today={dateInputValue()}
        focusedCropId={focusedCropId}
        focusedApplicationId={focusedApplicationId}
        onAdd={openAddCrop}
        onClearFilter={() => setSectionFilterId(null)}
        onEdit={openEditCrop}
        onAddApplication={openAddApp}
        onInventory={(c) => navigate(`/gestion/inventario?use=1&cropId=${encodeURIComponent(c.id)}${c.section_id ? `&sectionId=${encodeURIComponent(c.section_id)}` : ""}`)}
        onCost={openCropCost}
        onDelete={deleteCrop}
      />

      <AgriculturaFormSheet
        open={sheetOpen}
        onOpenChange={(open) => { if (open) { setSheetOpen(true); return; } requestSheetClose(); }}
        mode={sheetMode}
        sections={sections}
        crop={cropForm}
        onCropChange={patchCropForm}
        application={appForm}
        onApplicationChange={patchAppForm}
        saving={saving}
        readOnly={readOnly}
        onCancel={requestSheetClose}
        onSaveCrop={saveCrop}
        onSaveApplication={saveApplication}
      />
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
