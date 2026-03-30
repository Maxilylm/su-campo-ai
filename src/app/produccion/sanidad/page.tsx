"use client";

import { useState, useEffect, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { Input } from "@/components/Input";
import { EmptyState } from "@/components/EmptyState";

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

const HEALTH_ICON: Record<string, string> = {
  nacimiento: "🐣", muerte: "💀", enfermedad: "🤒", lesion: "🩹",
  tratamiento: "💊", revision: "🩺", desparasitacion: "💉", destete: "🍼", castrado: "✂️",
};

// ─── Select Component ───────────────────────

function Select({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; options: string[][]; placeholder?: string;
}) {
  return (
    <div>
      <label className="input-label">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-field">
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(([val, lbl]) => (
          <option key={val} value={val}>{lbl}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Page Component ─────────────────────────

export default function SanidadPage() {
  const { sections } = useFarm();
  const [vaccinations, setVaccinations] = useState<Vaccination[]>([]);
  const [healthEvents, setHealthEvents] = useState<HealthEvent[]>([]);
  const [showAddVax, setShowAddVax] = useState(false);
  const [showAddHealth, setShowAddHealth] = useState(false);
  const [saving, setSaving] = useState(false);

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
    setShowAddVax(false);
    setVaxNotes(""); setVaxBatch(""); setVaxBy("");
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
    setShowAddHealth(false);
    setHealthDesc(""); setHealthNotes(""); setHealthVet("");
    setSaving(false);
    await loadData();
  }

  async function toggleResolved(id: string, resolved: boolean) {
    await fetch("/api/health", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, resolved: !resolved }),
    });
    await loadData();
  }

  return (
    <div className="space-y-8">
      {/* Vaccinations */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">💉 Vacunaciones</h3>
          <button onClick={() => setShowAddVax(!showAddVax)} className="btn-primary text-xs">+ Registrar vacunacion</button>
        </div>

        {showAddVax && (
          <div className="card p-4 mb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Select label="Vacuna" value={vaxName} onChange={setVaxName}
                options={VACCINES.map((v) => [v, v])} />
              <Select label="Seccion" value={vaxSection} onChange={setVaxSection}
                options={sections.map((s) => [s.id, s.name])} placeholder="Toda la hacienda" />
              <Input label="Cabezas vacunadas" value={vaxCount} onChange={setVaxCount} type="number" />
              <Input label="Fecha aplicacion" value={vaxDate} onChange={setVaxDate} type="date" />
              <Input label="Proxima dosis" value={vaxNextDue} onChange={setVaxNextDue} type="date" />
              <Input label="Aplicado por" value={vaxBy} onChange={setVaxBy} placeholder="Nombre" />
              <Input label="Lote" value={vaxBatch} onChange={setVaxBatch} placeholder="Numero de lote" />
            </div>
            <Input label="Notas" value={vaxNotes} onChange={setVaxNotes} placeholder="Observaciones..." />
            <div className="flex gap-2">
              <button onClick={addVaccination} disabled={saving} className="btn-primary text-sm">
                {saving ? "Guardando..." : "Registrar vacunacion"}
              </button>
              <button onClick={() => setShowAddVax(false)} className="btn-ghost text-sm">Cancelar</button>
            </div>
          </div>
        )}

        {vaccinations.length === 0 ? (
          <EmptyState icon="💉" message="Sin vacunaciones — Registra la primera vacunacion para mantener el control sanitario." />
        ) : (
          <div className="space-y-2">
            {vaccinations.map((v) => {
              const overdue = v.next_due && new Date(v.next_due) <= new Date();
              return (
                <div key={v.id} className={`card p-3 flex items-start sm:items-center gap-3 ${overdue ? "border-amber-500/30" : ""}`}>
                  <span className="text-lg shrink-0">💉</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-sm">{v.vaccine_name}</span>
                      <span className="tag text-xs">{v.head_count} cab.</span>
                      {v.sections?.name && <span className="tag tag-blue text-xs">{v.sections.name}</span>}
                      {overdue && <span className="tag tag-amber text-xs">Vencida</span>}
                    </div>
                    <div className="text-xs text-zinc-500 mt-0.5">
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

      {/* Health Events */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">🏥 Eventos de Salud</h3>
          <button onClick={() => setShowAddHealth(!showAddHealth)} className="btn-primary text-xs">+ Registrar evento</button>
        </div>

        {showAddHealth && (
          <div className="card p-4 mb-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Select label="Tipo" value={healthType} onChange={setHealthType}
                options={HEALTH_TYPES.map((t) => [t.value, `${HEALTH_ICON[t.value] || ""} ${t.label}`])} />
              <Select label="Seccion" value={healthSection} onChange={setHealthSection}
                options={sections.map((s) => [s.id, s.name])} placeholder="General" />
              <Input label="Cabezas afectadas" value={healthCount} onChange={setHealthCount} type="number" />
              <Input label="Fecha" value={healthDate} onChange={setHealthDate} type="date" />
              <Input label="Veterinario" value={healthVet} onChange={setHealthVet} placeholder="Nombre" />
            </div>
            <Input label="Descripcion" value={healthDesc} onChange={setHealthDesc} placeholder="Que paso?" />
            <Input label="Notas" value={healthNotes} onChange={setHealthNotes} placeholder="Observaciones adicionales..." />
            <div className="flex gap-2">
              <button onClick={addHealthEvent} disabled={!healthDesc.trim() || saving} className="btn-primary text-sm">
                {saving ? "Guardando..." : "Registrar evento"}
              </button>
              <button onClick={() => setShowAddHealth(false)} className="btn-ghost text-sm">Cancelar</button>
            </div>
          </div>
        )}

        {healthEvents.length === 0 ? (
          <EmptyState icon="🏥" message="Sin eventos de salud — Registra nacimientos, muertes, enfermedades y tratamientos." />
        ) : (
          <div className="space-y-2">
            {healthEvents.map((h) => (
              <div key={h.id} className={`card p-3 flex items-start sm:items-center gap-3 ${!h.resolved ? "border-red-500/20" : ""}`}>
                <span className="text-lg shrink-0">{HEALTH_ICON[h.type] || "🏥"}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-sm">{h.description}</span>
                    <span className="tag text-xs">{h.head_count} cab.</span>
                    {h.sections?.name && <span className="tag tag-blue text-xs">{h.sections.name}</span>}
                    {!h.resolved && <span className="tag tag-red text-xs">Pendiente</span>}
                    {h.resolved && <span className="tag tag-green text-xs">Resuelto</span>}
                  </div>
                  <div className="text-xs text-zinc-500 mt-0.5">
                    {new Date(h.date_occurred).toLocaleDateString("es-AR")}
                    {h.veterinarian && <> · Vet: {h.veterinarian}</>}
                    {h.notes && <> · {h.notes}</>}
                  </div>
                </div>
                <button onClick={() => toggleResolved(h.id, h.resolved)}
                  className={`text-xs px-2 py-1 rounded transition-colors ${h.resolved ? "text-zinc-500 hover:text-amber-400" : "text-emerald-400 hover:text-emerald-300"}`}>
                  {h.resolved ? "Reabrir" : "Resolver"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
