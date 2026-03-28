"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface Section {
  id: string;
  name: string;
  size_hectares: number | null;
  capacity: number | null;
  color: string;
  cattle: CattleGroup[];
}

interface CattleGroup {
  id: string;
  category: string;
  count: number;
  breed: string | null;
  health_status: string;
  notes: string | null;
}

interface Activity {
  id: string;
  type: string;
  description: string;
  raw_message: string | null;
  message_type: string;
  reported_by: string | null;
  created_at: string;
}

interface Farm {
  id: string;
  name: string;
  owner_phone: string;
  total_hectares: number | null;
}

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
  timestamp: Date;
}

const CATEGORY_ICONS: Record<string, string> = {
  vaca: "🐄",
  toro: "🐂",
  ternero: "🐃",
  ternera: "🐃",
  novillo: "🐮",
  vaquillona: "🐮",
  caballo: "🐴",
  oveja: "🐑",
};

const ACTIVITY_ICONS: Record<string, string> = {
  movement: "🔄",
  count_update: "📊",
  health: "🏥",
  note: "📝",
  setup: "⚙️",
  registration: "📋",
};

export default function Dashboard() {
  const [farm, setFarm] = useState<Farm | null>(null);
  const [farmId, setFarmId] = useState<string>("");
  const [sections, setSections] = useState<Section[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"map" | "activity" | "chat">("map");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [setupMode, setSetupMode] = useState(false);
  const [setupPhone, setSetupPhone] = useState("");
  const [setupName, setSetupName] = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async (fId: string) => {
    try {
      const [sectRes, actRes] = await Promise.all([
        fetch(`/api/sections?farmId=${fId}`),
        fetch(`/api/activities?farmId=${fId}&limit=50`),
      ]);
      if (sectRes.ok) setSections(await sectRes.json());
      if (actRes.ok) setActivities(await actRes.json());
    } catch (e) {
      console.error("Load error:", e);
    }
  }, []);

  // Load farm on mount
  useEffect(() => {
    async function init() {
      // Check localStorage for saved farm ID
      const saved = localStorage.getItem("campo_farm_id");
      if (saved) {
        setFarmId(saved);
        // Verify it exists
        const res = await fetch(`/api/sections?farmId=${saved}`);
        if (res.ok) {
          setFarm({ id: saved, name: "Mi Campo", owner_phone: "", total_hectares: null });
          await loadData(saved);
          setLoading(false);
          return;
        }
      }
      setSetupMode(true);
      setLoading(false);
    }
    init();
  }, [loadData]);

  // Auto-refresh every 30s
  useEffect(() => {
    if (!farmId) return;
    const interval = setInterval(() => loadData(farmId), 30000);
    return () => clearInterval(interval);
  }, [farmId, loadData]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  async function handleSetup() {
    if (!setupPhone.trim()) return;
    // Create farm via chat API with a setup message
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        farmId: "setup",
        message: `CREATE_FARM:${setupName || "Mi Campo"}:${setupPhone}`,
      }),
    });

    // Actually, let's create via a dedicated setup - just create directly
    // For MVP, we'll use the Supabase client through a setup endpoint
    const setupRes = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: setupName || "Mi Campo",
        phone: setupPhone,
      }),
    });

    if (setupRes.ok) {
      const data = await setupRes.json();
      setFarmId(data.id);
      setFarm(data);
      localStorage.setItem("campo_farm_id", data.id);
      setSetupMode(false);
      await loadData(data.id);
    }
  }

  async function sendChat() {
    if (!chatInput.trim() || chatLoading || !farmId) return;

    const userMsg: ChatMessage = {
      role: "user",
      text: chatInput,
      timestamp: new Date(),
    };
    setChatMessages((prev) => [...prev, userMsg]);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ farmId, message: userMsg.text }),
      });

      const data = await res.json();
      const aiMsg: ChatMessage = {
        role: "assistant",
        text: data.response || data.error || "Sin respuesta",
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, aiMsg]);

      // Refresh data if it was an update
      if (data.intent === "update" || data.intent === "setup") {
        await loadData(farmId);
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Error de conexion. Intentá de nuevo.", timestamp: new Date() },
      ]);
    } finally {
      setChatLoading(false);
    }
  }

  // Computed stats
  const totalCattle = sections.reduce(
    (sum, s) => sum + s.cattle.reduce((cs, c) => cs + c.count, 0),
    0
  );
  const totalHectares = sections.reduce(
    (sum, s) => sum + (s.size_hectares || 0),
    0
  );
  const categoryBreakdown = sections.reduce(
    (acc, s) => {
      for (const c of s.cattle) {
        acc[c.category] = (acc[c.category] || 0) + c.count;
      }
      return acc;
    },
    {} as Record<string, number>
  );

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl mb-4">🐄</div>
          <div className="text-zinc-400">Cargando CampoAI...</div>
        </div>
      </main>
    );
  }

  if (setupMode) {
    return (
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h1 className="text-4xl font-bold tracking-tight mb-2">
              🐄 <span className="text-emerald-400">Campo</span>AI
            </h1>
            <p className="text-zinc-400">
              Gestion ganadera inteligente por WhatsApp
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-800 bg-zinc-900/50 p-6 space-y-4">
            <h2 className="text-lg font-semibold">Configurar tu campo</h2>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                Nombre del campo
              </label>
              <input
                type="text"
                value={setupName}
                onChange={(e) => setSetupName(e.target.value)}
                placeholder="Ej: Estancia La Gloria"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                Tu numero de WhatsApp
              </label>
              <input
                type="tel"
                value={setupPhone}
                onChange={(e) => setSetupPhone(e.target.value)}
                placeholder="+5491112345678"
                className="w-full rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm"
              />
              <p className="text-xs text-zinc-500 mt-1">
                Con este numero vas a poder mandar mensajes por WhatsApp
              </p>
            </div>

            <button
              onClick={handleSetup}
              disabled={!setupPhone.trim()}
              className="w-full py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold transition-colors text-sm"
            >
              Crear mi campo
            </button>

            {farmId && (
              <div className="mt-4">
                <label className="block text-xs font-semibold uppercase tracking-wider text-zinc-400 mb-2">
                  O ingresa un Farm ID existente
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="UUID del farm"
                    onChange={(e) => setFarmId(e.target.value)}
                    className="flex-1 rounded-lg border border-zinc-800 bg-zinc-900 px-4 py-2.5 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 text-sm font-mono"
                  />
                  <button
                    onClick={() => {
                      localStorage.setItem("campo_farm_id", farmId);
                      window.location.reload();
                    }}
                    className="px-4 py-2.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm font-medium"
                  >
                    Conectar
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            🐄 <span className="text-emerald-400">Campo</span>AI
          </h1>
          <p className="text-zinc-500 text-sm">{farm?.name || "Mi Campo"}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => loadData(farmId)}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-400 transition-colors"
          >
            ↻ Actualizar
          </button>
          <button
            onClick={() => {
              localStorage.removeItem("campo_farm_id");
              window.location.reload();
            }}
            className="px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-400 transition-colors"
          >
            Cambiar campo
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Cabezas" value={totalCattle} icon="🐮" color="emerald" />
        <StatCard label="Secciones" value={sections.length} icon="📍" color="blue" />
        <StatCard label="Hectareas" value={totalHectares} icon="🌾" color="amber" />
        <StatCard
          label="Actividades hoy"
          value={
            activities.filter(
              (a) =>
                new Date(a.created_at).toDateString() === new Date().toDateString()
            ).length
          }
          icon="📋"
          color="purple"
        />
      </div>

      {/* Category breakdown */}
      {Object.keys(categoryBreakdown).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {Object.entries(categoryBreakdown)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, count]) => (
              <div
                key={cat}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900 border border-zinc-800 text-sm"
              >
                <span>{CATEGORY_ICONS[cat] || "🐮"}</span>
                <span className="text-zinc-300 font-medium">{count}</span>
                <span className="text-zinc-500">{cat}</span>
              </div>
            ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-zinc-900 border border-zinc-800 mb-6">
        {(
          [
            ["map", "📍 Secciones"],
            ["activity", "📋 Actividad"],
            ["chat", "💬 Chat AI"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
              tab === key
                ? "bg-emerald-600 text-white"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Sections Map Tab */}
      {tab === "map" && (
        <div className="space-y-4">
          {sections.length === 0 ? (
            <div className="text-center py-12 rounded-2xl border border-zinc-800 bg-zinc-900/50">
              <div className="text-4xl mb-3">📍</div>
              <h3 className="text-lg font-semibold mb-2">Sin secciones todavia</h3>
              <p className="text-zinc-400 text-sm mb-4">
                Usa el chat para agregar secciones, o manda un WhatsApp:
              </p>
              <code className="px-3 py-1.5 rounded-lg bg-zinc-800 text-emerald-400 text-sm">
                &quot;Agregar potrero Norte de 100 hectareas&quot;
              </code>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sections.map((section) => {
                const headCount = section.cattle.reduce(
                  (sum, c) => sum + c.count,
                  0
                );
                const utilization = section.capacity
                  ? Math.round((headCount / section.capacity) * 100)
                  : null;

                return (
                  <div
                    key={section.id}
                    className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-5 hover:border-zinc-700 transition-colors"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="font-semibold text-zinc-100 flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: section.color }}
                        />
                        {section.name}
                      </h3>
                      <span className="text-2xl font-bold text-emerald-400 font-mono">
                        {headCount}
                      </span>
                    </div>

                    {section.size_hectares && (
                      <div className="text-xs text-zinc-500 mb-2">
                        {section.size_hectares} ha
                        {utilization !== null && (
                          <span
                            className={`ml-2 px-1.5 py-0.5 rounded text-xs ${
                              utilization > 90
                                ? "bg-red-500/20 text-red-400"
                                : utilization > 70
                                  ? "bg-amber-500/20 text-amber-400"
                                  : "bg-emerald-500/20 text-emerald-400"
                            }`}
                          >
                            {utilization}% capacidad
                          </span>
                        )}
                      </div>
                    )}

                    {section.cattle.length > 0 ? (
                      <div className="space-y-1.5 mt-3">
                        {section.cattle.map((c) => (
                          <div
                            key={c.id}
                            className="flex items-center justify-between text-sm"
                          >
                            <span className="flex items-center gap-1.5 text-zinc-400">
                              {CATEGORY_ICONS[c.category] || "🐮"}
                              {c.category}
                              {c.breed && (
                                <span className="text-zinc-600 text-xs">
                                  ({c.breed})
                                </span>
                              )}
                            </span>
                            <div className="flex items-center gap-2">
                              {c.health_status !== "healthy" && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/20 text-red-400">
                                  {c.health_status}
                                </span>
                              )}
                              <span className="font-mono font-medium text-zinc-200">
                                {c.count}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-600 mt-3 italic">
                        Sin hacienda registrada
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Activity Tab */}
      {tab === "activity" && (
        <div className="space-y-2">
          {activities.length === 0 ? (
            <div className="text-center py-12 rounded-2xl border border-zinc-800 bg-zinc-900/50">
              <div className="text-4xl mb-3">📋</div>
              <h3 className="text-lg font-semibold mb-2">Sin actividad todavia</h3>
              <p className="text-zinc-400 text-sm">
                Las actividades se registran automaticamente cuando mandas mensajes
              </p>
            </div>
          ) : (
            activities.map((act) => (
              <div
                key={act.id}
                className="flex items-start gap-3 rounded-lg border border-zinc-800/50 bg-zinc-900/30 p-3"
              >
                <span className="text-lg mt-0.5">
                  {ACTIVITY_ICONS[act.type] || "📌"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200">{act.description}</p>
                  {act.raw_message && (
                    <p className="text-xs text-zinc-500 mt-1 truncate">
                      {act.message_type === "audio" ? "🎤 " : ""}
                      &quot;{act.raw_message}&quot;
                    </p>
                  )}
                </div>
                <div className="text-xs text-zinc-600 whitespace-nowrap">
                  {new Date(act.created_at).toLocaleDateString("es-AR", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Chat Tab */}
      {tab === "chat" && (
        <div className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/50 overflow-hidden" style={{ height: "500px" }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatMessages.length === 0 && (
              <div className="text-center py-8">
                <div className="text-3xl mb-3">💬</div>
                <p className="text-zinc-400 text-sm mb-4">
                  Chatea con CampoAI — igual que por WhatsApp
                </p>
                <div className="flex flex-wrap gap-2 justify-center">
                  {[
                    "Agregar potrero Norte de 80 hectareas",
                    "Registrar 50 vacas Angus en Norte",
                    "¿Cuantas cabezas hay en total?",
                    "Mover 10 terneros del Norte al Sur",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => {
                        setChatInput(suggestion);
                      }}
                      className="px-3 py-1.5 rounded-full bg-zinc-800 border border-zinc-700 text-zinc-400 text-xs hover:border-emerald-500/50 hover:text-emerald-400 transition-colors"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {chatMessages.map((msg, i) => (
              <div
                key={i}
                className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    msg.role === "user"
                      ? "bg-emerald-600 text-white rounded-br-sm"
                      : "bg-zinc-800 text-zinc-200 rounded-bl-sm"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-zinc-800 text-zinc-400 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm">
                  <span className="animate-pulse">Procesando...</span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Input */}
          <div className="border-t border-zinc-800 p-3 flex gap-2">
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendChat()}
              placeholder="Escribi un mensaje..."
              className="flex-1 rounded-xl border border-zinc-700 bg-zinc-800 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
            />
            <button
              onClick={sendChat}
              disabled={!chatInput.trim() || chatLoading}
              className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
            >
              Enviar
            </button>
          </div>
        </div>
      )}
    </main>
  );
}

function StatCard({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: number;
  icon: string;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    emerald: "text-emerald-400",
    blue: "text-blue-400",
    amber: "text-amber-400",
    purple: "text-purple-400",
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
      <div className="flex items-center gap-2 mb-1">
        <span>{icon}</span>
        <span className="text-xs text-zinc-500 uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className={`text-2xl font-bold font-mono ${colorMap[color]}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}
