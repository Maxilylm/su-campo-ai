"use client";

import { useState, useEffect, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { Input } from "@/components/Input";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";

// ─── Types ──────────────────────────────────

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
  crop_applications?: { id: string }[];
}

interface CropApplication {
  id: string;
  crop_id: string;
  type: string;
  product_name: string | null;
  dose_per_hectare: string | null;
  total_applied: string | null;
  date_applied: string | null;
  applied_by: string | null;
  weather_conditions: string | null;
  notes: string | null;
}

// ─── Constants ──────────────────────────────

const CROP_TYPES = ["soja", "trigo", "maíz", "girasol", "sorgo", "cebada", "arroz", "avena", "otro"];
const SOIL_TYPES = ["arcilloso", "arenoso", "limoso", "franco"];
const IRRIGATION_TYPES = ["secano", "pivot", "aspersión", "goteo"];
const APP_TYPES = ["fertilizante", "herbicida", "insecticida", "fungicida"];
const WEATHER_OPTIONS = ["soleado", "nublado", "lluvioso", "ventoso"];

const STATUS_COLORS: Record<string, string> = {
  planted: "tag-blue",
  growing: "tag-green",
  harvested: "tag-amber",
  failed: "tag-red",
};

const STATUS_LABELS: Record<string, string> = {
  planted: "Sembrado",
  growing: "Creciendo",
  harvested: "Cosechado",
  failed: "Fallido",
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

export default function AgriculturaPage() {
  const { sections } = useFarm();
  const [crops, setCrops] = useState<Crop[]>([]);
  const [formMode, setFormMode] = useState<"none" | "add-crop" | "edit-crop" | "add-app">("none");
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [appCropId, setAppCropId] = useState<string | null>(null);

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

  const loadCrops = useCallback(async () => {
    try {
      const res = await fetch("/api/crops");
      if (res.ok) setCrops(await res.json());
    } catch (e) {
      console.error("Load crops error:", e);
    }
  }, []);

  useEffect(() => {
    loadCrops();
  }, [loadCrops]);

  function resetCropForm() {
    setCropSection(""); setCropType("soja"); setCropVariety(""); setCropHectares("");
    setCropPlantingDate(""); setCropExpectedHarvest(""); setCropActualHarvest("");
    setCropYieldKg(""); setCropStatus("planted"); setCropSoilType("");
    setCropIrrigationType(""); setCropNotes(""); setEditId(null);
  }

  function resetAppForm() {
    setAppType("fertilizante"); setAppProduct(""); setAppDose(""); setAppTotal("");
    setAppDate(""); setAppAppliedBy(""); setAppWeather(""); setAppNotes("");
    setAppCropId(null);
  }

  function closeForm() {
    setFormMode("none"); resetCropForm(); resetAppForm();
  }

  function startEditCrop(c: Crop) {
    setCropSection(c.section_id || ""); setCropType(c.crop_type);
    setCropVariety(c.variety || ""); setCropHectares(c.planted_hectares?.toString() || "");
    setCropPlantingDate(c.planting_date || ""); setCropExpectedHarvest(c.expected_harvest || "");
    setCropActualHarvest(c.actual_harvest || ""); setCropYieldKg(c.yield_kg?.toString() || "");
    setCropStatus(c.status); setCropSoilType(c.soil_type || "");
    setCropIrrigationType(c.irrigation_type || ""); setCropNotes(c.notes || "");
    setEditId(c.id); setFormMode("edit-crop");
  }

  function startAddApp(cropId: string) {
    resetAppForm(); setAppCropId(cropId); setFormMode("add-app");
  }

  async function saveCrop() {
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
    if (formMode === "edit-crop" && editId) {
      await fetch("/api/crops", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editId, ...payload }) });
    } else {
      await fetch("/api/crops", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload) });
    }
    closeForm(); setSaving(false); await loadCrops();
  }

  async function deleteCrop(id: string) {
    await fetch("/api/crops", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    await loadCrops();
  }

  async function saveApplication() {
    if (!appCropId) return;
    setSaving(true);
    await fetch("/api/crop-applications", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cropId: appCropId,
        type: appType,
        productName: appProduct || null,
        dosePerHectare: appDose || null,
        totalApplied: appTotal || null,
        dateApplied: appDate || null,
        appliedBy: appAppliedBy || null,
        weatherConditions: appWeather || null,
        notes: appNotes || null,
      }),
    });
    closeForm(); setSaving(false); await loadCrops();
  }

  const isEditing = formMode === "edit-crop";
  const isCropForm = formMode === "add-crop" || formMode === "edit-crop";
  const isAppForm = formMode === "add-app";

  // Stats
  const totalHa = crops.reduce((sum, c) => sum + (c.planted_hectares || 0), 0);
  const activeCrops = crops.filter((c) => c.status === "planted" || c.status === "growing").length;
  const pendingHarvests = crops.filter((c) => c.expected_harvest && !c.actual_harvest && c.status !== "failed").length;

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Ha sembradas" value={totalHa} accent="emerald" />
        <StatCard label="Cultivos activos" value={activeCrops} accent="blue" />
        <StatCard label="Cosechas pendientes" value={pendingHarvests} accent="amber" />
        <StatCard label="Total cultivos" value={crops.length} accent="purple" />
      </div>

      {/* Crop management */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Cultivos</h3>
          <button onClick={() => { resetCropForm(); setFormMode("add-crop"); }} className="btn-primary text-xs">
            + Nuevo Cultivo
          </button>
        </div>

        {/* Crop form */}
        {isCropForm && (
          <div className="card p-4 mb-4 space-y-3 border-emerald-500/20">
            <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
              {isEditing ? "Editar cultivo" : "Nuevo cultivo"}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Select label="Tipo de cultivo" value={cropType} onChange={setCropType}
                options={CROP_TYPES.map((t) => [t, t.charAt(0).toUpperCase() + t.slice(1)])} />
              <Input label="Variedad" value={cropVariety} onChange={setCropVariety} placeholder="Ej: DM 46i17" />
              <Select label="Seccion" value={cropSection} onChange={setCropSection}
                options={sections.map((s) => [s.id, s.name])} placeholder="Elegir seccion..." />
              <Input label="Hectareas" value={cropHectares} onChange={setCropHectares} type="number" placeholder="100" />
              <Input label="Fecha de siembra" value={cropPlantingDate} onChange={setCropPlantingDate} type="date" />
              <Input label="Cosecha esperada" value={cropExpectedHarvest} onChange={setCropExpectedHarvest} type="date" />
              <Input label="Cosecha real" value={cropActualHarvest} onChange={setCropActualHarvest} type="date" />
              <Input label="Rendimiento (kg)" value={cropYieldKg} onChange={setCropYieldKg} type="number" placeholder="3500" />
              <Select label="Estado" value={cropStatus} onChange={setCropStatus}
                options={Object.entries(STATUS_LABELS).map(([k, v]) => [k, v])} />
              <Select label="Tipo de suelo" value={cropSoilType} onChange={setCropSoilType}
                options={SOIL_TYPES.map((t) => [t, t.charAt(0).toUpperCase() + t.slice(1)])} placeholder="Elegir..." />
              <Select label="Riego" value={cropIrrigationType} onChange={setCropIrrigationType}
                options={IRRIGATION_TYPES.map((t) => [t, t.charAt(0).toUpperCase() + t.slice(1)])} placeholder="Elegir..." />
            </div>
            <Input label="Notas" value={cropNotes} onChange={setCropNotes} placeholder="Observaciones..." />
            <div className="flex gap-2">
              <button onClick={saveCrop} disabled={saving} className="btn-primary text-sm">
                {saving ? "Guardando..." : isEditing ? "Guardar cambios" : "Crear cultivo"}
              </button>
              <button onClick={closeForm} className="btn-ghost text-sm">Cancelar</button>
            </div>
          </div>
        )}

        {/* Application form */}
        {isAppForm && (
          <div className="card p-4 mb-4 space-y-3 border-blue-500/20">
            <h4 className="text-xs font-semibold text-blue-400 uppercase tracking-wider">
              Nueva aplicacion
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Select label="Tipo" value={appType} onChange={setAppType}
                options={APP_TYPES.map((t) => [t, t.charAt(0).toUpperCase() + t.slice(1)])} />
              <Input label="Producto" value={appProduct} onChange={setAppProduct} placeholder="Ej: Glifosato" />
              <Input label="Dosis por hectarea" value={appDose} onChange={setAppDose} placeholder="2 L/ha" />
              <Input label="Total aplicado" value={appTotal} onChange={setAppTotal} placeholder="200 L" />
              <Input label="Fecha" value={appDate} onChange={setAppDate} type="date" />
              <Input label="Aplicado por" value={appAppliedBy} onChange={setAppAppliedBy} placeholder="Nombre" />
              <Select label="Clima" value={appWeather} onChange={setAppWeather}
                options={WEATHER_OPTIONS.map((w) => [w, w.charAt(0).toUpperCase() + w.slice(1)])} placeholder="Elegir..." />
            </div>
            <Input label="Notas" value={appNotes} onChange={setAppNotes} placeholder="Observaciones..." />
            <div className="flex gap-2">
              <button onClick={saveApplication} disabled={saving} className="btn-primary text-sm">
                {saving ? "Guardando..." : "Registrar aplicacion"}
              </button>
              <button onClick={closeForm} className="btn-ghost text-sm">Cancelar</button>
            </div>
          </div>
        )}

        {/* Crop cards */}
        {crops.length === 0 ? (
          <EmptyState icon="🌾" message="Sin cultivos — Agrega tu primer cultivo para empezar." />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {crops.map((c) => (
              <div key={c.id} className="card p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="font-medium truncate">
                      {c.crop_type.charAt(0).toUpperCase() + c.crop_type.slice(1)}
                    </span>
                    {c.variety && <span className="text-zinc-500 text-xs">({c.variety})</span>}
                    <span className={`tag text-xs ${STATUS_COLORS[c.status] || "tag-blue"}`}>
                      {STATUS_LABELS[c.status] || c.status}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => startAddApp(c.id)} className="text-zinc-500 hover:text-blue-400 text-xs transition-colors">
                      + Aplicacion
                    </button>
                    <button onClick={() => startEditCrop(c)} className="text-zinc-500 hover:text-emerald-400 text-xs transition-colors">
                      Editar
                    </button>
                    <button onClick={() => deleteCrop(c.id)} className="text-zinc-600 hover:text-red-400 text-xs transition-colors">
                      Eliminar
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {c.sections?.name && <span className="tag text-xs">📍 {c.sections.name}</span>}
                  {c.planted_hectares && <span className="tag text-xs">{c.planted_hectares} ha</span>}
                  {c.planting_date && <span className="tag text-xs">Siembra: {c.planting_date}</span>}
                  {c.expected_harvest && <span className="tag tag-amber text-xs">Cosecha: {c.expected_harvest}</span>}
                  {c.actual_harvest && <span className="tag tag-green text-xs">Cosechado: {c.actual_harvest}</span>}
                  {c.yield_kg != null && <span className="tag tag-green text-xs">{c.yield_kg} kg</span>}
                  {c.yield_per_hectare != null && <span className="tag text-xs">{c.yield_per_hectare} kg/ha</span>}
                  {c.soil_type && <span className="tag text-xs">Suelo: {c.soil_type}</span>}
                  {c.irrigation_type && <span className="tag tag-blue text-xs">Riego: {c.irrigation_type}</span>}
                  {c.crop_applications && c.crop_applications.length > 0 && (
                    <span className="tag tag-purple text-xs">{c.crop_applications.length} aplicaciones</span>
                  )}
                </div>
                {c.notes && <p className="text-xs text-zinc-500 mt-1">📝 {c.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
