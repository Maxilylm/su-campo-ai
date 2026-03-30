"use client";

import { useState, useEffect, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
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
import { toast } from "sonner";
import {
  Syringe, Heart, Plus, AlertTriangle,
  Egg, Skull, Thermometer, Bandage, Pill, Stethoscope, Baby, Scissors,
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
  notes: string | null;
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
  sections?: { name: string } | null;
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
  { value: "in_progress", label: "En progreso" },
  { value: "resolved", label: "Resuelto" },
];

// ─── Page Component ─────────────────────────

export default function SanidadPage() {
  const { sections } = useFarm();
  const [vaccinations, setVaccinations] = useState<Vaccination[]>([]);
  const [healthEvents, setHealthEvents] = useState<HealthEvent[]>([]);
  const [saving, setSaving] = useState(false);

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<"add-vax" | "add-health">("add-vax");

  // Vax form
  const [vaxName, setVaxName] = useState("Aftosa");
  const [vaxSection, setVaxSection] = useState("");
  const [vaxCount, setVaxCount] = useState("1");
  const [vaxDate, setVaxDate] = useState(new Date().toISOString().split("T")[0]);
  const [vaxNextDue, setVaxNextDue] = useState("");
  const [vaxBy, setVaxBy] = useState("");
  const [vaxBatch, setVaxBatch] = useState("");
  const [vaxNotes, setVaxNotes] = useState("");

  // Health form
  const [healthType, setHealthType] = useState("revision");
  const [healthDesc, setHealthDesc] = useState("");
  const [healthSection, setHealthSection] = useState("");
  const [healthCount, setHealthCount] = useState("1");
  const [healthDate, setHealthDate] = useState(new Date().toISOString().split("T")[0]);
  const [healthVet, setHealthVet] = useState("");
  const [healthNotes, setHealthNotes] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [vacc, health] = await Promise.all([
        fetch("/api/vaccinations").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/health").then((r) => (r.ok ? r.json() : [])),
      ]);
      setVaccinations(vacc);
      setHealthEvents(health);
    } catch (e) {
      console.error("Load sanidad error:", e);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  function openAddVax() {
    setVaxName("Aftosa"); setVaxSection(""); setVaxCount("1");
    setVaxDate(new Date().toISOString().split("T")[0]); setVaxNextDue("");
    setVaxBy(""); setVaxBatch(""); setVaxNotes("");
    setSheetMode("add-vax"); setSheetOpen(true);
  }

  function openAddHealth() {
    setHealthType("revision"); setHealthDesc(""); setHealthSection("");
    setHealthCount("1"); setHealthDate(new Date().toISOString().split("T")[0]);
    setHealthVet(""); setHealthNotes("");
    setSheetMode("add-health"); setSheetOpen(true);
  }

  async function addVaccination() {
    if (!vaxName) return;
    setSaving(true);
    await fetch("/api/vaccinations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vaccineName: vaxName,
        sectionId: vaxSection || null,
        headCount: Number(vaxCount) || 1,
        dateApplied: vaxDate ? new Date(vaxDate).toISOString() : undefined,
        nextDue: vaxNextDue ? new Date(vaxNextDue).toISOString() : null,
        appliedBy: vaxBy || null,
        batchNumber: vaxBatch || null,
        notes: vaxNotes || null,
      }),
    });
    toast.success("Vacunacion registrada");
    setSheetOpen(false);
    setSaving(false);
    await loadData();
  }

  async function addHealthEvent() {
    if (!healthDesc.trim()) return;
    setSaving(true);
    await fetch("/api/health", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: healthType,
        description: healthDesc,
        sectionId: healthSection || null,
        headCount: Number(healthCount) || 1,
        dateOccurred: healthDate ? new Date(healthDate).toISOString() : undefined,
        veterinarian: healthVet || null,
        notes: healthNotes || null,
      }),
    });
    toast.success("Evento de salud registrado");
    setSheetOpen(false);
    setSaving(false);
    await loadData();
  }

  async function updateHealthStatus(id: string, newStatus: string) {
    const resolved = newStatus === "resolved";
    await fetch("/api/health", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, resolved }),
    });
    toast.success("Estado actualizado");
    await loadData();
  }

  // Overdue vaccinations
  const overdueVaccinations = vaccinations.filter(
    (v) => v.next_due && new Date(v.next_due) <= new Date()
  );

  function getHealthStatus(h: HealthEvent): string {
    if (h.resolved) return "resolved";
    return "pending";
  }

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
            <Button variant="outline" onClick={openAddVax}>
              <Plus className="h-4 w-4 mr-1.5" />Vacunacion
            </Button>
            <Button onClick={openAddHealth}>
              <Plus className="h-4 w-4 mr-1.5" />Evento
            </Button>
          </div>
        }
      />

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
          <span className="text-xs text-muted-foreground">{vaccinations.length} registros</span>
        </div>

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
                <div key={v.id} className={`rounded-xl border bg-card p-4 flex items-start sm:items-center gap-3 ${overdue ? "border-amber-500/30" : "border-border"}`}>
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
          <span className="text-xs text-muted-foreground">{healthEvents.length} registros</span>
        </div>

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
                <div key={h.id} className="border-l-2 border-border pl-4 ml-2">
                  <div className="flex items-start gap-3 -ml-[1.375rem]">
                    <div className="rounded-full bg-muted p-1.5 shrink-0">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div className="flex-1 min-w-0 rounded-xl border border-border bg-card p-4">
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
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {new Date(h.date_occurred).toLocaleDateString("es-AR")}
                            {h.veterinarian && <> · Vet: {h.veterinarian}</>}
                            {h.notes && <> · {h.notes}</>}
                          </div>
                        </div>
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
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          {sheetMode === "add-vax" && (
            <>
              <SheetHeader>
                <SheetTitle>Registrar vacunacion</SheetTitle>
                <SheetDescription>Registra una nueva vacunacion aplicada a la hacienda.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="space-y-2">
                  <Label>Vacuna</Label>
                  <Select value={vaxName} onValueChange={setVaxName}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {VACCINES.map((v) => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Seccion</Label>
                  <Select value={vaxSection} onValueChange={setVaxSection}>
                    <SelectTrigger><SelectValue placeholder="Toda la hacienda" /></SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
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
                <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
                <Button onClick={addVaccination} disabled={saving}>
                  {saving ? "Guardando..." : "Registrar vacunacion"}
                </Button>
              </SheetFooter>
            </>
          )}
          {sheetMode === "add-health" && (
            <>
              <SheetHeader>
                <SheetTitle>Registrar evento de salud</SheetTitle>
                <SheetDescription>Registra nacimientos, muertes, enfermedades y otros eventos.</SheetDescription>
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
                  <Select value={healthSection} onValueChange={setHealthSection}>
                    <SelectTrigger><SelectValue placeholder="General" /></SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
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
                <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
                <Button onClick={addHealthEvent} disabled={!healthDesc.trim() || saving}>
                  {saving ? "Guardando..." : "Registrar evento"}
                </Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
