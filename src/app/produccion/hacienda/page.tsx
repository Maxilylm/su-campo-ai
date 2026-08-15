"use client";

import { Suspense, useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { toneBadge, vaccinationTone } from "@/lib/status-styles";
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
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { CattleImportDialog } from "@/components/CattleImportDialog";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { fetchWithTimeout } from "@/lib/fetch";
import { filterCattleRows, pageForRowId } from "@/lib/cattle-navigation";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";
import { useUnsavedChangesWarning } from "@/lib/use-unsaved-changes-warning";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { useOfflineAwareNavigation, useOfflineAwareReplace } from "@/lib/use-offline-aware-navigation";
import { isOfflineSnapshotFresh, offlineEntitySnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";
import {
  Beef, MapPin, MoreHorizontal, Pencil, Trash2, Plus, ChevronDown, ChevronRight, Search, DollarSign, Scale,
} from "lucide-react";

// ─── Types ──────────────────────────────────

interface Cattle {
  id: string; section_id: string | null; category: string; breed: string | null;
  count: number; tag_range: string | null; ear_tag: string | null;
  health_status: string; weight_kg: number | null; vaccination_status: string;
  reproductive_status: string | null; origin: string; notes: string | null;
}

interface SectionWithCattle {
  id: string; name: string; size_hectares: number | null; capacity: number | null;
  color: string; water_status: string; pasture_status: string; notes: string | null;
  padron_id: string | null;
  padrones?: { id: string; padron_code: string; department_name: string } | null;
  cattle: Cattle[];
}

type HaciendaSheetMode = "add-section" | "edit-section" | "add-cattle" | "edit-cattle";

interface HaciendaFormSnapshot {
  mode: HaciendaSheetMode;
  editId: string | null;
  secName: string;
  secHa: string;
  secCap: string;
  secColor: string;
  secWater: string;
  secPasture: string;
  secNotes: string;
  catSection: string;
  catCategory: string;
  catBreed: string;
  catCount: string;
  catWeight: string;
  catEarTag: string;
  catOrigin: string;
  catVaxStatus: string;
  catRepro: string;
  catHealth: string;
  catNotes: string;
}

function haciendaFormSignature(form: HaciendaFormSnapshot): string {
  return JSON.stringify(form.mode === "add-section" || form.mode === "edit-section"
    ? {
      mode: form.mode, editId: form.editId, secName: form.secName, secHa: form.secHa, secCap: form.secCap,
      secColor: form.secColor, secWater: form.secWater, secPasture: form.secPasture, secNotes: form.secNotes,
    }
    : {
      mode: form.mode, editId: form.editId, catSection: form.catSection, catCategory: form.catCategory,
      catBreed: form.catBreed, catCount: form.catCount, catWeight: form.catWeight, catEarTag: form.catEarTag,
      catOrigin: form.catOrigin, catVaxStatus: form.catVaxStatus, catRepro: form.catRepro,
      catHealth: form.catHealth, catNotes: form.catNotes,
    });
}

// ─── Constants ──────────────────────────────

const CATEGORIES = ["vaca", "toro", "novillo", "vaquillona", "ternero", "ternera", "caballo", "yegua", "oveja"];
const BREEDS = ["Angus", "Hereford", "Braford", "Brangus", "Holando", "Criolla", "Cruza", "Otra"];
const SECTION_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

// ─── Page Component ─────────────────────────

function HaciendaPageContent() {
  const { refreshSections, sectionsTruncated, userId, readOnly } = useFarm();
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

  // Section form
  const [secName, setSecName] = useState("");
  const [secHa, setSecHa] = useState("");
  const [secCap, setSecCap] = useState("");
  const [secColor, setSecColor] = useState("#22c55e");
  const [secWater, setSecWater] = useState("bueno");
  const [secPasture, setSecPasture] = useState("bueno");
  const [secNotes, setSecNotes] = useState("");

  // Cattle form
  const [catSection, setCatSection] = useState("");
  const [catCategory, setCatCategory] = useState("vaca");
  const [catBreed, setCatBreed] = useState("");
  const [catCount, setCatCount] = useState("1");
  const [catWeight, setCatWeight] = useState("");
  const [catEarTag, setCatEarTag] = useState("");
  const [catOrigin, setCatOrigin] = useState("propio");
  const [catVaxStatus, setCatVaxStatus] = useState("pendiente");
  const [catRepro, setCatRepro] = useState("");
  const [catHealth, setCatHealth] = useState("healthy");
  const [catNotes, setCatNotes] = useState("");

  function setFormBaseline(snapshot: HaciendaFormSnapshot) {
    formBaselineRef.current = haciendaFormSignature(snapshot);
  }

  function currentFormSignature() {
    return haciendaFormSignature({
      mode: sheetMode,
      editId,
      secName,
      secHa,
      secCap,
      secColor,
      secWater,
      secPasture,
      secNotes,
      catSection,
      catCategory,
      catBreed,
      catCount,
      catWeight,
      catEarTag,
      catOrigin,
      catVaxStatus,
      catRepro,
      catHealth,
      catNotes,
    });
  }

  useUnsavedChangesWarning(sheetOpen && hasUnsavedChanges(formBaselineRef.current, currentFormSignature()));

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const ROWS_PER_PAGE = 20;

  const loadSectionsWithCattle = useCallback(async () => {
    livestockRequestRef.current?.abort();
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
  }, [readOnly, userId]);

  useEffect(() => {
    void loadSectionsWithCattle();
    return () => livestockRequestRef.current?.abort();
  }, [loadSectionsWithCattle]);
  useDataChangedRefresh(loadSectionsWithCattle, !readOnly);
  useOfflineSnapshotRefresh(loadSectionsWithCattle, userId, readOnly);

  const allCattle = useMemo(() => [
    ...sections.flatMap((s) => s.cattle.map((c) => ({ ...c, sectionName: s.name, sectionColor: s.color }))),
    ...unassignedCattle.map((c) => ({ ...c, sectionName: "Sin sección", sectionColor: "#64748b" })),
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
    setSecName(""); setSecHa(""); setSecCap(""); setSecColor("#22c55e");
    setSecWater("bueno"); setSecPasture("bueno"); setSecNotes(""); setEditId(null);
    formBaselineRef.current = null;
  }

  function resetCattleForm() {
    cattleAttempt.current = null;
    setCatSection(""); setCatCategory("vaca"); setCatBreed(""); setCatCount("1");
    setCatWeight(""); setCatEarTag(""); setCatOrigin("propio"); setCatVaxStatus("pendiente");
    setCatRepro(""); setCatHealth("healthy"); setCatNotes(""); setEditId(null);
    formBaselineRef.current = null;
  }

  function openAddSection() {
    resetSectionForm();
    setSheetMode("add-section");
    setFormBaseline({
      mode: "add-section", editId: null,
      secName: "", secHa: "", secCap: "", secColor: "#22c55e", secWater: "bueno", secPasture: "bueno", secNotes: "",
      catSection: "", catCategory: "vaca", catBreed: "", catCount: "1", catWeight: "", catEarTag: "", catOrigin: "propio", catVaxStatus: "pendiente", catRepro: "", catHealth: "healthy", catNotes: "",
    });
    setSheetOpen(true);
  }
  function openEditSection(s: SectionWithCattle) {
    setSecName(s.name); setSecHa(s.size_hectares?.toString() || ""); setSecCap(s.capacity?.toString() || "");
    setSecColor(s.color); setSecWater(s.water_status); setSecPasture(s.pasture_status);
    setSecNotes(s.notes || ""); setEditId(s.id); setSheetMode("edit-section"); setSheetOpen(true);
    setFormBaseline({
      mode: "edit-section", editId: s.id,
      secName: s.name, secHa: s.size_hectares?.toString() || "", secCap: s.capacity?.toString() || "", secColor: s.color,
      secWater: s.water_status, secPasture: s.pasture_status, secNotes: s.notes || "",
      catSection: "", catCategory: "vaca", catBreed: "", catCount: "1", catWeight: "", catEarTag: "", catOrigin: "propio", catVaxStatus: "pendiente", catRepro: "", catHealth: "healthy", catNotes: "",
    });
  }
  function openAddCattle() {
    resetCattleForm();
    setSheetMode("add-cattle");
    setFormBaseline({
      mode: "add-cattle", editId: null,
      secName: "", secHa: "", secCap: "", secColor: "#22c55e", secWater: "bueno", secPasture: "bueno", secNotes: "",
      catSection: "", catCategory: "vaca", catBreed: "", catCount: "1", catWeight: "", catEarTag: "", catOrigin: "propio", catVaxStatus: "pendiente", catRepro: "", catHealth: "healthy", catNotes: "",
    });
    setSheetOpen(true);
  }
  function openEditCattle(c: Cattle) {
    setCatSection(c.section_id || ""); setCatCategory(c.category); setCatBreed(c.breed || "");
    setCatCount(c.count.toString()); setCatWeight(c.weight_kg?.toString() || "");
    setCatEarTag(c.ear_tag || ""); setCatOrigin(c.origin || "propio");
    setCatVaxStatus(c.vaccination_status || "pendiente"); setCatRepro(c.reproductive_status || "");
    setCatHealth(c.health_status || "healthy"); setCatNotes(c.notes || "");
    setEditId(c.id); setSheetMode("edit-cattle"); setSheetOpen(true);
    setFormBaseline({
      mode: "edit-cattle", editId: c.id,
      secName: "", secHa: "", secCap: "", secColor: "#22c55e", secWater: "bueno", secPasture: "bueno", secNotes: "",
      catSection: c.section_id || "", catCategory: c.category, catBreed: c.breed || "", catCount: c.count.toString(), catWeight: c.weight_kg?.toString() || "", catEarTag: c.ear_tag || "",
      catOrigin: c.origin || "propio", catVaxStatus: c.vaccination_status || "pendiente", catRepro: c.reproductive_status || "", catHealth: c.health_status || "healthy", catNotes: c.notes || "",
    });
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
    if (readOnly || !secName.trim()) return;
    setSaving(true);
    try {
      const payload = { name: secName, sizeHectares: secHa ? Number(secHa) : null, capacity: secCap ? Number(secCap) : null, color: secColor, waterStatus: secWater, pastureStatus: secPasture, notes: secNotes || null };
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
        toast.success(editing ? "Seccion actualizada" : "Seccion creada");
        setSheetOpen(false);
        resetSectionForm();
        await onRefresh();
      } else {
        toast.error(result.error || "No se pudo guardar la seccion");
      }
    } catch {
      toast.error("No se pudo guardar la seccion");
    } finally {
      setSaving(false);
    }
  }

  async function saveCattle() {
    if (readOnly) return;
    setSaving(true);
    try {
      const payload = { sectionId: catSection || null, category: catCategory, breed: catBreed || null, count: Number(catCount) || 1, weightKg: catWeight ? Number(catWeight) : null, earTag: catEarTag || null, origin: catOrigin, vaccinationStatus: catVaxStatus, reproductiveStatus: catRepro || null, healthStatus: catHealth, notes: catNotes || null };
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
        toast.error(result.error || "No se pudo guardar la hacienda");
      }
    } catch {
      toast.error("No se pudo guardar la hacienda");
    } finally {
      setSaving(false);
    }
  }

  async function deleteSection(id: string) {
    if (readOnly) return;
    const result = await sendJsonResult("/api/sections", "DELETE", { id });
    if (result.ok) { toast.success("Seccion eliminada"); await onRefresh(); }
    else toast.error(result.error || "No se pudo eliminar la seccion");
  }

  async function deleteCattle(id: string) {
    if (readOnly) return;
    const result = await sendJsonResult("/api/cattle", "DELETE", { id });
    if (result.ok) { toast.success("Hacienda eliminada"); await onRefresh(); }
    else toast.error(result.error || "No se pudo eliminar la hacienda");
  }

  function toggleSection(id: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const isSecForm = sheetMode === "add-section" || sheetMode === "edit-section";
  const isCatForm = sheetMode === "add-cattle" || sheetMode === "edit-cattle";
  const isEditing = sheetMode.startsWith("edit");

  const filteredCattle = filterCattleRows(allCattle, cattleQuery);
  const totalPages = Math.max(1, Math.ceil(filteredCattle.length / ROWS_PER_PAGE));
  const paginatedCattle = filteredCattle.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const VAX_LABEL: Record<string, string> = { al_dia: "Al dia", vencida: "Vencida", pendiente: "Pendiente" };
  const vaxBadge = (status: string) => (
    <Badge variant="outline" className={toneBadge(vaccinationTone(status))}>
      {VAX_LABEL[status] || "Pendiente"}
    </Badge>
  );

  if (!loaded) return <LoadingPage />;
  if (loadError) return <LoadErrorState title={readOnly ? "No hay una copia local de Hacienda" : "No se pudo cargar Hacienda"} description={readOnly ? "Sincronizá Hacienda cuando recuperes la conexión para consultarla sin conexión." : undefined} onRetry={readOnly ? undefined : loadSectionsWithCattle} />;

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[{ label: "Produccion", href: "/produccion/hacienda" }, { label: "Hacienda" }]}
        title="Hacienda"
        description="Gestiona secciones, potreros y registro de hacienda"
        actions={
          <div className="flex gap-2">
            <CattleImportDialog sections={sections.map((section) => ({ id: section.id, name: section.name }))} readOnly={readOnly} onImported={onRefresh} />
            <Button variant="outline" onClick={openAddSection} disabled={readOnly}><Plus className="h-4 w-4 mr-1.5" />Seccion</Button>
            <Button onClick={openAddCattle} disabled={readOnly}><Plus className="h-4 w-4 mr-1.5" />Hacienda</Button>
          </div>
        }
      />

      {offlineLivestockSavedAt && <div role="status" className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
        Mostrando secciones y hacienda de la copia sincronizada el {new Date(offlineLivestockSavedAt).toLocaleString("es-UY")}. Las modificaciones se habilitarán al recuperar la conexión.
      </div>}

      {cattleTruncated && (
        <div role="status" className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          La lista muestra solo una parte de la hacienda para mantener la carga rápida. Exportá el CSV para consultar el conjunto completo: <AuthenticatedDownloadLink href="/api/export?format=csv&table=cattle" filename="campoai-hacienda.csv" className="font-medium text-primary underline-offset-2 hover:underline">Descargar hacienda CSV</AuthenticatedDownloadLink>
        </div>
      )}
      {sectionsTruncated && (
        <div role="status" className="rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          Se muestran hasta 500 secciones para mantener la carga rápida. Exportá el CSV para consultar el conjunto completo: <AuthenticatedDownloadLink href="/api/export?format=csv&table=sections" filename="campoai-secciones.csv" className="font-medium text-primary underline-offset-2 hover:underline">Descargar secciones CSV</AuthenticatedDownloadLink>
        </div>
      )}

      {/* Sections — collapsible */}
      <div>
        <h2 className="text-lg font-medium mb-4">Secciones</h2>
        {sections.length === 0 ? (
          <EmptyState icon={MapPin} title="Sin secciones" description="Agrega tu primera seccion para empezar." actionLabel="Agregar seccion" onAction={openAddSection} />
        ) : (
          <div className="space-y-2">
            {sections.map((s) => {
              const expanded = expandedSections.has(s.id);
              const headCount = s.cattle.reduce((sum, c) => sum + c.count, 0);
              return (
                <div id={`hacienda-section-${s.id}`} key={s.id} className={`rounded-xl border bg-card overflow-hidden ${focusedSectionId === s.id ? "border-primary ring-2 ring-primary/20" : "border-border"}`}>
                  <div className="flex items-center gap-2">
                    <button type="button"
                      onClick={() => toggleSection(s.id)}
                      aria-expanded={expanded}
                      className="flex min-w-0 flex-1 items-center gap-3 p-4 hover:bg-accent/50 transition-colors text-left"
                    >
                      {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                      <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                      <span className="font-medium flex-1">{s.name}</span>
                      <span className="text-sm font-semibold tabular-nums text-primary">{headCount} cab.</span>
                      <span className="flex gap-1.5 ml-2">
                        {s.size_hectares && <Badge variant="secondary">{s.size_hectares} ha</Badge>}
                        <Badge variant="outline">{s.water_status}</Badge>
                        <Badge variant="outline">{s.pasture_status}</Badge>
                      </span>
                    </button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" aria-label={`Acciones de ${s.name}`} className="mr-2 h-8 w-8 shrink-0"><MoreHorizontal className="h-4 w-4" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => openEditSection(s)}><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>
                        <ConfirmDialog trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Eliminar</DropdownMenuItem>} title="Eliminar seccion" description={`Esto eliminara la seccion "${s.name}" y toda la hacienda asociada. Esta accion no se puede deshacer.`} onConfirm={() => deleteSection(s.id)} />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                  {expanded && s.cattle.length > 0 && (
                    <div className="border-t border-border px-4 py-3 bg-muted/30">
                      <div className="text-xs text-muted-foreground mb-2">{s.cattle.length} registros en esta seccion</div>
                      {s.cattle.map((c) => (
                        <div key={c.id} className="flex items-center justify-between py-1.5 text-sm">
                          <span>{c.count} {c.category}{c.breed ? ` (${c.breed})` : ""}</span>
                          <div className="flex items-center gap-2">
                            {vaxBadge(c.vaccination_status)}
                            <Button variant="ghost" size="icon" aria-label="Editar" className="h-7 w-7" onClick={() => openEditCattle(c)}><Pencil className="h-3 w-3" /></Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Cattle table */}
      <div>
        <div className="flex flex-col gap-3 mb-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-medium">Hacienda</h2>
            <span className="text-xs text-muted-foreground">
              {cattleQuery.trim() ? `${filteredCattle.length} de ${allCattle.length}` : allCattle.length} registros
            </span>
          </div>
          <div className="relative w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              aria-label="Buscar hacienda"
              value={cattleQuery}
              onChange={(event) => {
                setCattleQuery(event.target.value);
                setCurrentPage(1);
              }}
              placeholder="Buscar sección, raza o caravana…"
              className="pl-9"
            />
          </div>
        </div>
        {allCattle.length === 0 ? (
          <EmptyState icon={Beef} title="Sin hacienda" description="Registra tu primera hacienda para empezar el seguimiento." actionLabel="Registrar hacienda" onAction={openAddCattle} />
        ) : filteredCattle.length === 0 ? (
          <EmptyState icon={Search} title="Sin coincidencias" description="Probá con otra sección, categoría, raza, caravana o estado sanitario." actionLabel="Limpiar búsqueda" onAction={() => { setCattleQuery(""); setCurrentPage(1); }} />
        ) : (
          <>
            <div className="rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Seccion</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Raza</TableHead>
                    <TableHead className="text-right">Cant.</TableHead>
                    <TableHead className="text-right">Peso</TableHead>
                    <TableHead>Caravana</TableHead>
                    <TableHead>Vacunas</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedCattle.map((c) => (
                    <TableRow id={`hacienda-cattle-${c.id}`} key={c.id} className={focusedCattleId === c.id ? "bg-accent ring-1 ring-inset ring-primary/40" : undefined}>
                      <TableCell>
                        <span className="flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.sectionColor }} />
                          {c.sectionName}
                        </span>
                      </TableCell>
                      <TableCell className="capitalize">{c.category}</TableCell>
                      <TableCell className="text-muted-foreground">{c.breed || "—"}</TableCell>
                      <TableCell className="text-right tabular-nums font-medium">{c.count}</TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">{c.weight_kg ? `${c.weight_kg} kg` : "—"}</TableCell>
                      <TableCell className="text-muted-foreground font-mono text-xs">{c.ear_tag || c.tag_range || "—"}</TableCell>
                      <TableCell>{vaxBadge(c.vaccination_status)}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label="Acciones" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => openEditCattle(c)}><Pencil className="mr-2 h-4 w-4" />Editar</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => navigate(`/produccion/peso?cattleId=${encodeURIComponent(c.id)}`)}><Scale className="mr-2 h-4 w-4" />Registrar pesaje</DropdownMenuItem>
                            <DropdownMenuItem onClick={() => openCattleCost(c)}><DollarSign className="mr-2 h-4 w-4" />Registrar gasto del lote</DropdownMenuItem>
                            <ConfirmDialog trigger={<DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Eliminar</DropdownMenuItem>} title="Eliminar hacienda" description="Esta accion no se puede deshacer." onConfirm={() => deleteCattle(c.id)} />
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                <span>Pagina {currentPage} de {totalPages}</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>Anterior</Button>
                  <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)}>Siguiente</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Sheet for forms */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { if (open) { setSheetOpen(true); return; } requestSheetClose(); }}>
        <SheetContent className="overflow-y-auto">
          {isSecForm && (
            <>
              <SheetHeader>
                <SheetTitle>{isEditing ? "Editar seccion" : "Nueva seccion"}</SheetTitle>
                <SheetDescription>Agrega o modifica un potrero en tu campo.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="space-y-2"><Label>Nombre</Label><Input value={secName} onChange={(e) => setSecName(e.target.value)} placeholder="Ej: Norte" /></div>
                <div className="space-y-2"><Label>Hectareas</Label><Input type="number" value={secHa} onChange={(e) => setSecHa(e.target.value)} placeholder="100" /></div>
                <div className="space-y-2"><Label>Capacidad (cabezas)</Label><Input type="number" value={secCap} onChange={(e) => setSecCap(e.target.value)} placeholder="500" /></div>
                <div className="space-y-2">
                  <Label>Color</Label>
                  <div className="flex gap-1.5">
                    {SECTION_COLORS.map((c) => (
                      <button type="button" key={c} onClick={() => setSecColor(c)} className={`w-7 h-7 rounded-full border-2 transition-all ${secColor === c ? "border-foreground scale-110" : "border-border"}`} style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Agua</Label>
                  <Select value={secWater} onValueChange={setSecWater}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bueno">Bueno</SelectItem>
                      <SelectItem value="bajo">Bajo</SelectItem>
                      <SelectItem value="seco">Seco</SelectItem>
                      <SelectItem value="inundado">Inundado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Pasto</Label>
                  <Select value={secPasture} onValueChange={setSecPasture}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="bueno">Bueno</SelectItem>
                      <SelectItem value="sobrepastoreado">Sobrepastoreado</SelectItem>
                      <SelectItem value="seco">Seco</SelectItem>
                      <SelectItem value="creciendo">Creciendo</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Notas</Label><Input value={secNotes} onChange={(e) => setSecNotes(e.target.value)} placeholder="Observaciones..." /></div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={requestSheetClose} disabled={saving}>Cancelar</Button>
                <Button onClick={saveSection} disabled={readOnly || !secName.trim() || saving}>{saving ? "Guardando..." : isEditing ? "Guardar cambios" : "Crear seccion"}</Button>
              </SheetFooter>
            </>
          )}
          {isCatForm && (
            <>
              <SheetHeader>
                <SheetTitle>{isEditing ? "Editar hacienda" : "Nueva hacienda"}</SheetTitle>
                <SheetDescription>Registra o modifica un lote de hacienda.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="space-y-2">
                  <Label>Sección <span className="text-muted-foreground">(opcional)</span></Label>
                  <Select value={catSection || "none"} onValueChange={(value) => setCatSection(value === "none" ? "" : value)}>
                    <SelectTrigger><SelectValue placeholder="Sin sección" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin sección</SelectItem>
                      {sections.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Select value={catCategory} onValueChange={setCatCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Raza</Label>
                  <Select value={catBreed} onValueChange={setCatBreed}>
                    <SelectTrigger><SelectValue placeholder="Elegir raza..." /></SelectTrigger>
                    <SelectContent>{BREEDS.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Cantidad</Label><Input type="number" value={catCount} onChange={(e) => setCatCount(e.target.value)} placeholder="1" /></div>
                <div className="space-y-2"><Label>Peso promedio (kg)</Label><Input type="number" value={catWeight} onChange={(e) => setCatWeight(e.target.value)} placeholder="350" /></div>
                <div className="space-y-2"><Label>Caravana</Label><Input value={catEarTag} onChange={(e) => setCatEarTag(e.target.value)} placeholder="001-050" /></div>
                <div className="space-y-2">
                  <Label>Origen</Label>
                  <Select value={catOrigin} onValueChange={setCatOrigin}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="propio">Propio</SelectItem>
                      <SelectItem value="comprado">Comprado</SelectItem>
                      <SelectItem value="transferido">Transferido</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Estado vacunacion</Label>
                  <Select value={catVaxStatus} onValueChange={setCatVaxStatus}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="al_dia">Al dia</SelectItem>
                      <SelectItem value="pendiente">Pendiente</SelectItem>
                      <SelectItem value="vencida">Vencida</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Estado reproductivo</Label>
                  <Select value={catRepro || "none"} onValueChange={(value) => setCatRepro(value === "none" ? "" : value)}>
                    <SelectTrigger><SelectValue placeholder="N/A" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">N/A</SelectItem>
                      <SelectItem value="prenada">Prenada</SelectItem>
                      <SelectItem value="lactando">Lactando</SelectItem>
                      <SelectItem value="servicio">En servicio</SelectItem>
                      <SelectItem value="vacia">Vacia</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Estado sanitario</Label>
                  <Select value={catHealth} onValueChange={setCatHealth}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="healthy">Sano</SelectItem>
                      <SelectItem value="enfermo">Enfermo</SelectItem>
                      <SelectItem value="tratamiento">En tratamiento</SelectItem>
                      <SelectItem value="cuarentena">Cuarentena</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Notas</Label><Input value={catNotes} onChange={(e) => setCatNotes(e.target.value)} placeholder="Observaciones..." /></div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={requestSheetClose} disabled={saving}>Cancelar</Button>
                <Button onClick={saveCattle} disabled={readOnly || saving}>{saving ? "Guardando..." : isEditing ? "Guardar cambios" : "Registrar"}</Button>
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

export default function HaciendaPage() {
  return <Suspense fallback={<LoadingPage />}><HaciendaPageContent /></Suspense>;
}
