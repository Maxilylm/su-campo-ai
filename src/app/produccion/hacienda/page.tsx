"use client";

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { StatStrip } from "@/components/StatCard";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { CattleImportDialog } from "@/components/CattleImportDialog";
import { Notice, noticeLinkClass } from "@/components/produccion/Notice";
import { SectionList } from "@/components/produccion/hacienda/SectionList";
import { CattleTable } from "@/components/produccion/hacienda/CattleTable";
import { HaciendaFormSheet } from "@/components/produccion/hacienda/HaciendaFormSheet";
import { UNASSIGNED_SECTION_COLOR, type Cattle, type SectionWithCattle } from "@/components/produccion/hacienda/types";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { fetchWithTimeout } from "@/lib/fetch";
import { filterCattleRows, pageForRowId } from "@/lib/cattle-navigation";
import {
  EMPTY_CATTLE_FORM, EMPTY_SECTION_FORM, cattleFormFrom, haciendaFormSignature, sectionFormFrom,
  type CattleFormValues, type HaciendaFormSnapshot, type HaciendaSheetMode, type SectionFormValues,
} from "@/lib/hacienda-form";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";
import { useUnsavedChangesWarning } from "@/lib/use-unsaved-changes-warning";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { useOfflineAwareNavigation, useOfflineAwareReplace } from "@/lib/use-offline-aware-navigation";
import { isOfflineSnapshotFresh, offlineEntitySnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";
import { CampoAIButton } from "@/components/CampoAIButton";
import { parseLocalizedNumber } from "@/lib/number";
import { Plus } from "lucide-react";

const ROWS_PER_PAGE = 20;

function HaciendaPageContent() {
  const { refreshSections, sectionsTruncated, userId, readOnly, offlineMode, isOnline } = useFarm();
  const offlineReadOnly = offlineMode || !isOnline;
  const navigate = useOfflineAwareNavigation();
  const replace = useOfflineAwareReplace();
  const searchParams = useSearchParams();
  const navigationQuery = searchParams.toString();
  const [sections, setSections] = useState<SectionWithCattle[]>([]);
  const [unassignedCattle, setUnassignedCattle] = useState<Cattle[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const handledNavigationQueryRef = useRef<string | null>(null);
  const [focusedSectionId, setFocusedSectionId] = useState<string | null>(null);
  const [focusedCattleId, setFocusedCattleId] = useState<string | null>(null);
  const [cattleQuery, setCattleQuery] = useState("");
  const [cattleTruncated, setCattleTruncated] = useState(false);
  const [offlineLivestockSavedAt, setOfflineLivestockSavedAt] = useState<string | null>(null);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<HaciendaSheetMode>("add-section");
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const sectionAttempt = useRef<{ key: string; signature: string } | null>(null);
  const cattleAttempt = useRef<{ key: string; signature: string } | null>(null);
  const formBaselineRef = useRef<string | null>(null);
  const livestockRequestRef = useRef<AbortController | null>(null);

  const [sectionForm, setSectionForm] = useState<SectionFormValues>(EMPTY_SECTION_FORM);
  const [cattleForm, setCattleForm] = useState<CattleFormValues>(EMPTY_CATTLE_FORM);
  const patchSectionForm = useCallback((patch: Partial<SectionFormValues>) => setSectionForm((form) => ({ ...form, ...patch })), []);
  const patchCattleForm = useCallback((patch: Partial<CattleFormValues>) => setCattleForm((form) => ({ ...form, ...patch })), []);

  function setFormBaseline(snapshot: HaciendaFormSnapshot) {
    formBaselineRef.current = haciendaFormSignature(snapshot);
  }

  function currentFormSignature() {
    return haciendaFormSignature({ mode: sheetMode, editId, section: sectionForm, cattle: cattleForm });
  }

  useUnsavedChangesWarning(sheetOpen && hasUnsavedChanges(formBaselineRef.current, currentFormSignature()));

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);

  const loadSectionsWithCattle = useCallback(async () => {
    livestockRequestRef.current?.abort();
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
        setSections(snapshot.sections as SectionWithCattle[]);
        setUnassignedCattle((snapshot.cattle as Cattle[]).filter((cattle) => !cattle.section_id));
        setCattleTruncated(snapshot.cattleTruncated === true);
        setOfflineLivestockSavedAt(snapshot.savedAt);
        setLoadError(false);
      } else {
        setSections([]);
        setUnassignedCattle([]);
        setOfflineLivestockSavedAt(null);
        setLoadError(true);
      }
      setLoaded(true);
      return;
    }
    const controller = new AbortController();
    livestockRequestRef.current = controller;
    setOfflineLivestockSavedAt(null);
    setLoadError(false);
    try {
      const [sectionsRes, cattleRes] = await Promise.all([
        fetchWithTimeout("/api/sections", { cache: "no-store", signal: controller.signal }, 8000),
        fetchWithTimeout("/api/cattle?unassigned=true", { cache: "no-store", signal: controller.signal }, 8000),
      ]);
      if (!sectionsRes.ok || !cattleRes.ok) throw new Error("livestock request failed");
      const [nextSections, allCattle] = await Promise.all([sectionsRes.json(), cattleRes.json()]);
      if (controller.signal.aborted || livestockRequestRef.current !== controller) return;
      setSections(Array.isArray(nextSections) ? nextSections : []);
      setUnassignedCattle(Array.isArray(allCattle) ? allCattle.filter((cattle: Cattle) => !cattle.section_id) : []);
      setCattleTruncated(
        sectionsRes.headers.get("X-CampoAI-Cattle-Truncated") === "true"
        || cattleRes.headers.get("X-CampoAI-Cattle-Truncated") === "true",
      );
    } catch (error) {
      if (!controller.signal.aborted && livestockRequestRef.current === controller) {
        console.error("Load sections error:", error);
        setLoadError(true);
      }
    } finally {
      if (livestockRequestRef.current === controller) {
        livestockRequestRef.current = null;
        setLoaded(true);
      }
    }
  }, [offlineReadOnly, userId]);

  useEffect(() => {
    void loadSectionsWithCattle();
    return () => livestockRequestRef.current?.abort();
  }, [loadSectionsWithCattle]);
  useDataChangedRefresh(loadSectionsWithCattle, !offlineReadOnly);
  useOfflineSnapshotRefresh(loadSectionsWithCattle, userId, offlineReadOnly);

  const allCattle = useMemo(() => [
    ...sections.flatMap((s) => s.cattle.map((c) => ({ ...c, sectionName: s.name, sectionColor: s.color }))),
    ...unassignedCattle.map((c) => ({ ...c, sectionName: "Sin potrero", sectionColor: UNASSIGNED_SECTION_COLOR })),
  ], [sections, unassignedCattle]);

  useEffect(() => {
    if (!loaded || handledNavigationQueryRef.current === navigationQuery || (allCattle.length === 0 && sections.length === 0)) return;
    const params = new URLSearchParams(navigationQuery);
    const requestedSectionId = params.get("sectionId");
    const requestedCattleId = params.get("cattleId");
    const requestedCattle = requestedCattleId ? allCattle.find((cattle) => cattle.id === requestedCattleId) : null;
    const requestedSectionExists = requestedSectionId ? sections.some((section) => section.id === requestedSectionId) : false;
    if ((requestedSectionId && !requestedSectionExists) || (requestedCattleId && !requestedCattle)) return;
    const target = requestedSectionId && requestedSectionExists
      ? requestedSectionId
      : requestedCattle
        ? requestedCattle.section_id
        : null;

    if (target) {
      setExpandedSections((current) => new Set(current).add(target));
      if (!requestedCattle) {
        setFocusedSectionId(target);
        window.requestAnimationFrame(() => {
          document.getElementById(`hacienda-section-${target}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    }
    if (requestedCattle) {
      setCurrentPage(pageForRowId(allCattle, requestedCattle.id, ROWS_PER_PAGE));
      setFocusedCattleId(requestedCattle.id);
    }
    handledNavigationQueryRef.current = navigationQuery;
    if (navigationQuery) replace(window.location.pathname, { scroll: false });
  }, [allCattle, loaded, navigationQuery, replace, sections]);

  useEffect(() => {
    if (!focusedCattleId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`hacienda-cattle-${focusedCattleId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => setFocusedCattleId(null), 4000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [currentPage, focusedCattleId]);

  async function onRefresh() {
    await loadSectionsWithCattle();
    try {
      await refreshSections();
    } catch (error) {
      // The main Hacienda list has already refreshed above. The shared
      // navigation copy is best effort and must not leave a successful save
      // stuck in the loading state when its separate request times out.
      console.error("Refresh shared sections error:", error);
    }
  }

  function resetSectionForm() {
    sectionAttempt.current = null;
    setSectionForm(EMPTY_SECTION_FORM);
    setEditId(null);
    formBaselineRef.current = null;
  }

  function resetCattleForm() {
    cattleAttempt.current = null;
    setCattleForm(EMPTY_CATTLE_FORM);
    setEditId(null);
    formBaselineRef.current = null;
  }

  function openAddSection() {
    resetSectionForm();
    setSheetMode("add-section");
    setFormBaseline({ mode: "add-section", editId: null, section: EMPTY_SECTION_FORM, cattle: EMPTY_CATTLE_FORM });
    setSheetOpen(true);
  }
  function openEditSection(s: SectionWithCattle) {
    const form = sectionFormFrom(s);
    setSectionForm(form);
    setEditId(s.id); setSheetMode("edit-section"); setSheetOpen(true);
    setFormBaseline({ mode: "edit-section", editId: s.id, section: form, cattle: EMPTY_CATTLE_FORM });
  }
  function openAddCattle() {
    resetCattleForm();
    setSheetMode("add-cattle");
    setFormBaseline({ mode: "add-cattle", editId: null, section: EMPTY_SECTION_FORM, cattle: EMPTY_CATTLE_FORM });
    setSheetOpen(true);
  }
  function openEditCattle(c: Cattle) {
    const form = cattleFormFrom(c);
    setCattleForm(form);
    setEditId(c.id); setSheetMode("edit-cattle"); setSheetOpen(true);
    setFormBaseline({ mode: "edit-cattle", editId: c.id, section: EMPTY_SECTION_FORM, cattle: form });
  }

  function discardFormChanges() {
    setDiscardDialogOpen(false);
    setSheetOpen(false);
    resetSectionForm();
    resetCattleForm();
    setSheetMode("add-section");
  }

  function requestSheetClose() {
    if (saving) return;
    if (hasUnsavedChanges(formBaselineRef.current, currentFormSignature())) {
      setDiscardDialogOpen(true);
      return;
    }
    setSheetOpen(false);
    resetSectionForm();
    resetCattleForm();
    setSheetMode("add-section");
  }

  function openCattleCost(c: Cattle) {
    const params = new URLSearchParams({
      new: "1",
      type: "egreso",
      category: "otro",
      description: `Costo: ${c.category}${c.breed ? ` ${c.breed}` : ""}`,
      cattleId: c.id,
    });
    if (c.section_id) params.set("sectionId", c.section_id);
    navigate(`/gestion/finanzas?${params.toString()}`);
  }

  async function saveSection() {
    if (readOnly || !sectionForm.name.trim()) return;
    setSaving(true);
    try {
      const f = sectionForm;
      const payload = { name: f.name, sizeHectares: f.hectares ? parseLocalizedNumber(f.hectares) : null, capacity: f.capacity ? parseLocalizedNumber(f.capacity) : null, color: f.color, waterStatus: f.water, pastureStatus: f.pasture, notes: f.notes || null };
      const editing = sheetMode === "edit-section" && editId;
      const signature = JSON.stringify(payload);
      if (!editing && (!sectionAttempt.current || sectionAttempt.current.signature !== signature)) {
        sectionAttempt.current = { key: createIdempotencyKey(), signature };
      }
      const result = editing
        ? await sendJsonResult("/api/sections", "PUT", { id: editId, ...payload })
        : await sendJsonResult("/api/sections", "POST", payload, { idempotencyKey: sectionAttempt.current?.key });
      if (result.ok) {
        if (!editing) sectionAttempt.current = null;
        toast.success(editing ? "Potrero actualizado" : "Potrero creado");
        setSheetOpen(false);
        resetSectionForm();
        await onRefresh();
      } else {
        toast.error(result.error || "No se pudo guardar el potrero. Revisá los datos e intentá de nuevo.");
      }
    } catch {
      toast.error("No se pudo guardar el potrero. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function saveCattle() {
    if (readOnly) return;
    setSaving(true);
    try {
      const f = cattleForm;
      const payload = { sectionId: f.section || null, category: f.category, breed: f.breed || null, count: f.count ? parseLocalizedNumber(f.count) : 1, weightKg: f.weight ? parseLocalizedNumber(f.weight) : null, earTag: f.earTag || null, origin: f.origin, vaccinationStatus: f.vaccinationStatus, reproductiveStatus: f.reproductive || null, healthStatus: f.health, notes: f.notes || null };
      const editing = sheetMode === "edit-cattle" && editId;
      const signature = JSON.stringify(payload);
      if (!editing && (!cattleAttempt.current || cattleAttempt.current.signature !== signature)) {
        cattleAttempt.current = { key: createIdempotencyKey(), signature };
      }
      const result = editing
        ? await sendJsonResult("/api/cattle", "PUT", { id: editId, ...payload })
        : await sendJsonResult("/api/cattle", "POST", payload, { idempotencyKey: cattleAttempt.current?.key });
      if (result.ok) {
        if (!editing) cattleAttempt.current = null;
        toast.success(editing ? "Hacienda actualizada" : "Hacienda registrada");
        setSheetOpen(false);
        resetCattleForm();
        await onRefresh();
      } else {
        toast.error(result.error || "No se pudo guardar la hacienda. Revisá los datos e intentá de nuevo.");
      }
    } catch {
      toast.error("No se pudo guardar la hacienda. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSection(id: string) {
    if (readOnly) return;
    const result = await sendJsonResult("/api/sections", "DELETE", { id });
    if (result.ok) { toast.success("Potrero eliminado"); await onRefresh(); }
    else toast.error(result.error || "No se pudo eliminar el potrero. Intentá de nuevo.");
  }

  async function deleteCattle(id: string) {
    if (readOnly) return;
    const result = await sendJsonResult("/api/cattle", "DELETE", { id });
    if (result.ok) { toast.success("Hacienda eliminada"); await onRefresh(); }
    else toast.error(result.error || "No se pudo eliminar la hacienda. Intentá de nuevo.");
  }

  function toggleSection(id: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const filteredCattle = filterCattleRows(allCattle, cattleQuery);
  const totalPages = Math.max(1, Math.ceil(filteredCattle.length / ROWS_PER_PAGE));
  const paginatedCattle = filteredCattle.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);
  const totalHeads = allCattle.reduce((sum, cattle) => sum + cattle.count, 0);
  const unassignedHeads = unassignedCattle.reduce((sum, cattle) => sum + cattle.count, 0);
  const overdueVaccinationLots = allCattle.filter((cattle) => cattle.vaccination_status === "vencida").length;
  const healthAlertLots = allCattle.filter((cattle) => cattle.health_status !== "healthy").length;
  const haciendaAIFacts = [
    `Secciones: ${sections.length}${sectionsTruncated ? "+" : ""}`,
    `Lotes: ${allCattle.length}${cattleTruncated ? "+" : ""}`,
    `Cabezas: ${totalHeads}`,
    `Sin sección: ${unassignedHeads}`,
    `Vacunación vencida: ${overdueVaccinationLots} lotes`,
    `Salud con alerta: ${healthAlertLots} lotes`,
    ...filteredCattle.slice(0, 30).map((cattle) => `${cattle.category}${cattle.breed ? ` ${cattle.breed}` : ""}: ${cattle.count} cabezas en ${cattle.sectionName}${cattle.weight_kg ? `, ${cattle.weight_kg} kg` : ""}`),
  ];

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  if (!loaded) return <LoadingPage />;
  if (loadError) return <LoadErrorState title={offlineReadOnly ? "No hay una copia local de Hacienda" : "No se pudo cargar Hacienda"} description={offlineReadOnly ? "Sincronizá Hacienda cuando recuperes la conexión para consultarla sin conexión." : undefined} onRetry={offlineReadOnly ? undefined : loadSectionsWithCattle} />;

  const partial = cattleTruncated ? "+" : "";

  return (
    <div className="space-y-8">
      <PageHeader
        title="Hacienda"
        description="Potreros y lotes de hacienda del campo."
        actions={
          <>
            <CampoAIButton
              title="Hacienda"
              facts={haciendaAIFacts}
              partial={cattleTruncated || sectionsTruncated}
              instruction="Ayudame a detectar prioridades de manejo, sanidad, ubicación de lotes y seguimiento de peso sin inventar movimientos ni reemplazar criterio veterinario."
              disabled={allCattle.length === 0 && sections.length === 0}
            />
            <CattleImportDialog sections={sections.map((section) => ({ id: section.id, name: section.name }))} readOnly={readOnly} onImported={onRefresh} />
            <Button variant="outline" onClick={openAddSection} disabled={readOnly}><Plus className="h-4 w-4" aria-hidden="true" />Potrero</Button>
            <Button onClick={openAddCattle} disabled={readOnly}><Plus className="h-4 w-4" aria-hidden="true" />Hacienda</Button>
          </>
        }
      />

      {(offlineLivestockSavedAt || cattleTruncated || sectionsTruncated) && (
        <div className="space-y-2">
          {offlineLivestockSavedAt && (
            <Notice tone="offline">
              Mostrando potreros y hacienda de la copia sincronizada el {new Date(offlineLivestockSavedAt).toLocaleString("es-UY")}. Vas a poder modificarlas cuando recuperes la conexión.
            </Notice>
          )}
          {cattleTruncated && (
            <Notice tone="warn">
              La lista muestra solo una parte de la hacienda para cargar rápido. Para ver el conjunto completo, <AuthenticatedDownloadLink href="/api/export?format=csv&table=cattle" filename="campoai-hacienda.csv" className={noticeLinkClass}>descargá la hacienda en CSV</AuthenticatedDownloadLink>.
            </Notice>
          )}
          {sectionsTruncated && (
            <Notice tone="warn">
              Se muestran hasta 500 potreros para cargar rápido. Para ver el conjunto completo, <AuthenticatedDownloadLink href="/api/export?format=csv&table=sections" filename="campoai-secciones.csv" className={noticeLinkClass}>descargá las secciones en CSV</AuthenticatedDownloadLink>.
            </Notice>
          )}
        </div>
      )}

      {allCattle.length > 0 && (
        <StatStrip
          items={[
            { label: "Cabezas", value: `${totalHeads.toLocaleString("es-UY")}${partial}`, unit: "cab.", hint: unassignedHeads > 0 ? `${unassignedHeads.toLocaleString("es-UY")} sin sección` : undefined },
            { label: "Lotes", value: `${allCattle.length}${partial}` },
            { label: "Vacunación vencida", value: overdueVaccinationLots, unit: overdueVaccinationLots === 1 ? "lote" : "lotes", tone: overdueVaccinationLots > 0 ? "bad" : undefined },
            { label: "Salud con alerta", value: healthAlertLots, unit: healthAlertLots === 1 ? "lote" : "lotes", tone: healthAlertLots > 0 ? "warn" : undefined },
          ]}
        />
      )}

      <SectionList
        sections={sections}
        expandedSections={expandedSections}
        focusedSectionId={focusedSectionId}
        onToggle={toggleSection}
        onAdd={openAddSection}
        onEdit={openEditSection}
        onDelete={deleteSection}
        onEditCattle={openEditCattle}
      />

      <CattleTable
        rows={paginatedCattle}
        totalCount={allCattle.length}
        filteredCount={filteredCattle.length}
        query={cattleQuery}
        onQueryChange={(value) => { setCattleQuery(value); setCurrentPage(1); }}
        onClearQuery={() => { setCattleQuery(""); setCurrentPage(1); }}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        focusedCattleId={focusedCattleId}
        onAdd={openAddCattle}
        onEdit={openEditCattle}
        onWeigh={(c) => navigate(`/produccion/peso?cattleId=${encodeURIComponent(c.id)}`)}
        onCost={openCattleCost}
        onDelete={deleteCattle}
      />

      <HaciendaFormSheet
        open={sheetOpen}
        onOpenChange={(open) => { if (open) { setSheetOpen(true); return; } requestSheetClose(); }}
        mode={sheetMode}
        sections={sections}
        section={sectionForm}
        onSectionChange={patchSectionForm}
        cattle={cattleForm}
        onCattleChange={patchCattleForm}
        saving={saving}
        readOnly={readOnly}
        onCancel={requestSheetClose}
        onSaveSection={saveSection}
        onSaveCattle={saveCattle}
      />
      <UnsavedChangesDialog
        open={discardDialogOpen}
        onOpenChange={setDiscardDialogOpen}
        onDiscard={discardFormChanges}
      />
    </div>
  );
}

export default function HaciendaPage() {
  return <Suspense fallback={<LoadingPage />}><HaciendaPageContent /></Suspense>;
}
