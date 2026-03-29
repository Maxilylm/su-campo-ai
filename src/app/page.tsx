"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";
import { getSupabaseBrowser } from "@/lib/supabase";

const FarmMap = dynamic(() => import("@/components/FarmMap"), { ssr: false });

// ─── Types ──────────────────────────────────────

interface Farm {
  id: string;
  name: string;
  total_hectares: number | null;
  location: string | null;
}

interface Section {
  id: string;
  name: string;
  size_hectares: number | null;
  capacity: number | null;
  color: string;
  water_status: string;
  pasture_status: string;
  notes: string | null;
  cattle: Cattle[];
}

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

interface Activity {
  id: string;
  type: string;
  description: string;
  raw_message: string | null;
  message_type: string;
  created_at: string;
}

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

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

// ─── Constants ──────────────────────────────────

const CATEGORIES = ["vaca", "toro", "novillo", "vaquillona", "ternero", "ternera", "caballo", "yegua", "oveja"];
const BREEDS = ["Angus", "Hereford", "Braford", "Brangus", "Holando", "Criolla", "Cruza", "Otra"];
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
const SECTION_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

const CAT_ICON: Record<string, string> = {
  vaca: "🐄", toro: "🐂", ternero: "🐃", ternera: "🐃",
  novillo: "🐮", vaquillona: "🐮", caballo: "🐴", yegua: "🐴", oveja: "🐑",
};

const HEALTH_ICON: Record<string, string> = {
  nacimiento: "🐣", muerte: "💀", enfermedad: "🤒", lesion: "🩹",
  tratamiento: "💊", revision: "🩺", desparasitacion: "💉", destete: "🍼", castrado: "✂️",
};

const ACT_ICON: Record<string, string> = {
  movement: "🔄", count_update: "📊", health: "🏥", note: "📝", setup: "⚙️", registration: "📋",
};

// ─── Main Component ─────────────────────────────

type Tab = "overview" | "hacienda" | "sanidad" | "mapa" | "registro" | "chat";

export default function Dashboard() {
  const [userEmail, setUserEmail] = useState("");
  const [farm, setFarm] = useState<Farm | null>(null);
  const [noFarm, setNoFarm] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [vaccinations, setVaccinations] = useState<Vaccination[]>([]);
  const [healthEvents, setHealthEvents] = useState<HealthEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("overview");

  // Setup form
  const [setupName, setSetupName] = useState("");
  const [setupHectares, setSetupHectares] = useState("");
  const [setupLocation, setSetupLocation] = useState("");

  const loadData = useCallback(async () => {
    try {
      const [sect, act, vacc, health] = await Promise.all([
        fetch("/api/sections").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/activities?limit=50").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/vaccinations").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/health").then((r) => (r.ok ? r.json() : [])),
      ]);
      setSections(sect);
      setActivities(act);
      setVaccinations(vacc);
      setHealthEvents(health);
    } catch (e) {
      console.error("Load error:", e);
    }
  }, []);

  useEffect(() => {
    async function init() {
      const supabase = getSupabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) setUserEmail(user.email);

      const res = await fetch("/api/farm");
      if (res.ok) {
        const { farm: f } = await res.json();
        if (f) {
          setFarm(f);
          await loadData();
        } else {
          setNoFarm(true);
        }
      }
      setLoading(false);
    }
    init();
  }, [loadData]);

  useEffect(() => {
    if (!farm) return;
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [farm, loadData]);

  async function handleSetup() {
    const res = await fetch("/api/farm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: setupName || "Mi Campo",
        totalHectares: setupHectares ? Number(setupHectares) : null,
        location: setupLocation || null,
      }),
    });
    if (res.ok) {
      const { farm: f } = await res.json();
      setFarm(f);
      setNoFarm(false);
    }
  }

  async function handleLogout() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  // ─── Stats ────────────────────────────
  const allCattle = sections.flatMap((s) => s.cattle);
  const totalCattle = allCattle.reduce((sum, c) => sum + c.count, 0);
  const totalHectares = sections.reduce((sum, s) => sum + (s.size_hectares || 0), 0);
  const todayActivities = activities.filter(
    (a) => new Date(a.created_at).toDateString() === new Date().toDateString()
  ).length;
  const pendingVax = vaccinations.filter(
    (v) => v.next_due && new Date(v.next_due) <= new Date()
  ).length;
  const unresolvedHealth = healthEvents.filter((h) => !h.resolved).length;

  const categoryBreakdown = allCattle.reduce((acc, c) => {
    acc[c.category] = (acc[c.category] || 0) + c.count;
    return acc;
  }, {} as Record<string, number>);

  // ─── Loading ──────────────────────────
  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-5xl mb-4 animate-pulse">🐄</div>
          <div className="text-zinc-400 text-sm">Cargando CampoAI...</div>
        </div>
      </main>
    );
  }

  // ─── Farm Setup ───────────────────────
  if (noFarm) {
    return (
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <div className="text-5xl mb-3">🐄</div>
            <h1 className="text-3xl font-bold tracking-tight">
              <span className="text-emerald-400">Campo</span>AI
            </h1>
            <p className="text-zinc-500 text-sm mt-1">Configura tu campo para empezar</p>
          </div>
          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
            <Input label="Nombre del campo" value={setupName} onChange={setSetupName} placeholder="Ej: Estancia La Gloria" />
            <Input label="Hectareas totales" value={setupHectares} onChange={setSetupHectares} placeholder="500" type="number" />
            <Input label="Ubicacion" value={setupLocation} onChange={setSetupLocation} placeholder="Ej: Tandil, Buenos Aires" />
            <button onClick={handleSetup} className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors text-sm">
              Crear mi campo
            </button>
          </div>
        </div>
      </main>
    );
  }

  // ─── Dashboard ────────────────────────
  const tabs: [Tab, string][] = [
    ["overview", "Resumen"],
    ["hacienda", "Hacienda"],
    ["sanidad", "Sanidad"],
    ["mapa", "Mapa"],
    ["registro", "Registro"],
    ["chat", "Chat AI"],
  ];

  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">
            <span className="text-emerald-400">Campo</span>AI
            <span className="text-zinc-600 text-sm sm:text-base font-normal ml-2">{farm?.name}</span>
          </h1>
          <p className="text-zinc-600 text-xs mt-0.5 truncate">{userEmail}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button onClick={loadData} className="btn-ghost">↻ Actualizar</button>
          <button onClick={handleLogout} className="btn-ghost">Salir</button>
        </div>
      </header>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <StatCard label="Cabezas" value={totalCattle} accent="emerald" />
        <StatCard label="Secciones" value={sections.length} accent="blue" />
        <StatCard label="Hectareas" value={totalHectares} accent="amber" />
        <StatCard label="Vacunas vencidas" value={pendingVax} accent={pendingVax > 0 ? "red" : "emerald"} />
        <StatCard label="Salud pendiente" value={unresolvedHealth} accent={unresolvedHealth > 0 ? "red" : "emerald"} />
      </div>

      {/* Category pills */}
      {Object.keys(categoryBreakdown).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {Object.entries(categoryBreakdown).sort((a, b) => b[1] - a[1]).map(([cat, count]) => (
            <span key={cat} className="pill">
              {CAT_ICON[cat] || "🐮"} <strong>{count}</strong> {cat}
            </span>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-zinc-900/80 border border-zinc-800 mb-6 overflow-x-auto">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-2 px-2 sm:py-2.5 sm:px-3 rounded-lg text-xs sm:text-sm font-medium transition-all whitespace-nowrap ${
              tab === key
                ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === "overview" && <OverviewTab sections={sections} activities={activities} pendingVax={pendingVax} unresolvedHealth={unresolvedHealth} />}
      {tab === "hacienda" && <HaciendaTab sections={sections} onRefresh={loadData} />}
      {tab === "sanidad" && <SanidadTab sections={sections} vaccinations={vaccinations} healthEvents={healthEvents} onRefresh={loadData} />}
      {tab === "mapa" && <FarmMap />}
      {tab === "registro" && <RegistroTab activities={activities} />}
      {tab === "chat" && <ChatTab onDataChange={loadData} />}
    </main>
  );
}

// ═══════════════════════════════════════════════
// Overview Tab
// ═══════════════════════════════════════════════

function OverviewTab({ sections, activities, pendingVax, unresolvedHealth }: {
  sections: Section[];
  activities: Activity[];
  pendingVax: number;
  unresolvedHealth: number;
}) {
  return (
    <div className="space-y-6">
      {/* Alerts */}
      {(pendingVax > 0 || unresolvedHealth > 0) && (
        <div className="space-y-2">
          {pendingVax > 0 && (
            <div className="alert-banner bg-amber-500/10 border-amber-500/20 text-amber-300">
              ⚠️ {pendingVax} vacunacion{pendingVax > 1 ? "es" : ""} vencida{pendingVax > 1 ? "s" : ""} — revisa la pestana Sanidad
            </div>
          )}
          {unresolvedHealth > 0 && (
            <div className="alert-banner bg-red-500/10 border-red-500/20 text-red-300">
              🏥 {unresolvedHealth} evento{unresolvedHealth > 1 ? "s" : ""} de salud sin resolver
            </div>
          )}
        </div>
      )}

      {/* Sections grid */}
      {sections.length === 0 ? (
        <EmptyState icon="📍" title="Sin secciones" desc="Agrega secciones desde la pestana Hacienda o usa el Chat AI." />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {sections.map((s) => {
            const headCount = s.cattle.reduce((sum, c) => sum + c.count, 0);
            const util = s.capacity ? Math.round((headCount / s.capacity) * 100) : null;
            return (
              <div key={s.id} className="card p-5">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold text-zinc-100 flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: s.color, boxShadow: `0 0 8px ${s.color}40` }} />
                    {s.name}
                  </h3>
                  <span className="text-2xl font-bold text-emerald-400 tabular-nums">{headCount}</span>
                </div>

                {/* Meta row */}
                <div className="flex flex-wrap gap-1.5 text-xs mb-3">
                  {s.size_hectares && <span className="tag">{s.size_hectares} ha</span>}
                  {util !== null && (
                    <span className={`tag ${util > 90 ? "tag-red" : util > 70 ? "tag-amber" : "tag-green"}`}>
                      {util}% cap.
                    </span>
                  )}
                  <span className={`tag ${s.water_status === "bueno" ? "tag-blue" : "tag-amber"}`}>
                    💧 {s.water_status}
                  </span>
                  <span className={`tag ${s.pasture_status === "bueno" ? "tag-green" : "tag-amber"}`}>
                    🌿 {s.pasture_status}
                  </span>
                </div>

                {/* Cattle */}
                {s.cattle.length > 0 ? (
                  <div className="space-y-1 border-t border-zinc-800/50 pt-3">
                    {s.cattle.map((c) => (
                      <div key={c.id} className="flex items-center justify-between text-sm">
                        <span className="text-zinc-400 flex items-center gap-1.5">
                          {CAT_ICON[c.category] || "🐮"} {c.category}
                          {c.breed && <span className="text-zinc-600 text-xs">({c.breed})</span>}
                        </span>
                        <div className="flex items-center gap-1.5">
                          {c.vaccination_status === "vencida" && <span className="tag tag-red text-[10px]">vax!</span>}
                          {c.health_status !== "healthy" && <span className="tag tag-red text-[10px]">{c.health_status}</span>}
                          <span className="tabular-nums font-medium text-zinc-200">{c.count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-zinc-600 border-t border-zinc-800/50 pt-3 italic">Sin hacienda</p>
                )}

                {s.notes && <p className="text-xs text-zinc-500 mt-2 italic">📝 {s.notes}</p>}
              </div>
            );
          })}
        </div>
      )}

      {/* Recent activity */}
      {activities.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">Actividad reciente</h3>
          <div className="space-y-1.5">
            {activities.slice(0, 5).map((a) => (
              <div key={a.id} className="flex items-center gap-3 text-sm py-1.5">
                <span>{ACT_ICON[a.type] || "📌"}</span>
                <span className="text-zinc-300 flex-1 truncate">{a.description}</span>
                <span className="text-zinc-600 text-xs tabular-nums">
                  {new Date(a.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Hacienda Tab (Sections + Cattle CRUD)
// ═══════════════════════════════════════════════

function HaciendaTab({ sections, onRefresh }: { sections: Section[]; onRefresh: () => Promise<void> }) {
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

  function startEditSection(s: Section) {
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
          <EmptyState icon="📍" title="Sin secciones" desc="Agrega tu primera seccion para empezar." />
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
          <EmptyState icon="🐮" title="Sin hacienda" desc="Registra tu primera hacienda para empezar el seguimiento." />
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

// ═══════════════════════════════════════════════
// Sanidad Tab (Vaccinations + Health Events)
// ═══════════════════════════════════════════════

function SanidadTab({ sections, vaccinations, healthEvents, onRefresh }: {
  sections: Section[];
  vaccinations: Vaccination[];
  healthEvents: HealthEvent[];
  onRefresh: () => Promise<void>;
}) {
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
    await onRefresh();
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
    await onRefresh();
  }

  async function toggleResolved(id: string, resolved: boolean) {
    await fetch("/api/health", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, resolved: !resolved }),
    });
    await onRefresh();
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
          <EmptyState icon="💉" title="Sin vacunaciones" desc="Registra la primera vacunacion para mantener el control sanitario." />
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
            <Input label="Descripcion" value={healthDesc} onChange={setHealthDesc} placeholder="Que paso?" required />
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
          <EmptyState icon="🏥" title="Sin eventos de salud" desc="Registra nacimientos, muertes, enfermedades y tratamientos." />
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

// ═══════════════════════════════════════════════
// Registro Tab (Activity Log)
// ═══════════════════════════════════════════════

function RegistroTab({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) {
    return <EmptyState icon="📋" title="Sin actividad" desc="Las actividades se registran automaticamente." />;
  }
  return (
    <div className="space-y-2">
      {activities.map((a) => (
        <div key={a.id} className="card p-3.5 flex items-start gap-3">
          <span className="text-lg mt-0.5 shrink-0">{ACT_ICON[a.type] || "📌"}</span>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-zinc-200 leading-relaxed">{a.description}</p>
            {a.raw_message && (
              <p className="text-xs text-zinc-500 mt-1 truncate">
                {a.message_type === "audio" ? "🎤 " : ""}&quot;{a.raw_message}&quot;
              </p>
            )}
          </div>
          <span className="text-xs text-zinc-600 whitespace-nowrap tabular-nums">
            {new Date(a.created_at).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
          </span>
        </div>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Chat Tab
// ═══════════════════════════════════════════════

function ChatTab({ onDataChange }: { onDataChange: () => Promise<void> }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load chat history on mount
  useEffect(() => {
    async function loadHistory() {
      try {
        const res = await fetch("/api/chat");
        if (res.ok) {
          const { messages: saved } = await res.json();
          if (saved && saved.length > 0) {
            setMessages(saved.map((m: { role: string; content: string }) => ({
              role: m.role as "user" | "assistant",
              text: m.content,
            })));
          }
        }
      } catch {
        // Ignore — fresh chat
      }
      setHistoryLoaded(true);
    }
    loadHistory();
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Cleanup recording timer
  useEffect(() => {
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  async function send() {
    if (!input.trim() || loading) return;
    const text = input;
    setMessages((prev) => [...prev, { role: "user", text }]);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: messages.slice(-20),
        }),
      });
      const data = await res.json();
      setMessages((prev) => [...prev, { role: "assistant", text: data.response || data.error || "Sin respuesta" }]);
      if (data.intent === "update" || data.intent === "setup") {
        onDataChange();
      }
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Error de conexion." }]);
    } finally {
      setLoading(false);
    }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : "audio/webm";
      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        setRecordingTime(0);

        const audioBlob = new Blob(chunksRef.current, { type: mimeType });
        if (audioBlob.size < 1000) return; // too short, ignore

        // Show user message
        setMessages((prev) => [...prev, { role: "user", text: "🎤 Enviando audio..." }]);
        setLoading(true);

        try {
          const formData = new FormData();
          formData.append("audio", audioBlob, "recording.webm");
          formData.append("history", JSON.stringify(messages.slice(-20)));

          const res = await fetch("/api/chat/audio", { method: "POST", body: formData });
          const data = await res.json();

          // Replace the "Enviando audio..." with the transcription
          setMessages((prev) => {
            const updated = [...prev];
            const lastUserIdx = updated.findLastIndex((m) => m.role === "user");
            if (lastUserIdx >= 0) {
              updated[lastUserIdx] = { role: "user", text: `🎤 ${data.transcription || "Audio"}` };
            }
            return [...updated, { role: "assistant", text: data.response || data.error || "Sin respuesta" }];
          });

          if (data.intent === "update" || data.intent === "setup") {
            onDataChange();
          }
        } catch {
          setMessages((prev) => [...prev, { role: "assistant", text: "Error procesando audio." }]);
        } finally {
          setLoading(false);
        }
      };

      mediaRecorder.start(250); // collect in 250ms chunks
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => setRecordingTime((t) => t + 1), 1000);
    } catch {
      // Microphone not available
      setMessages((prev) => [...prev, { role: "assistant", text: "No se pudo acceder al microfono. Verifica los permisos del navegador." }]);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    setRecording(false);
  }

  function cancelRecording() {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.ondataavailable = null;
      mediaRecorderRef.current.onstop = () => {
        mediaRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      };
      mediaRecorderRef.current.stop();
    }
    chunksRef.current = [];
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    setRecording(false);
    setRecordingTime(0);
  }

  async function clearHistory() {
    await fetch("/api/chat", { method: "DELETE" });
    setMessages([]);
  }

  function formatTime(s: number) {
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;
  }

  if (!historyLoaded) {
    return (
      <div className="flex items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900/40 py-12">
        <div className="text-zinc-500 text-sm animate-pulse">Cargando historial...</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden" style={{ height: "min(520px, 70vh)" }}>
      {/* Chat header */}
      {messages.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/50">
          <span className="text-xs text-zinc-500">{messages.length} mensajes</span>
          <button onClick={clearHistory} className="text-xs text-zinc-600 hover:text-red-400 transition-colors">
            Limpiar historial
          </button>
        </div>
      )}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-10">
            <div className="text-4xl mb-3">💬</div>
            <p className="text-zinc-400 text-sm mb-5">Habla con CampoAI en lenguaje natural</p>
            <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
              {["Agregar potrero Sur de 60 ha", "Registrar 20 vacas Angus en Norte", "¿Cuantas cabezas hay?", "Mover 10 terneros al Sur"].map((s) => (
                <button key={s} onClick={() => setInput(s)} className="px-3 py-1.5 rounded-full bg-zinc-800 border border-zinc-700/50 text-zinc-400 text-xs hover:border-emerald-500/50 hover:text-emerald-400 transition-colors">
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === "user" ? "bg-emerald-600 text-white rounded-br-md" : "bg-zinc-800 text-zinc-200 rounded-bl-md"
            }`}>
              {m.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-zinc-800 text-zinc-400 rounded-2xl rounded-bl-md px-4 py-2.5 text-sm animate-pulse">
              {recording ? "Grabando..." : "Procesando..."}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input bar */}
      <div className="border-t border-zinc-800 p-3">
        {recording ? (
          /* Recording UI */
          <div className="flex items-center gap-3">
            <button onClick={cancelRecording}
              className="p-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-400 transition-colors" title="Cancelar">
              ✕
            </button>
            <div className="flex-1 flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-sm text-red-400 tabular-nums font-mono">{formatTime(recordingTime)}</span>
              <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
                <div className="h-full bg-red-500/60 rounded-full animate-pulse" style={{ width: `${Math.min(recordingTime * 2, 100)}%` }} />
              </div>
            </div>
            <button onClick={stopRecording}
              className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-colors" title="Enviar audio">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
        ) : (
          /* Normal input */
          <div className="flex gap-2">
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Escribi un mensaje..."
              disabled={loading}
              className="flex-1 rounded-xl border border-zinc-700/50 bg-zinc-800/80 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40 disabled:opacity-40" />
            {input.trim() ? (
              <button onClick={send} disabled={loading}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors">
                Enviar
              </button>
            ) : (
              <button onClick={startRecording} disabled={loading}
                className="px-4 py-2.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 text-zinc-400 hover:text-emerald-400 disabled:opacity-40 transition-colors"
                title="Grabar audio">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Shared UI Components
// ═══════════════════════════════════════════════

function Input({ label, value, onChange, placeholder, type = "text", required }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; required?: boolean;
}) {
  return (
    <div>
      <label className="input-label">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder} required={required}
        className="input-field" />
    </div>
  );
}

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

function StatCard({ label, value, accent }: { label: string; value: number; accent: string }) {
  const map: Record<string, string> = {
    emerald: "text-emerald-400", blue: "text-blue-400", amber: "text-amber-400",
    purple: "text-purple-400", red: "text-red-400",
  };
  return (
    <div className="card p-4">
      <div className="text-xs text-zinc-500 uppercase tracking-wider font-medium mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${map[accent]}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function EmptyState({ icon, title, desc }: { icon: string; title: string; desc: string }) {
  return (
    <div className="text-center py-12 rounded-2xl border border-zinc-800 bg-zinc-900/30">
      <div className="text-4xl mb-3">{icon}</div>
      <h3 className="text-lg font-semibold mb-1">{title}</h3>
      <p className="text-zinc-400 text-sm max-w-sm mx-auto">{desc}</p>
    </div>
  );
}
