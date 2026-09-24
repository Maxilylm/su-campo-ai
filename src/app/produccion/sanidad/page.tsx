"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { StatStrip } from "@/components/StatCard";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/produccion/Notice";
import { VaccinationList } from "@/components/produccion/sanidad/VaccinationList";
import { HealthEventList } from "@/components/produccion/sanidad/HealthEventList";
import { SanidadFormSheet } from "@/components/produccion/sanidad/SanidadFormSheet";
import { useSanidadData } from "@/components/produccion/sanidad/useSanidadData";
import type { HealthEvent, Vaccination } from "@/components/produccion/sanidad/types";
import { toast } from "sonner";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { dateInputToIso, dateInputValue, isPastCalendarDate } from "@/lib/date";
import { financialExpenseHref } from "@/lib/alerts";
import { inventoryUseHref } from "@/lib/inventory-navigation";
import {
  emptyHealthForm, emptyVaccinationForm, healthFormFrom, sanidadFormSignature, vaccinationFormFrom, withLot, withSection,
  type HealthFormValues, type SanidadFormSnapshot, type SanidadSheetMode, type VaccinationFormValues,
} from "@/lib/sanidad-form";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";
import { useUnsavedChangesWarning } from "@/lib/use-unsaved-changes-warning";
import { useOfflineAwareNavigation, useOfflineAwareReplace } from "@/lib/use-offline-aware-navigation";
import { CampoAIButton } from "@/components/CampoAIButton";
import { Plus } from "lucide-react";
import { parseLocalizedNumber } from "@/lib/number";

function SanidadPageContent() {
  const navigate = useOfflineAwareNavigation();
  const replace = useOfflineAwareReplace();
  const searchParams = useSearchParams();
  const navigationQuery = searchParams.toString();
  const { sections, userId, readOnly, offlineMode, isOnline } = useFarm();
  const offlineReadOnly = offlineMode || !isOnline;
  const {
    vaccinations, healthEvents, cattleOptions, loaded, loadError,
    vaccinationsTruncated, healthEventsTruncated, offlineHealthSavedAt, loadData,
  } = useSanidadData(offlineReadOnly, userId);
  const [saving, setSaving] = useState(false);
  const vaccinationAttempt = useRef<{ key: string; signature: string } | null>(null);
  const healthAttempt = useRef<{ key: string; signature: string } | null>(null);
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

  const [vax, setVax] = useState<VaccinationFormValues>(() => emptyVaccinationForm());
  const [health, setHealth] = useState<HealthFormValues>(() => emptyHealthForm());
  const patchVax = useCallback((patch: Partial<VaccinationFormValues>) => setVax((form) => ({ ...form, ...patch })), []);
  const patchHealth = useCallback((patch: Partial<HealthFormValues>) => setHealth((form) => ({ ...form, ...patch })), []);

  function setFormBaseline(snapshot: SanidadFormSnapshot) {
    formBaselineRef.current = sanidadFormSignature(snapshot);
  }

  function currentFormSignature() {
    return sanidadFormSignature({
      mode: sheetMode,
      vaccinationId: editingVaccinationId,
      healthId: editingHealthId,
      vaccination: vax,
      health,
    });
  }

  useUnsavedChangesWarning(sheetOpen && hasUnsavedChanges(formBaselineRef.current, currentFormSignature()));


  useEffect(() => {
    const today = dateInputValue();
    setVax((current) => current.date ? current : { ...current, date: today });
    setHealth((current) => current.date ? current : { ...current, date: today });
  }, []);

  useEffect(() => {
    if (!loaded || handledNavigationQueryRef.current === navigationQuery) return;
    const params = new URLSearchParams(navigationQuery);
    const healthId = params.get("healthId");
    const vaccinationId = params.get("vaccinationId");
    const healthEvent = healthId ? healthEvents.find((event) => event.id === healthId) : null;
    const vaccination = vaccinationId ? vaccinations.find((item) => item.id === vaccinationId) : null;
    if ((healthId && !healthEvent) || (vaccinationId && !vaccination)) return;
    if (params.get("new") === "vaccination") {
      setEditingVaccinationId(null);
      setEditingHealthId(null);
      const requestedCattleId = params.get("cattleId") || "";
      const requestedCattle = cattleOptions.find((cattle) => cattle.id === requestedCattleId);
      const nextDate = dateInputValue();
      const nextVax: VaccinationFormValues = {
        ...emptyVaccinationForm(nextDate),
        name: params.get("vaccineName") || "Aftosa",
        section: params.get("sectionId") || "",
        cattle: requestedCattleId,
        count: requestedCattle ? String(requestedCattle.count) : "1",
      };
      setVax(nextVax);
      setSheetMode("add-vax");
      setFormBaseline({ mode: "add-vax", vaccinationId: null, healthId: null, vaccination: nextVax, health: emptyHealthForm(nextDate) });
      setSheetOpen(true);
    } else if (healthEvent) {
      setFocusedHealthId(healthEvent.id);
      window.requestAnimationFrame(() => {
        document.getElementById(`sanidad-health-${healthEvent.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    } else if (vaccination) {
      setFocusedVaccinationId(vaccination.id);
      window.requestAnimationFrame(() => {
        document.getElementById(`sanidad-vaccination-${vaccination.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
    handledNavigationQueryRef.current = navigationQuery;
    if (navigationQuery) replace(window.location.pathname, { scroll: false });
  }, [cattleOptions, healthEvents, loaded, navigationQuery, replace, vaccinations]);

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
    setVax(emptyVaccinationForm(dateInputValue()));
    formBaselineRef.current = null;
  }

  function resetHealthForm() {
    healthAttempt.current = null;
    setEditingVaccinationId(null);
    setEditingHealthId(null);
    setHealth(emptyHealthForm(dateInputValue()));
    formBaselineRef.current = null;
  }

  function openAddVax() {
    resetVaccinationForm();
    setSheetMode("add-vax");
    const nextDate = dateInputValue();
    setFormBaseline({ mode: "add-vax", vaccinationId: null, healthId: null, vaccination: emptyVaccinationForm(nextDate), health: emptyHealthForm(nextDate) });
    setSheetOpen(true);
  }

  function openEditVaccination(vaccination: Vaccination) {
    const form = vaccinationFormFrom(vaccination);
    setEditingVaccinationId(vaccination.id);
    setEditingHealthId(null);
    setVax(form);
    setSheetMode("add-vax");
    setFormBaseline({ mode: "add-vax", vaccinationId: vaccination.id, healthId: null, vaccination: form, health: emptyHealthForm() });
    setSheetOpen(true);
  }

  function openAddHealth() {
    resetHealthForm();
    setSheetMode("add-health");
    const nextDate = dateInputValue();
    setFormBaseline({ mode: "add-health", vaccinationId: null, healthId: null, vaccination: emptyVaccinationForm(nextDate), health: emptyHealthForm(nextDate) });
    setSheetOpen(true);
  }

  function openEditHealth(event: HealthEvent) {
    const form = healthFormFrom(event);
    setEditingVaccinationId(null);
    setEditingHealthId(event.id);
    setHealth(form);
    setSheetMode("add-health");
    setFormBaseline({ mode: "add-health", vaccinationId: null, healthId: event.id, vaccination: emptyVaccinationForm(), health: form });
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

  function openVaccinationExpense(vaccination: Vaccination) {
    navigate(financialExpenseHref({
      description: `Vacunación: ${vaccination.vaccine_name}`,
      sectionId: vaccination.section_id || undefined,
      cattleId: vaccination.cattle_id || undefined,
    }));
  }

  function openHealthExpense(event: HealthEvent) {
    navigate(financialExpenseHref({
      description: `Sanidad: ${event.description}`,
      sectionId: event.section_id || undefined,
      cattleId: event.cattle_id || undefined,
    }));
  }

  function openVaccinationInventory(vaccination: Vaccination) {
    navigate(inventoryUseHref({
      sectionId: vaccination.section_id || undefined,
      cattleId: vaccination.cattle_id || undefined,
      itemName: vaccination.vaccine_name,
      date: vaccination.date_applied.slice(0, 10),
      notes: `Vacunación: ${vaccination.vaccine_name}`,
    }));
  }

  function openHealthInventory(event: HealthEvent) {
    navigate(inventoryUseHref({
      sectionId: event.section_id || undefined,
      cattleId: event.cattle_id || undefined,
      itemName: event.description,
      date: event.date_occurred.slice(0, 10),
      notes: `Sanidad: ${event.type} — ${event.description}`,
    }));
  }

  async function saveVaccination() {
    if (readOnly || !vax.name) return;
    setSaving(true);
    try {
      const isNewVaccination = !editingVaccinationId;
      const inventoryUsePath = inventoryUseHref({
        sectionId: vax.section || undefined,
        cattleId: vax.cattle || undefined,
        itemName: vax.name,
        date: vax.date,
        notes: `Vacunación: ${vax.name}`,
      });
      const payload = {
        ...(editingVaccinationId ? { id: editingVaccinationId } : {}),
        vaccineName: vax.name,
        sectionId: vax.section || null,
        cattleId: vax.cattle || null,
        headCount: vax.count ? parseLocalizedNumber(vax.count) : 1,
        dateApplied: dateInputToIso(vax.date),
        nextDue: vax.nextDue ? dateInputToIso(vax.nextDue) || null : null,
        appliedBy: vax.appliedBy || null,
        batchNumber: vax.batch || null,
        notes: vax.notes || null,
      };
      const signature = JSON.stringify(payload);
      if (isNewVaccination && (!vaccinationAttempt.current || vaccinationAttempt.current.signature !== signature)) {
        vaccinationAttempt.current = { key: createIdempotencyKey(), signature };
      }
      const result = await sendJsonResult("/api/vaccinations", editingVaccinationId ? "PUT" : "POST", payload,
        isNewVaccination ? { idempotencyKey: vaccinationAttempt.current!.key } : undefined);
      if (result.ok) {
        if (isNewVaccination) vaccinationAttempt.current = null;
        toast.success(isNewVaccination ? "Vacunación registrada" : "Vacunación actualizada", isNewVaccination ? {
          action: {
            label: "Descontar insumo",
            onClick: () => navigate(inventoryUsePath),
          },
        } : undefined);
        setSheetOpen(false);
        resetVaccinationForm();
        await loadData();
      } else {
        toast.error(result.error || (editingVaccinationId ? "No se pudo actualizar la vacunación. Intentá de nuevo." : "No se pudo registrar la vacunación. Intentá de nuevo."), result.code === "operational_idempotency_migration_required" ? {
          action: { label: "Abrir diagnóstico", onClick: () => navigate("/gestion/campo") },
        } : undefined);
      }
    } catch {
      toast.error(editingVaccinationId ? "No se pudo actualizar la vacunación. Intentá de nuevo." : "No se pudo registrar la vacunación. Intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteVaccination(id: string) {
    if (readOnly) return;
    const result = await sendJsonResult("/api/vaccinations", "DELETE", { id });
    if (result.ok) {
      toast.success("Vacunación eliminada");
      await loadData();
    } else {
      toast.error(result.error || "No se pudo eliminar la vacunación. Intentá de nuevo.");
    }
  }

  async function saveHealthEvent() {
    if (readOnly || !health.description.trim()) return;
    setSaving(true);
    try {
      const isNewHealthEvent = !editingHealthId;
      const payload = {
        ...(editingHealthId ? { id: editingHealthId } : {}),
        type: health.type,
        description: health.description,
        sectionId: health.section || null,
        cattleId: health.cattle || null,
        headCount: health.count ? parseLocalizedNumber(health.count) : 1,
        dateOccurred: dateInputToIso(health.date),
        veterinarian: health.veterinarian || null,
        notes: health.notes || null,
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
        toast.error(result.error || (editingHealthId ? "No se pudo actualizar el evento. Intentá de nuevo." : "No se pudo registrar el evento. Intentá de nuevo."), result.code === "operational_idempotency_migration_required" ? {
          action: { label: "Abrir diagnóstico", onClick: () => navigate("/gestion/campo") },
        } : undefined);
      }
    } catch {
      toast.error(editingHealthId ? "No se pudo actualizar el evento. Intentá de nuevo." : "No se pudo registrar el evento. Intentá de nuevo.");
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
      toast.error(result.error || "No se pudo eliminar el evento. Intentá de nuevo.");
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
      toast.error(result.error || "No se pudo actualizar el estado. Intentá de nuevo.");
    }
  }

  // Overdue by calendar day, like Pendientes and Métricas: due today is not overdue.
  const today = dateInputValue();
  const overdueVaccinations = vaccinations.filter((v) => isPastCalendarDate(v.next_due, today));
  const unresolvedEvents = healthEvents.filter((event) => !event.resolved).length;
  const sanidadAIFacts = [
    `Vacunaciones visibles: ${vaccinations.length}${vaccinationsTruncated ? "+" : ""}`,
    `Vacunaciones vencidas: ${overdueVaccinations.length}`,
    `Eventos sanitarios visibles: ${healthEvents.length}${healthEventsTruncated ? "+" : ""}`,
    `Eventos sin resolver: ${unresolvedEvents}`,
    ...vaccinations.slice(0, 20).map((vaccination) => `${vaccination.vaccine_name}: ${vaccination.head_count} cabezas${vaccination.next_due ? `, próxima ${vaccination.next_due}` : ""}${vaccination.sections?.name ? ` en ${vaccination.sections.name}` : ""}`),
    ...healthEvents.slice(0, 20).map((event) => `${event.type}: ${event.description} (${event.head_count} cabezas, ${event.resolved ? "resuelto" : "pendiente"})`),
  ];

  if (!loaded) return <LoadingPage />;
  if (loadError) return <LoadErrorState title={offlineReadOnly ? "No hay una copia local de Sanidad" : "No se pudo cargar Sanidad"} description={offlineReadOnly ? "Sincronizá Sanidad cuando recuperes la conexión para consultarla sin conexión." : undefined} onRetry={offlineReadOnly ? undefined : loadData} />;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Sanidad"
        description="Vacunaciones y eventos de salud de la hacienda."
        actions={
          <>
            <CampoAIButton
              title="Sanidad"
              facts={sanidadAIFacts}
              partial={vaccinationsTruncated || healthEventsTruncated}
              instruction="Ayudame a priorizar seguimientos sanitarios y vacunaciones vencidas; no reemplaces una evaluación veterinaria ni inventes diagnósticos."
            />
            <Button variant="outline" onClick={openAddVax} disabled={readOnly}>
              <Plus className="h-4 w-4" aria-hidden="true" />Vacunación
            </Button>
            <Button onClick={openAddHealth} disabled={readOnly}>
              <Plus className="h-4 w-4" aria-hidden="true" />Evento
            </Button>
          </>
        }
      />

      {(offlineHealthSavedAt || overdueVaccinations.length > 0) && (
        <div className="space-y-2">
          {offlineHealthSavedAt && (
            <Notice tone="offline">
              Mostrando vacunaciones y eventos de salud de la copia sincronizada el {new Date(offlineHealthSavedAt).toLocaleString("es-UY")}. Vas a poder modificarlos cuando recuperes la conexión.
            </Notice>
          )}
          {overdueVaccinations.length > 0 && (
            <Notice tone="bad" role="alert" title="Vacunaciones vencidas">
              {overdueVaccinations.length === 1 ? "Hay 1 vacunación con la dosis vencida: " : `Hay ${overdueVaccinations.length} vacunaciones con la dosis vencida: `}
              {overdueVaccinations.map((v) => v.vaccine_name).join(", ")}. Registrá la nueva aplicación cuando la hagas.
            </Notice>
          )}
        </div>
      )}

      {(vaccinations.length > 0 || healthEvents.length > 0) && (
        <StatStrip
          items={[
            { label: "Vacunaciones", value: `${vaccinations.length}${vaccinationsTruncated ? "+" : ""}` },
            { label: "Dosis vencidas", value: overdueVaccinations.length, tone: overdueVaccinations.length > 0 ? "bad" : undefined },
            { label: "Eventos de salud", value: `${healthEvents.length}${healthEventsTruncated ? "+" : ""}` },
            { label: "Sin resolver", value: unresolvedEvents, tone: unresolvedEvents > 0 ? "warn" : undefined },
          ]}
        />
      )}

      <VaccinationList
        vaccinations={vaccinations}
        truncated={vaccinationsTruncated}
        today={today}
        focusedId={focusedVaccinationId}
        onAdd={openAddVax}
        onEdit={openEditVaccination}
        onExpense={openVaccinationExpense}
        onInventory={openVaccinationInventory}
        onDelete={deleteVaccination}
      />

      <HealthEventList
        events={healthEvents}
        truncated={healthEventsTruncated}
        focusedId={focusedHealthId}
        onAdd={openAddHealth}
        onEdit={openEditHealth}
        onExpense={openHealthExpense}
        onInventory={openHealthInventory}
        onDelete={deleteHealthEvent}
        onStatusChange={updateHealthStatus}
      />

      <SanidadFormSheet
        open={sheetOpen}
        onOpenChange={(open) => { if (open) { setSheetOpen(true); return; } requestSheetClose(); }}
        mode={sheetMode}
        sections={sections}
        lots={cattleOptions}
        editingVaccination={Boolean(editingVaccinationId)}
        editingHealth={Boolean(editingHealthId)}
        vaccination={vax}
        onVaccinationChange={patchVax}
        onVaccinationSection={(value) => setVax((form) => withSection(form, value, cattleOptions))}
        onVaccinationLot={(value) => setVax((form) => withLot(form, value, cattleOptions))}
        health={health}
        onHealthChange={patchHealth}
        onHealthSection={(value) => setHealth((form) => withSection(form, value, cattleOptions))}
        onHealthLot={(value) => setHealth((form) => withLot(form, value, cattleOptions))}
        saving={saving}
        readOnly={readOnly}
        onCancel={requestSheetClose}
        onSaveVaccination={saveVaccination}
        onSaveHealth={saveHealthEvent}
      />
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
