"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import { dateInputToIso, dateInputValue } from "@/lib/date";
import { financialExpenseHref } from "@/lib/alerts";
import { inventoryUseHref } from "@/lib/inventory-navigation";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";
import { useUnsavedChangesWarning } from "@/lib/use-unsaved-changes-warning";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { isOfflineSnapshotFresh, offlineEntitySnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";
import {
  Syringe, Heart, Plus, AlertTriangle,
  Egg, Skull, Thermometer, Bandage, Pill, Stethoscope, Baby, Scissors, MoreHorizontal, Pencil, Trash2, DollarSign, Package,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ─── Types ──────────────────────────────────

interface Vaccination {
  id: string;
  vaccine_name: string;
  date_applied: string;
  next_due: string | null;
  head_count: number;
  applied_by: string | null;
  batch_number: string | null;
  section_id: string | null;
  cattle_id?: string | null;
  notes: string | null;
  cattle?: { category: string; breed: string | null; count: number } | null;
  sections?: { name: string } | null;
}

interface HealthEvent {
  id: string;
  type: string;
  description: string;
  date_occurred: string;
  head_count: number;
  resolved: boolean;
  veterinarian: string | null;
  section_id: string | null;
  notes: string | null;
  cattle_id: string | null;
  cattle?: { category: string; breed: string | null; count: number } | null;
  sections?: { name: string } | null;
}

interface CattleOption {
  id: string;
  category: string;
  breed: string | null;
  count: number;
  section_id: string | null;
  sections?: { name: string } | null;
}

type SanidadSheetMode = "add-vax" | "add-health";

interface SanidadFormSnapshot {
  mode: SanidadSheetMode;
  vaccinationId: string | null;
  healthId: string | null;
  vaxName: string;
  vaxSection: string;
  vaxCattle: string;
  vaxCount: string;
  vaxDate: string;
  vaxNextDue: string;
  vaxBy: string;
  vaxBatch: string;
  vaxNotes: string;
  healthType: string;
  healthDesc: string;
  healthSection: string;
  healthCattle: string;
  healthCount: string;
  healthDate: string;
  healthVet: string;
  healthNotes: string;
}

function sanidadFormSignature(form: SanidadFormSnapshot): string {
  return JSON.stringify(form.mode === "add-vax"
    ? {
      mode: form.mode, vaccinationId: form.vaccinationId, vaxName: form.vaxName, vaxSection: form.vaxSection,
      vaxCattle: form.vaxCattle, vaxCount: form.vaxCount, vaxDate: form.vaxDate, vaxNextDue: form.vaxNextDue,
      vaxBy: form.vaxBy, vaxBatch: form.vaxBatch, vaxNotes: form.vaxNotes,
    }
    : {
      mode: form.mode, healthId: form.healthId, healthType: form.healthType, healthDesc: form.healthDesc,
      healthSection: form.healthSection, healthCattle: form.healthCattle, healthCount: form.healthCount,
      healthDate: form.healthDate, healthVet: form.healthVet, healthNotes: form.healthNotes,
    });
}

// ─── Constants ──────────────────────────────

const VACCINES = ["Aftosa", "Brucelosis", "Carbunclo", "Clostridiosis", "Rabia", "Leptospirosis", "IBR", "DVB", "Antiparasitario", "Otra"];

const HEALTH_TYPES = [
  { value: "nacimiento", label: "Nacimiento" },
  { value: "muerte", label: "Muerte" },
  { value: "enfermedad", label: "Enfermedad" },
  { value: "lesion", label: "Lesion" },
  { value: "tratamiento", label: "Tratamiento" },
  { value: "revision", label: "Revision" },
  { value: "desparasitacion", label: "Desparasitacion" },
  { value: "destete", label: "Destete" },
  { value: "castrado", label: "Castrado" },
];

const HEALTH_ICON: Record<string, LucideIcon> = {
  nacimiento: Egg,
  muerte: Skull,
  enfermedad: Thermometer,
  lesion: Bandage,
  tratamiento: Pill,
  revision: Stethoscope,
  desparasitacion: Syringe,
  destete: Baby,
  castrado: Scissors,
};

const STATUS_OPTIONS = [
  { value: "pending", label: "Pendiente" },
  { value: "resolved", label: "Resuelto" },
];

// ─── Page Component ─────────────────────────

function SanidadPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigationQuery = searchParams.toString();
  const { sections, userId, readOnly } = useFarm();
  const [vaccinations, setVaccinations] = useState<Vaccination[]>([]);
  const [cattleOptions, setCattleOptions] = useState<CattleOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [healthEvents, setHealthEvents] = useState<HealthEvent[]>([]);
  const [vaccinationsTruncated, setVaccinationsTruncated] = useState(false);
  const [healthEventsTruncated, setHealthEventsTruncated] = useState(false);
  const [offlineHealthSavedAt, setOfflineHealthSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const vaccinationAttempt = useRef<{ key: string; signature: string } | null>(null);
  const healthAttempt = useRef<{ key: string; signature: string } | null>(null);
  const healthDataRequestRef = useRef<AbortController | null>(null);
  const handledNavigationQueryRef = useRef<string | null>(null);
  const [focusedHealthId, setFocusedHealthId] = useState<string | null>(null);
  const [focusedVaccinationId, setFocusedVaccinationId] = useState<string | null>(null);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<SanidadSheetMode>("add-vax");
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [editingVaccinationId, setEditingVaccinationId] = useState<string | null>(null);
  const [editingHealthId, setEditingHealthId] = useState<string | null>(null);
  const formBaselineRef = useRef<string | null>(null);

  // Vax form
  const [vaxName, setVaxName] = useState("Aftosa");
  const [vaxSection, setVaxSection] = useState("");
  const [vaxCattle, setVaxCattle] = useState("");
  const [vaxCount, setVaxCount] = useState("1");
  const [vaxDate, setVaxDate] = useState("");
  const [vaxNextDue, setVaxNextDue] = useState("");
  const [vaxBy, setVaxBy] = useState("");
  const [vaxBatch, setVaxBatch] = useState("");
  const [vaxNotes, setVaxNotes] = useState("");

  // Health form
  const [healthType, setHealthType] = useState("revision");
  const [healthDesc, setHealthDesc] = useState("");
  const [healthSection, setHealthSection] = useState("");
  const [healthCattle, setHealthCattle] = useState("");
  const [healthCount, setHealthCount] = useState("1");
  const [healthDate, setHealthDate] = useState("");
  const [healthVet, setHealthVet] = useState("");
  const [healthNotes, setHealthNotes] = useState("");

  function setFormBaseline(snapshot: SanidadFormSnapshot) {
    formBaselineRef.current = sanidadFormSignature(snapshot);
  }

  function currentFormSignature() {
    return sanidadFormSignature({
      mode: sheetMode,
      vaccinationId: editingVaccinationId,
      healthId: editingHealthId,
      vaxName,
      vaxSection,
      vaxCattle,
      vaxCount,
      vaxDate,
      vaxNextDue,
      vaxBy,
      vaxBatch,
      vaxNotes,
      healthType,
      healthDesc,
      healthSection,
      healthCattle,
      healthCount,
      healthDate,
      healthVet,
      healthNotes,
    });
  }

  useUnsavedChangesWarning(sheetOpen && hasUnsavedChanges(formBaselineRef.current, currentFormSignature()));

  const loadData = useCallback(async () => {
    healthDataRequestRef.current?.abort();
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
  }, [readOnly, userId]);

  useEffect(() => {
    void loadData();
    return () => healthDataRequestRef.current?.abort();
  }, [loadData]);
  useDataChangedRefresh(loadData, !readOnly);
  useOfflineSnapshotRefresh(loadData, userId, readOnly);

  useEffect(() => {
    const today = dateInputValue();
    setVaxDate((current) => current || today);
    setHealthDate((current) => current || today);
  }, []);

  useEffect(() => {
    if (!loaded || handledNavigationQueryRef.current === navigationQuery) return;
    const params = new URLSearchParams(navigationQuery);
    const healthId = params.get("healthId");
    const vaccinationId = params.get("vaccinationId");
    const health = healthId ? healthEvents.find((event) => event.id === healthId) : null;
    const vaccination = vaccinationId ? vaccinations.find((item) => item.id === vaccinationId) : null;
    if ((healthId && !health) || (vaccinationId && !vaccination)) return;
    if (params.get("new") === "vaccination") {
      setEditingVaccinationId(null);
      setEditingHealthId(null);
      const nextVaxName = params.get("vaccineName") || "Aftosa";
      const nextVaxSection = params.get("sectionId") || "";
      setVaxName(params.get("vaccineName") || "Aftosa");
      setVaxSection(nextVaxSection);
      const requestedCattleId = params.get("cattleId") || "";
      const requestedCattle = cattleOptions.find((cattle) => cattle.id === requestedCattleId);
      setVaxCattle(requestedCattleId);
      const nextVaxCount = requestedCattle ? String(requestedCattle.count) : "1";
      const nextDate = dateInputValue();
      setVaxCount(nextVaxCount);
      setVaxDate(nextDate);
      setVaxNextDue("");
      setVaxBy("");
      setVaxBatch("");
      setVaxNotes("");
      setSheetMode("add-vax");
      setFormBaseline({
        mode: "add-vax", vaccinationId: null, healthId: null,
        vaxName: nextVaxName, vaxSection: nextVaxSection, vaxCattle: requestedCattleId, vaxCount: nextVaxCount, vaxDate: nextDate, vaxNextDue: "", vaxBy: "", vaxBatch: "", vaxNotes: "",
        healthType: "revision", healthDesc: "", healthSection: "", healthCattle: "", healthCount: "1", healthDate: nextDate, healthVet: "", healthNotes: "",
      });
      setSheetOpen(true);
    } else if (health) {
      setFocusedHealthId(health.id);
      window.requestAnimationFrame(() => {
        document.getElementById(`sanidad-health-${health.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    } else if (vaccination) {
      setFocusedVaccinationId(vaccination.id);
      window.requestAnimationFrame(() => {
        document.getElementById(`sanidad-vaccination-${vaccination.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    handledNavigationQueryRef.current = navigationQuery;
    if (navigationQuery) router.replace(window.location.pathname, { scroll: false });
  }, [cattleOptions, healthEvents, loaded, navigationQuery, router, vaccinations]);

  useEffect(() => {
    if (!focusedHealthId && !focusedVaccinationId) return;
    const timer = window.setTimeout(() => {
      setFocusedHealthId(null);
      setFocusedVaccinationId(null);
    }, 4000);
    return () => window.clearTimeout(timer);
  }, [focusedHealthId, focusedVaccinationId]);

  function resetVaccinationForm() {
    vaccinationAttempt.current = null;
    setEditingVaccinationId(null);
    setEditingHealthId(null);
    setVaxName("Aftosa"); setVaxSection(""); setVaxCattle(""); setVaxCount("1");
    setVaxDate(dateInputValue()); setVaxNextDue("");
    setVaxBy(""); setVaxBatch(""); setVaxNotes("");
    formBaselineRef.current = null;
  }

  function resetHealthForm() {
    healthAttempt.current = null;
    setEditingVaccinationId(null);
    setEditingHealthId(null);
    setHealthType("revision"); setHealthDesc(""); setHealthSection(""); setHealthCattle("");
    setHealthCount("1"); setHealthDate(dateInputValue());
    setHealthVet(""); setHealthNotes("");
    formBaselineRef.current = null;
  }

  function openAddVax() {
    resetVaccinationForm();
    setSheetMode("add-vax");
    const nextDate = dateInputValue();
    setFormBaseline({
      mode: "add-vax", vaccinationId: null, healthId: null,
      vaxName: "Aftosa", vaxSection: "", vaxCattle: "", vaxCount: "1", vaxDate: nextDate, vaxNextDue: "", vaxBy: "", vaxBatch: "", vaxNotes: "",
      healthType: "revision", healthDesc: "", healthSection: "", healthCattle: "", healthCount: "1", healthDate: nextDate, healthVet: "", healthNotes: "",
    });
    setSheetOpen(true);
  }

  function openEditVaccination(vaccination: Vaccination) {
    setEditingVaccinationId(vaccination.id);
    setEditingHealthId(null);
    setVaxName(vaccination.vaccine_name);
    setVaxSection(vaccination.section_id || "");
    setVaxCattle(vaccination.cattle_id || "");
    setVaxCount(String(vaccination.head_count));
    setVaxDate(vaccination.date_applied ? vaccination.date_applied.slice(0, 10) : "");
    setVaxNextDue(vaccination.next_due ? vaccination.next_due.slice(0, 10) : "");
    setVaxBy(vaccination.applied_by || "");
    setVaxBatch(vaccination.batch_number || "");
    setVaxNotes(vaccination.notes || "");
    setSheetMode("add-vax");
    setFormBaseline({
      mode: "add-vax", vaccinationId: vaccination.id, healthId: null,
      vaxName: vaccination.vaccine_name, vaxSection: vaccination.section_id || "", vaxCattle: vaccination.cattle_id || "",
      vaxCount: String(vaccination.head_count), vaxDate: vaccination.date_applied ? vaccination.date_applied.slice(0, 10) : "",
      vaxNextDue: vaccination.next_due ? vaccination.next_due.slice(0, 10) : "", vaxBy: vaccination.applied_by || "", vaxBatch: vaccination.batch_number || "", vaxNotes: vaccination.notes || "",
      healthType: "revision", healthDesc: "", healthSection: "", healthCattle: "", healthCount: "1", healthDate: "", healthVet: "", healthNotes: "",
    });
    setSheetOpen(true);
  }

  function openAddHealth() {
    resetHealthForm();
    setSheetMode("add-health");
    const nextDate = dateInputValue();
    setFormBaseline({
      mode: "add-health", vaccinationId: null, healthId: null,
      vaxName: "Aftosa", vaxSection: "", vaxCattle: "", vaxCount: "1", vaxDate: nextDate, vaxNextDue: "", vaxBy: "", vaxBatch: "", vaxNotes: "",
      healthType: "revision", healthDesc: "", healthSection: "", healthCattle: "", healthCount: "1", healthDate: nextDate, healthVet: "", healthNotes: "",
    });
    setSheetOpen(true);
  }

  function openEditHealth(event: HealthEvent) {
    setEditingVaccinationId(null);
    setEditingHealthId(event.id);
    setHealthType(event.type);
    setHealthDesc(event.description);
    setHealthSection(event.section_id || "");
    setHealthCattle(event.cattle_id || "");
    setHealthCount(String(event.head_count));
    setHealthDate(event.date_occurred ? event.date_occurred.slice(0, 10) : "");
    setHealthVet(event.veterinarian || "");
    setHealthNotes(event.notes || "");
    setSheetMode("add-health");
    setFormBaseline({
      mode: "add-health", vaccinationId: null, healthId: event.id,
      vaxName: "Aftosa", vaxSection: "", vaxCattle: "", vaxCount: "1", vaxDate: "", vaxNextDue: "", vaxBy: "", vaxBatch: "", vaxNotes: "",
      healthType: event.type, healthDesc: event.description, healthSection: event.section_id || "", healthCattle: event.cattle_id || "",
      healthCount: String(event.head_count), healthDate: event.date_occurred ? event.date_occurred.slice(0, 10) : "", healthVet: event.veterinarian || "", healthNotes: event.notes || "",
    });
    setSheetOpen(true);
  }

  function discardFormChanges() {
    setDiscardDialogOpen(false);
    setSheetOpen(false);
    resetVaccinationForm();
    resetHealthForm();
    setSheetMode("add-vax");
  }

  function requestSheetClose() {
    if (saving) return;
    if (hasUnsavedChanges(formBaselineRef.current, currentFormSignature())) {
      setDiscardDialogOpen(true);
      return;
    }
    setSheetOpen(false);
    resetVaccinationForm();
    resetHealthForm();
    setSheetMode("add-vax");
  }

  function changeVaxSection(value: string) {
    const nextSection = value === "none" ? "" : value;
    setVaxSection(nextSection);
    const cattle = cattleOptions.find((option) => option.id === vaxCattle);
    if (nextSection && cattle?.section_id && cattle.section_id !== nextSection) setVaxCattle("");
  }

  function changeVaxCattle(value: string) {
    const nextCattle = value === "none" ? "" : value;
    setVaxCattle(nextCattle);
    const cattle = cattleOptions.find((option) => option.id === nextCattle);
    if (cattle?.section_id) setVaxSection(cattle.section_id);
  }

  function changeHealthSection(value: string) {
    const nextSection = value === "none" ? "" : value;
    setHealthSection(nextSection);
    const cattle = cattleOptions.find((option) => option.id === healthCattle);
    if (nextSection && cattle?.section_id && cattle.section_id !== nextSection) setHealthCattle("");
  }

  function changeHealthCattle(value: string) {
    const nextCattle = value === "none" ? "" : value;
    setHealthCattle(nextCattle);
    const cattle = cattleOptions.find((option) => option.id === nextCattle);
    if (cattle?.section_id) setHealthSection(cattle.section_id);
  }

  function openVaccinationExpense(vaccination: Vaccination) {
    router.push(financialExpenseHref({
      description: `Vacunación: ${vaccination.vaccine_name}`,
      sectionId: vaccination.section_id || undefined,
      cattleId: vaccination.cattle_id || undefined,
    }));
  }

  function openHealthExpense(event: HealthEvent) {
    router.push(financialExpenseHref({
      description: `Sanidad: ${event.description}`,
      sectionId: event.section_id || undefined,
      cattleId: event.cattle_id || undefined,
    }));
  }

  function openVaccinationInventory(vaccination: Vaccination) {
    router.push(inventoryUseHref({
      sectionId: vaccination.section_id || undefined,
      cattleId: vaccination.cattle_id || undefined,
      itemName: vaccination.vaccine_name,
      date: vaccination.date_applied.slice(0, 10),
      notes: `Vacunación: ${vaccination.vaccine_name}`,
    }));
  }

  function openHealthInventory(event: HealthEvent) {
    router.push(inventoryUseHref({
      sectionId: event.section_id || undefined,
      cattleId: event.cattle_id || undefined,
      itemName: event.description,
      date: event.date_occurred.slice(0, 10),
      notes: `Sanidad: ${event.type} — ${event.description}`,
    }));
  }

  async function saveVaccination() {
    if (readOnly || !vaxName) return;
    setSaving(true);
    try {
      const isNewVaccination = !editingVaccinationId;
      const inventoryUsePath = inventoryUseHref({
        sectionId: vaxSection || undefined,
        cattleId: vaxCattle || undefined,
        itemName: vaxName,
        date: vaxDate,
        notes: `Vacunación: ${vaxName}`,
      });
      const payload = {
        ...(editingVaccinationId ? { id: editingVaccinationId } : {}),
        vaccineName: vaxName,
        sectionId: vaxSection || null,
        cattleId: vaxCattle || null,
        headCount: Number(vaxCount) || 1,
        dateApplied: dateInputToIso(vaxDate),
        nextDue: vaxNextDue ? dateInputToIso(vaxNextDue) || null : null,
        appliedBy: vaxBy || null,
        batchNumber: vaxBatch || null,
        notes: vaxNotes || null,
      };
      const signature = JSON.stringify(payload);
      if (isNewVaccination && (!vaccinationAttempt.current || vaccinationAttempt.current.signature !== signature)) {
        vaccinationAttempt.current = { key: createIdempotencyKey(), signature };
      }
      const result = await sendJsonResult("/api/vaccinations", editingVaccinationId ? "PUT" : "POST", payload,
        isNewVaccination ? { idempotencyKey: vaccinationAttempt.current!.key } : undefined);
      if (result.ok) {
        if (isNewVaccination) vaccinationAttempt.current = null;
        toast.success(isNewVaccination ? "Vacunacion registrada" : "Vacunacion actualizada", isNewVaccination ? {
          action: {
            label: "Descontar insumo",
            onClick: () => router.push(inventoryUsePath),
          },
        } : undefined);
        setSheetOpen(false);
        resetVaccinationForm();
        await loadData();
      } else {
        toast.error(result.error || (editingVaccinationId ? "No se pudo actualizar la vacunacion" : "No se pudo registrar la vacunacion"), result.code === "operational_idempotency_migration_required" ? {
          action: { label: "Abrir diagnóstico", onClick: () => router.push("/gestion/campo") },
        } : undefined);
      }
    } catch {
      toast.error(editingVaccinationId ? "No se pudo actualizar la vacunacion" : "No se pudo registrar la vacunacion");
    } finally {
      setSaving(false);
    }
  }

  async function deleteVaccination(id: string) {
    if (readOnly) return;
    const result = await sendJsonResult("/api/vaccinations", "DELETE", { id });
    if (result.ok) {
      toast.success("Vacunacion eliminada");
      await loadData();
    } else {
      toast.error(result.error || "No se pudo eliminar la vacunacion");
    }
  }

  async function saveHealthEvent() {
    if (readOnly || !healthDesc.trim()) return;
    setSaving(true);
    try {
      const isNewHealthEvent = !editingHealthId;
      const payload = {
        ...(editingHealthId ? { id: editingHealthId } : {}),
        type: healthType,
        description: healthDesc,
        sectionId: healthSection || null,
        cattleId: healthCattle || null,
        headCount: Number(healthCount) || 1,
        dateOccurred: dateInputToIso(healthDate),
        veterinarian: healthVet || null,
        notes: healthNotes || null,
      };
      const signature = JSON.stringify(payload);
      if (isNewHealthEvent && (!healthAttempt.current || healthAttempt.current.signature !== signature)) {
        healthAttempt.current = { key: createIdempotencyKey(), signature };
      }
      const result = await sendJsonResult("/api/health", editingHealthId ? "PUT" : "POST", payload,
        isNewHealthEvent ? { idempotencyKey: healthAttempt.current!.key } : undefined);
      if (result.ok) {
        if (isNewHealthEvent) healthAttempt.current = null;
        toast.success(editingHealthId ? "Evento de salud actualizado" : "Evento de salud registrado");
        setSheetOpen(false);
        resetHealthForm();
        await loadData();
      } else {
        toast.error(result.error || (editingHealthId ? "No se pudo actualizar el evento" : "No se pudo registrar el evento"), result.code === "operational_idempotency_migration_required" ? {
          action: { label: "Abrir diagnóstico", onClick: () => router.push("/gestion/campo") },
        } : undefined);
      }
    } catch {
      toast.error(editingHealthId ? "No se pudo actualizar el evento" : "No se pudo registrar el evento");
    } finally {
      setSaving(false);
    }
  }

  async function deleteHealthEvent(id: string) {
    if (readOnly) return;
    const result = await sendJsonResult("/api/health", "DELETE", { id });
    if (result.ok) {
      toast.success("Evento de salud eliminado");
      await loadData();
    } else {
      toast.error(result.error || "No se pudo eliminar el evento");
    }
  }

  async function updateHealthStatus(id: string, newStatus: string) {
    if (readOnly) return;
    const resolved = newStatus === "resolved";
    const result = await sendJsonResult("/api/health", "PUT", { id, resolved });
    if (result.ok) {
      toast.success("Estado actualizado");
      await loadData();
    } else {
      toast.error(result.error || "No se pudo actualizar el estado");
    }
  }

  // Overdue vaccinations
  const overdueVaccinations = vaccinations.filter(
    (v) => v.next_due && new Date(v.next_due) <= new Date()
  );

  function getHealthStatus(h: HealthEvent): string {
    if (h.resolved) return "resolved";
    return "pending";
  }

  if (!loaded) return <LoadingPage />;
  if (loadError) return <LoadErrorState title={readOnly ? "No hay una copia local de Sanidad" : "No se pudo cargar Sanidad"} description={readOnly ? "Sincronizá Sanidad cuando recuperes la conexión para consultarla sin conexión." : undefined} onRetry={readOnly ? undefined : loadData} />;

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[
          { label: "Produccion", href: "/produccion/hacienda" },
          { label: "Sanidad" },
        ]}
        title="Sanidad"
        description="Control sanitario, vacunaciones y eventos de salud"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={openAddVax} disabled={readOnly}>
              <Plus className="h-4 w-4 mr-1.5" />Vacunacion
            </Button>
            <Button onClick={openAddHealth} disabled={readOnly}>
              <Plus className="h-4 w-4 mr-1.5" />Evento
            </Button>
          </div>
        }
      />

      {offlineHealthSavedAt && <Alert role="status">
        <AlertDescription>Mostrando vacunaciones y eventos de salud de la copia sincronizada el {new Date(offlineHealthSavedAt).toLocaleString("es-UY")}. Las modificaciones se habilitarán al recuperar la conexión.</AlertDescription>
      </Alert>}

      {/* Overdue vaccinations alert */}
      {overdueVaccinations.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Vacunaciones vencidas</AlertTitle>
          <AlertDescription>
            Hay {overdueVaccinations.length} vacunacion{overdueVaccinations.length > 1 ? "es" : ""} con dosis vencida:{" "}
            {overdueVaccinations.map((v) => v.vaccine_name).join(", ")}.
          </AlertDescription>
        </Alert>
      )}

      {/* Vaccinations */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Vacunaciones</h2>
          <span className="text-xs text-muted-foreground">{vaccinationsTruncated ? `${vaccinations.length}+ registros visibles` : `${vaccinations.length} registros`}</span>
        </div>

        {vaccinationsTruncated && (
          <Alert className="mb-4">
            <AlertDescription>
              Se muestran solo las 100 vacunaciones más recientes. Para consultar el historial completo, descargá Vacunaciones CSV: <AuthenticatedDownloadLink href="/api/export?format=csv&table=vaccinations" filename="campoai-vacunaciones.csv" className="font-medium text-primary underline-offset-2 hover:underline">Descargar Vacunaciones CSV</AuthenticatedDownloadLink>
            </AlertDescription>
          </Alert>
        )}

        {vaccinations.length === 0 ? (
          <EmptyState
            icon={Syringe}
            title="Sin vacunaciones"
            description="Registra la primera vacunacion para mantener el control sanitario."
            actionLabel="Registrar vacunacion"
            onAction={openAddVax}
          />
        ) : (
          <div className="space-y-2">
            {vaccinations.map((v) => {
              const overdue = v.next_due && new Date(v.next_due) <= new Date();
              return (
                <div id={`sanidad-vaccination-${v.id}`} key={v.id} className={`rounded-xl border bg-card p-4 flex items-start sm:items-center gap-3 ${focusedVaccinationId === v.id ? "border-primary ring-2 ring-primary/20" : overdue ? "border-amber-500/30" : "border-border"}`}>
                  <div className="rounded-full bg-muted p-1.5 shrink-0">
                    <Syringe className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-sm">{v.vaccine_name}</span>
                      <Badge variant="outline">{v.head_count} cab.</Badge>
                      {v.sections?.name && (
                        <Badge variant="outline" className="text-blue-600 dark:text-blue-400 border-blue-500/30">
                          {v.sections.name}
                        </Badge>
                      )}
                      {v.cattle && (
                        <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                          Hacienda: {v.cattle.category} · {v.cattle.count} cab.
                        </Badge>
                      )}
                      {overdue && (
                        <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/30">
                          Vencida
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {new Date(v.date_applied).toLocaleDateString("es-AR")}
                      {v.next_due && <> · Prox: {new Date(v.next_due).toLocaleDateString("es-AR")}</>}
                      {v.applied_by && <> · {v.applied_by}</>}
                      {v.batch_number && <> · Lote: {v.batch_number}</>}
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" aria-label={`Acciones de ${v.vaccine_name}`} className="h-8 w-8 shrink-0">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditVaccination(v)}>
                        <Pencil className="mr-2 h-4 w-4" />Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openVaccinationExpense(v)}>
                        <DollarSign className="mr-2 h-4 w-4" />Registrar gasto
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => openVaccinationInventory(v)}>
                        <Package className="mr-2 h-4 w-4" />Registrar uso de insumo
                      </DropdownMenuItem>
                      <ConfirmDialog
                        trigger={<DropdownMenuItem onSelect={(event) => event.preventDefault()} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Eliminar</DropdownMenuItem>}
                        title="Eliminar vacunacion"
                        description={`Esto eliminara el registro de ${v.vaccine_name}. Esta accion no se puede deshacer.`}
                        onConfirm={() => { void deleteVaccination(v.id); }}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Health Events — Timeline layout */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Eventos de Salud</h2>
          <span className="text-xs text-muted-foreground">{healthEventsTruncated ? `${healthEvents.length}+ registros visibles` : `${healthEvents.length} registros`}</span>
        </div>

        {healthEventsTruncated && (
          <Alert className="mb-4">
            <AlertDescription>
              Se muestran solo los 100 eventos más recientes. Para consultar el historial completo, descargá Sanidad CSV: <AuthenticatedDownloadLink href="/api/export?format=csv&table=health_events" filename="campoai-sanidad.csv" className="font-medium text-primary underline-offset-2 hover:underline">Descargar Sanidad CSV</AuthenticatedDownloadLink>
            </AlertDescription>
          </Alert>
        )}

        {healthEvents.length === 0 ? (
          <EmptyState
            icon={Heart}
            title="Sin eventos de salud"
            description="Registra nacimientos, muertes, enfermedades y tratamientos."
            actionLabel="Registrar evento"
            onAction={openAddHealth}
          />
        ) : (
          <div className="space-y-3">
            {healthEvents.map((h) => {
              const Icon = HEALTH_ICON[h.type] || Stethoscope;
              const currentStatus = getHealthStatus(h);
              return (
                <div id={`sanidad-health-${h.id}`} key={h.id} className="border-l-2 border-border pl-4 ml-2">
                  <div className="flex items-start gap-3 -ml-[1.375rem]">
                    <div className="rounded-full bg-muted p-1.5 shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className={`flex-1 min-w-0 rounded-xl border bg-card p-4 ${focusedHealthId === h.id ? "border-primary ring-2 ring-primary/20" : "border-border"}`}>
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-medium text-sm">{h.description}</span>
                            <Badge variant="outline">{h.head_count} cab.</Badge>
                            {h.sections?.name && (
                              <Badge variant="outline" className="text-blue-600 dark:text-blue-400 border-blue-500/30">
                                {h.sections.name}
                              </Badge>
                            )}
                            {h.cattle && (
                              <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
                                Hacienda: {h.cattle.category} · {h.cattle.count} cab.
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {new Date(h.date_occurred).toLocaleDateString("es-AR")}
                            {h.veterinarian && <> · Vet: {h.veterinarian}</>}
                            {h.notes && <> · {h.notes}</>}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Select value={currentStatus} onValueChange={(val) => updateHealthStatus(h.id, val)}>
                            <SelectTrigger className="w-[140px] h-8 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {STATUS_OPTIONS.map((opt) => (
                                <SelectItem key={opt.value} value={opt.value}>
                                  {opt.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label={`Acciones de ${h.description}`} className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditHealth(h)}>
                                <Pencil className="mr-2 h-4 w-4" />Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openHealthExpense(h)}>
                                <DollarSign className="mr-2 h-4 w-4" />Registrar gasto
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => openHealthInventory(h)}>
                                <Package className="mr-2 h-4 w-4" />Registrar uso de insumo
                              </DropdownMenuItem>
                              <ConfirmDialog
                                trigger={<DropdownMenuItem onSelect={(event) => event.preventDefault()} className="text-destructive"><Trash2 className="mr-2 h-4 w-4" />Eliminar</DropdownMenuItem>}
                                title="Eliminar evento de salud"
                                description={`Esto eliminara el evento "${h.description}". Esta accion no se puede deshacer.`}
                                onConfirm={() => { void deleteHealthEvent(h.id); }}
                              />
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Sheet for forms */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { if (open) { setSheetOpen(true); return; } requestSheetClose(); }}>
        <SheetContent className="overflow-y-auto">
          {sheetMode === "add-vax" && (
            <>
              <SheetHeader>
                <SheetTitle>{editingVaccinationId ? "Editar vacunacion" : "Registrar vacunacion"}</SheetTitle>
                <SheetDescription>{editingVaccinationId ? "Corrige el registro sin perder el historial sanitario." : "Registra una nueva vacunacion aplicada a la hacienda."}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="space-y-2">
                  <Label>Vacuna</Label>
                  <Select value={vaxName} onValueChange={setVaxName}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {vaxName && !VACCINES.includes(vaxName) && <SelectItem value={vaxName}>{vaxName}</SelectItem>}
                      {VACCINES.map((v) => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Seccion</Label>
                  <Select value={vaxSection || "none"} onValueChange={changeVaxSection}>
                    <SelectTrigger><SelectValue placeholder="Toda la hacienda" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Toda la hacienda</SelectItem>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Hacienda <span className="text-muted-foreground">(opcional)</span></Label>
                  <Select value={vaxCattle || "none"} onValueChange={changeVaxCattle}>
                    <SelectTrigger><SelectValue placeholder="Toda la hacienda" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin lote específico</SelectItem>
                      {cattleOptions.map((cattle) => (
                        <SelectItem key={cattle.id} value={cattle.id}>
                          {cattle.category} · {cattle.count} cab.{cattle.breed ? ` · ${cattle.breed}` : ""}{cattle.sections?.name ? ` · ${cattle.sections.name}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Cabezas vacunadas</Label>
                  <Input type="number" value={vaxCount} onChange={(e) => setVaxCount(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Fecha aplicacion</Label>
                  <Input type="date" value={vaxDate} onChange={(e) => setVaxDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Proxima dosis</Label>
                  <Input type="date" value={vaxNextDue} onChange={(e) => setVaxNextDue(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Aplicado por</Label>
                  <Input value={vaxBy} onChange={(e) => setVaxBy(e.target.value)} placeholder="Nombre" />
                </div>
                <div className="space-y-2">
                  <Label>Lote</Label>
                  <Input value={vaxBatch} onChange={(e) => setVaxBatch(e.target.value)} placeholder="Numero de lote" />
                </div>
                <div className="space-y-2">
                  <Label>Notas</Label>
                  <Input value={vaxNotes} onChange={(e) => setVaxNotes(e.target.value)} placeholder="Observaciones..." />
                </div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={requestSheetClose} disabled={saving}>Cancelar</Button>
                <Button onClick={saveVaccination} disabled={readOnly || saving}>
                  {saving ? "Guardando..." : editingVaccinationId ? "Guardar cambios" : "Registrar vacunacion"}
                </Button>
              </SheetFooter>
            </>
          )}
          {sheetMode === "add-health" && (
            <>
              <SheetHeader>
                <SheetTitle>{editingHealthId ? "Editar evento de salud" : "Registrar evento de salud"}</SheetTitle>
                <SheetDescription>{editingHealthId ? "Corrige el evento sin perder el historial sanitario." : "Registra nacimientos, muertes, enfermedades y otros eventos."}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="space-y-2">
                  <Label>Tipo</Label>
                  <Select value={healthType} onValueChange={setHealthType}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {HEALTH_TYPES.map((t) => (
                        <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Descripcion</Label>
                  <Input value={healthDesc} onChange={(e) => setHealthDesc(e.target.value)} placeholder="Que paso?" />
                </div>
                <div className="space-y-2">
                  <Label>Seccion</Label>
                  <Select value={healthSection || "none"} onValueChange={changeHealthSection}>
                    <SelectTrigger><SelectValue placeholder="General" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">General</SelectItem>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Hacienda <span className="text-muted-foreground">(opcional)</span></Label>
                  <Select value={healthCattle || "none"} onValueChange={changeHealthCattle}>
                    <SelectTrigger><SelectValue placeholder="General / varios lotes" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">General / varios lotes</SelectItem>
                      {cattleOptions.map((cattle) => (
                        <SelectItem key={cattle.id} value={cattle.id}>
                          {cattle.category} · {cattle.count} cab.{cattle.breed ? ` · ${cattle.breed}` : ""}{cattle.sections?.name ? ` · ${cattle.sections.name}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Cabezas afectadas</Label>
                  <Input type="number" value={healthCount} onChange={(e) => setHealthCount(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Fecha</Label>
                  <Input type="date" value={healthDate} onChange={(e) => setHealthDate(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>Veterinario</Label>
                  <Input value={healthVet} onChange={(e) => setHealthVet(e.target.value)} placeholder="Nombre" />
                </div>
                <div className="space-y-2">
                  <Label>Notas</Label>
                  <Input value={healthNotes} onChange={(e) => setHealthNotes(e.target.value)} placeholder="Observaciones adicionales..." />
                </div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={requestSheetClose} disabled={saving}>Cancelar</Button>
                <Button onClick={saveHealthEvent} disabled={readOnly || !healthDesc.trim() || saving}>
                  {saving ? "Guardando..." : editingHealthId ? "Guardar cambios" : "Registrar evento"}
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

export default function SanidadPage() {
  return <Suspense fallback={<LoadingPage />}><SanidadPageContent /></Suspense>;
}
