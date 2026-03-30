"use client";

import { useState, useEffect, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { Input } from "@/components/Input";
import { EmptyState } from "@/components/EmptyState";

// ─── Types ──────────────────────────────────

interface Cattle {
  id: string;
  section_id: string | null;
  category: string;
  breed: string | null;
  count: number;
  tag_range: string | null;
  ear_tag: string | null;
  health_status: string;
  weight_kg: number | null;
  vaccination_status: string;
  reproductive_status: string | null;
  origin: string;
  notes: string | null;
  sections?: { name: string } | null;
}

interface SectionWithCattle {
  id: string;
  name: string;
  size_hectares: number | null;
  capacity: number | null;
  color: string;
  water_status: string;
  pasture_status: string;
  notes: string | null;
  padron_id: string | null;
  padrones?: { id: string; padron_code: string; department_name: string } | null;
  cattle: Cattle[];
}

// ─── Constants ──────────────────────────────

const CATEGORIES = ["vaca", "toro", "novillo", "vaquillona", "ternero", "ternera", "caballo", "yegua", "oveja"];
const BREEDS = ["Angus", "Hereford", "Braford", "Brangus", "Holando", "Criolla", "Cruza", "Otra"];
const SECTION_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

const CAT_ICON: Record<string, string> = {
  vaca: "🐄", toro: "🐂", ternero: "🐃", ternera: "🐃",
  novillo: "🐮", vaquillona: "🐮", caballo: "🐴", yegua: "🐴", oveja: "🐑",
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

export default function HaciendaPage() {
  const { sections: baseSections, refreshSections } = useFarm();
  const [sections, setSections] = useState<SectionWithCattle[]>([]);
  const [formMode, setFormMode] = useState<"none" | "add-section" | "edit-section" | "add-cattle" | "edit-cattle">("none");
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

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

  const loadSectionsWithCattle = useCallback(async () => {
    try {
      const res = await fetch("/api/sections");
      if (res.ok) setSections(await res.json());
    } catch (e) {
      console.error("Load sections error:", e);
    }
  }, []);

  useEffect(() => {
    loadSectionsWithCattle();
  }, [loadSectionsWithCattle]);

  async function onRefresh() {
    await loadSectionsWithCattle();
    await refreshSections();
  }

  function resetSectionForm() {
    setSecName(""); setSecHa(""); setSecCap(""); setSecColor("#22c55e");
    setSecWater("bueno"); setSecPasture("bueno"); setSecNotes("");
    setEditId(null);
  }

  function resetCattleForm() {
    setCatSection(""); setCatCategory("vaca"); setCatBreed(""); setCatCount("1");
    setCatWeight(""); setCatEarTag(""); setCatOrigin("propio"); setCatVaxStatus("pendiente");
    setCatRepro(""); setCatHealth("healthy"); setCatNotes("");
    setEditId(null);
  }

  function startEditSection(s: SectionWithCattle) {
    setSecName(s.name); setSecHa(s.size_hectares?.toString() || "");
    setSecCap(s.capacity?.toString() || ""); setSecColor(s.color);
    setSecWater(s.water_status); setSecPasture(s.pasture_status);
    setSecNotes(s.notes || ""); setEditId(s.id);
    setFormMode("edit-section");
  }

  function startEditCattle(c: Cattle) {
    setCatSection(c.section_id || ""); setCatCategory(c.category);
    setCatBreed(c.breed || ""); setCatCount(c.count.toString());
    setCatWeight(c.weight_kg?.toString() || ""); setCatEarTag(c.ear_tag || "");
    setCatOrigin(c.origin || "propio"); setCatVaxStatus(c.vaccination_status || "pendiente");
    setCatRepro(c.reproductive_status || ""); setCatHealth(c.health_status || "healthy");
    setCatNotes(c.notes || ""); setEditId(c.id);
    setFormMode("edit-cattle");
  }

  function closeForm() { setFormMode("none"); resetSectionForm(); resetCattleForm(); }

  async function saveSection() {
    if (!secName.trim()) return;
    setSaving(true);
    const payload = {
      name: secName, sizeHectares: secHa ? Number(secHa) : null,
      capacity: secCap ? Number(secCap) : null, color: secColor,
      waterStatus: secWater, pastureStatus: secPasture, notes: secNotes || null,
    };
    if (formMode === "edit-section" && editId) {
      await fetch("/api/sections", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editId, ...payload }) });
    } else {
      await fetch("/api/sections", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload) });
    }
    closeForm(); setSaving(false); await onRefresh();
  }

  async function saveCattle() {
    if (!catSection) return;
    setSaving(true);
    const payload = {
      sectionId: catSection, category: catCategory, breed: catBreed || null,
      count: Number(catCount) || 1, weightKg: catWeight ? Number(catWeight) : null,
      earTag: catEarTag || null, origin: catOrigin, vaccinationStatus: catVaxStatus,
      reproductiveStatus: catRepro || null, healthStatus: catHealth,
      notes: catNotes || null,
    };
    if (formMode === "edit-cattle" && editId) {
      await fetch("/api/cattle", { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editId, ...payload }) });
    } else {
      await fetch("/api/cattle", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload) });
    }
    closeForm(); setSaving(false); await onRefresh();
  }

  async function deleteSection(id: string) {
    await fetch("/api/sections", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    await onRefresh();
  }

  async function deleteCattle(id: string) {
    await fetch("/api/cattle", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    await onRefresh();
  }

  const isSecForm = formMode === "add-section" || formMode === "edit-section";
  const isCatForm = formMode === "add-cattle" || formMode === "edit-cattle";
  const isEditing = formMode.startsWith("edit");

  return (
    <div className="space-y-6">
      {/* Section management */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Secciones / Potreros</h3>
          <button onClick={() => { resetSectionForm(); setFormMode("add-section"); }} className="btn-primary text-xs">
            + Agregar seccion
          </button>
        </div>

        {isSecForm && (
          <div className="card p-4 mb-4 space-y-3 border-emerald-500/20">
            <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
              {isEditing ? "Editar seccion" : "Nueva seccion"}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input label="Nombre" value={secName} onChange={setSecName} placeholder="Ej: Norte" />
              <Input label="Hectareas" value={secHa} onChange={setSecHa} placeholder="100" type="number" />
              <Input label="Capacidad (cabezas)" value={secCap} onChange={setSecCap} placeholder="500" type="number" />
              <div>
                <label className="input-label">Color</label>
                <div className="flex gap-1.5">
                  {SECTION_COLORS.map((c) => (
                    <button key={c} onClick={() => setSecColor(c)}
                      className={`w-7 h-7 rounded-full border-2 transition-all ${secColor === c ? "border-white scale-110" : "border-zinc-700"}`}
                      style={{ backgroundColor: c }} />
                  ))}
                </div>
              </div>
              <Select label="Agua" value={secWater} onChange={setSecWater} options={[["bueno", "Bueno"], ["bajo", "Bajo"], ["seco", "Seco"], ["inundado", "Inundado"]]} />
              <Select label="Pasto" value={secPasture} onChange={setSecPasture} options={[["bueno", "Bueno"], ["sobrepastoreado", "Sobrepastoreado"], ["seco", "Seco"], ["creciendo", "Creciendo"]]} />
            </div>
            <Input label="Notas" value={secNotes} onChange={setSecNotes} placeholder="Observaciones..." />
            <div className="flex gap-2">
              <button onClick={saveSection} disabled={!secName.trim() || saving} className="btn-primary text-sm">
                {saving ? "Guardando..." : isEditing ? "Guardar cambios" : "Crear seccion"}
              </button>
              <button onClick={closeForm} className="btn-ghost text-sm">Cancelar</button>
            </div>
          </div>
        )}

        {sections.length === 0 ? (
          <EmptyState icon="📍" message="Sin secciones — Agrega tu primera seccion para empezar." />
        ) : (
          <div className="space-y-2">
            {sections.map((s) => (
              <div key={s.id} className="card p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: s.color }} />
                    <span className="font-medium truncate">{s.name}</span>
                    <span className="text-emerald-400 font-bold tabular-nums shrink-0">
                      {s.cattle.reduce((sum, c) => sum + c.count, 0)} cab.
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button onClick={() => startEditSection(s)} className="text-zinc-500 hover:text-emerald-400 text-xs transition-colors">
                      Editar
                    </button>
                    <button onClick={() => deleteSection(s.id)} className="text-zinc-600 hover:text-red-400 text-xs transition-colors">
                      Eliminar
                    </button>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2 ml-5">
                  {s.padrones && <span className="tag text-xs font-mono">📍 {s.padrones.padron_code}</span>}
                  {s.size_hectares && <span className="tag text-xs">{s.size_hectares} ha</span>}
                  {s.capacity && <span className="tag text-xs">cap. {s.capacity}</span>}
                  <span className="tag tag-blue text-xs">💧 {s.water_status}</span>
                  <span className="tag tag-green text-xs">🌿 {s.pasture_status}</span>
                </div>
                {s.notes && <p className="text-xs text-zinc-500 mt-1 ml-5">📝 {s.notes}</p>}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Cattle management */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Hacienda</h3>
          <button onClick={() => { resetCattleForm(); setFormMode("add-cattle"); }} disabled={sections.length === 0} className="btn-primary text-xs disabled:opacity-40">
            + Registrar hacienda
          </button>
        </div>

        {isCatForm && (
          <div className="card p-4 mb-4 space-y-3 border-emerald-500/20">
            <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
              {isEditing ? "Editar hacienda" : "Nueva hacienda"}
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Select label="Seccion" value={catSection} onChange={setCatSection}
                options={sections.map((s) => [s.id, s.name])} placeholder="Elegir seccion..." />
              <Select label="Categoria" value={catCategory} onChange={setCatCategory}
                options={CATEGORIES.map((c) => [c, c.charAt(0).toUpperCase() + c.slice(1)])} />
              <Select label="Raza" value={catBreed} onChange={setCatBreed}
                options={BREEDS.map((b) => [b, b])} placeholder="Elegir raza..." />
              <Input label="Cantidad" value={catCount} onChange={setCatCount} type="number" placeholder="1" />
              <Input label="Peso promedio (kg)" value={catWeight} onChange={setCatWeight} type="number" placeholder="350" />
              <Input label="Caravana" value={catEarTag} onChange={setCatEarTag} placeholder="001-050" />
              <Select label="Origen" value={catOrigin} onChange={setCatOrigin}
                options={[["propio", "Propio"], ["comprado", "Comprado"], ["transferido", "Transferido"]]} />
              <Select label="Estado vacunacion" value={catVaxStatus} onChange={setCatVaxStatus}
                options={[["al_dia", "Al dia"], ["pendiente", "Pendiente"], ["vencida", "Vencida"]]} />
              <Select label="Estado reproductivo" value={catRepro} onChange={setCatRepro}
                options={[["", "N/A"], ["prenada", "Preñada"], ["lactando", "Lactando"], ["servicio", "En servicio"], ["vacia", "Vacia"]]} />
              <Select label="Estado sanitario" value={catHealth} onChange={setCatHealth}
                options={[["healthy", "Sano"], ["enfermo", "Enfermo"], ["tratamiento", "En tratamiento"], ["cuarentena", "Cuarentena"]]} />
            </div>
            <Input label="Notas" value={catNotes} onChange={setCatNotes} placeholder="Observaciones..." />
            <div className="flex gap-2">
              <button onClick={saveCattle} disabled={!catSection || saving} className="btn-primary text-sm">
                {saving ? "Guardando..." : isEditing ? "Guardar cambios" : "Registrar"}
              </button>
              <button onClick={closeForm} className="btn-ghost text-sm">Cancelar</button>
            </div>
          </div>
        )}

        {/* Cattle list — card layout for mobile, table for desktop */}
        {sections.flatMap((s) => s.cattle).length === 0 ? (
          <EmptyState icon="🐮" message="Sin hacienda — Registra tu primera hacienda para empezar el seguimiento." />
        ) : (
          <>
            {/* Mobile: card list */}
            <div className="sm:hidden space-y-2">
              {sections.flatMap((s) =>
                s.cattle.map((c) => (
                  <div key={c.id} className="card p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                        <span className="text-sm font-medium">{CAT_ICON[c.category] || "🐮"} {c.count} {c.category}</span>
                        {c.breed && <span className="text-zinc-500 text-xs">({c.breed})</span>}
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => startEditCattle(c)} className="text-zinc-500 hover:text-emerald-400 text-xs">Editar</button>
                        <button onClick={() => deleteCattle(c.id)} className="text-zinc-600 hover:text-red-400 text-xs">✕</button>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <span className="tag text-xs">{s.name}</span>
                      {c.weight_kg && <span className="tag text-xs">{c.weight_kg} kg</span>}
                      {(c.ear_tag || c.tag_range) && <span className="tag text-xs font-mono">{c.ear_tag || c.tag_range}</span>}
                      <span className={`tag text-xs ${c.vaccination_status === "al_dia" ? "tag-green" : c.vaccination_status === "vencida" ? "tag-red" : "tag-amber"}`}>
                        vax: {c.vaccination_status === "al_dia" ? "Al dia" : c.vaccination_status === "vencida" ? "Vencida" : "Pendiente"}
                      </span>
                      {c.health_status !== "healthy" && <span className="tag tag-red text-xs">{c.health_status}</span>}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Desktop: table */}
            <div className="hidden sm:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                    <th className="pb-2 pr-3">Seccion</th>
                    <th className="pb-2 pr-3">Categoria</th>
                    <th className="pb-2 pr-3">Raza</th>
                    <th className="pb-2 pr-3 text-right">Cant.</th>
                    <th className="pb-2 pr-3 text-right">Peso</th>
                    <th className="pb-2 pr-3">Caravana</th>
                    <th className="pb-2 pr-3">Vacunas</th>
                    <th className="pb-2 pr-3">Repro.</th>
                    <th className="pb-2 pr-3">Salud</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {sections.flatMap((s) =>
                    s.cattle.map((c) => (
                      <tr key={c.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/50">
                        <td className="py-2 pr-3">
                          <span className="flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                            {s.name}
                          </span>
                        </td>
                        <td className="py-2 pr-3">{CAT_ICON[c.category] || "🐮"} {c.category}</td>
                        <td className="py-2 pr-3 text-zinc-400">{c.breed || "—"}</td>
                        <td className="py-2 pr-3 text-right tabular-nums font-medium">{c.count}</td>
                        <td className="py-2 pr-3 text-right tabular-nums text-zinc-400">{c.weight_kg ? `${c.weight_kg} kg` : "—"}</td>
                        <td className="py-2 pr-3 text-zinc-400 font-mono text-xs">{c.ear_tag || c.tag_range || "—"}</td>
                        <td className="py-2 pr-3">
                          <span className={`tag text-xs ${
                            c.vaccination_status === "al_dia" ? "tag-green" :
                            c.vaccination_status === "vencida" ? "tag-red" : "tag-amber"
                          }`}>
                            {c.vaccination_status === "al_dia" ? "Al dia" : c.vaccination_status === "vencida" ? "Vencida" : "Pendiente"}
                          </span>
                        </td>
                        <td className="py-2 pr-3 text-zinc-400 text-xs">{c.reproductive_status || "—"}</td>
                        <td className="py-2 pr-3">
                          {c.health_status !== "healthy" ? (
                            <span className="tag tag-red text-xs">{c.health_status}</span>
                          ) : (
                            <span className="text-emerald-500 text-xs">✓</span>
                          )}
                        </td>
                        <td className="py-2">
                          <div className="flex gap-2">
                            <button onClick={() => startEditCattle(c)} className="text-zinc-500 hover:text-emerald-400 text-xs">Editar</button>
                            <button onClick={() => deleteCattle(c.id)} className="text-zinc-600 hover:text-red-400 text-xs">✕</button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
