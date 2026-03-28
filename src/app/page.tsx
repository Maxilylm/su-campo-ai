"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { getSupabaseBrowser } from "@/lib/supabase";

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
  const [userEmail, setUserEmail] = useState("");
  const [sections, setSections] = useState<Section[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"map" | "activity" | "chat">("map");
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const loadData = useCallback(async () => {
    try {
      const [sectRes, actRes] = await Promise.all([
        fetch("/api/sections"),
        fetch("/api/activities?limit=50"),
      ]);
      if (sectRes.ok) setSections(await sectRes.json());
      if (actRes.ok) setActivities(await actRes.json());
    } catch (e) {
      console.error("Load error:", e);
    }
  }, []);

  useEffect(() => {
    async function init() {
      const supabase = getSupabaseBrowser();
      const { data: { user } } = await supabase.auth.getUser();
      if (user?.email) setUserEmail(user.email);
      await loadData();
      setLoading(false);
    }
    init();
  }, [loadData]);

  // Auto-refresh every 30s
  useEffect(() => {
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  // Scroll chat to bottom
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages]);

  async function handleLogout() {
    const supabase = getSupabaseBrowser();
    await supabase.auth.signOut();
    window.location.href = "/login";
  }

  async function sendChat() {
    if (!chatInput.trim() || chatLoading) return;

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
        body: JSON.stringify({ message: userMsg.text }),
      });

      const data = await res.json();
      const aiMsg: ChatMessage = {
        role: "assistant",
        text: data.response || data.error || "Sin respuesta",
        timestamp: new Date(),
      };
      setChatMessages((prev) => [...prev, aiMsg]);

      if (data.intent === "update" || data.intent === "setup") {
        await loadData();
      }
    } catch {
      setChatMessages((prev) => [
        ...prev,
        { role: "assistant", text: "Error de conexion. Intenta de nuevo.", timestamp: new Date() },
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
          <div className="text-5xl mb-4 animate-pulse">🐄</div>
          <div className="text-zinc-400 text-sm">Cargando CampoAI...</div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex-1 w-full max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <header className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="text-emerald-400">Campo</span>AI
          </h1>
          <p className="text-zinc-500 text-xs mt-0.5">{userEmail}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadData}
            className="px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-xs text-zinc-400 transition-colors border border-zinc-700/50"
          >
            ↻ Actualizar
          </button>
          <button
            onClick={handleLogout}
            className="px-3 py-1.5 rounded-lg bg-zinc-800/80 hover:bg-zinc-700 text-xs text-zinc-400 transition-colors border border-zinc-700/50"
          >
            Salir
          </button>
        </div>
      </header>

      {/* Stats grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Cabezas" value={totalCattle} icon="🐮" accent="emerald" />
        <StatCard label="Secciones" value={sections.length} icon="📍" accent="blue" />
        <StatCard label="Hectareas" value={totalHectares} icon="🌾" accent="amber" />
        <StatCard
          label="Actividades hoy"
          value={
            activities.filter(
              (a) => new Date(a.created_at).toDateString() === new Date().toDateString()
            ).length
          }
          icon="📋"
          accent="purple"
        />
      </div>

      {/* Category pills */}
      {Object.keys(categoryBreakdown).length > 0 && (
        <div className="flex flex-wrap gap-2 mb-6">
          {Object.entries(categoryBreakdown)
            .sort((a, b) => b[1] - a[1])
            .map(([cat, count]) => (
              <div
                key={cat}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-zinc-900/80 border border-zinc-800 text-sm"
              >
                <span>{CATEGORY_ICONS[cat] || "🐮"}</span>
                <span className="text-zinc-200 font-medium tabular-nums">{count}</span>
                <span className="text-zinc-500">{cat}</span>
              </div>
            ))}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-zinc-900/80 border border-zinc-800 mb-6">
        {(
          [
            ["map", "Secciones"],
            ["activity", "Actividad"],
            ["chat", "Chat AI"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-medium transition-all ${
              tab === key
                ? "bg-emerald-600 text-white shadow-lg shadow-emerald-600/20"
                : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/50"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* === Sections Tab === */}
      {tab === "map" && (
        <div>
          {sections.length === 0 ? (
            <EmptyState
              icon="📍"
              title="Sin secciones todavia"
              description="Usa el chat para agregar secciones a tu campo."
              example="Agregar potrero Norte de 100 hectareas"
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sections.map((section) => {
                const headCount = section.cattle.reduce((sum, c) => sum + c.count, 0);
                const utilization = section.capacity
                  ? Math.round((headCount / section.capacity) * 100)
                  : null;

                return (
                  <div
                    key={section.id}
                    className="group rounded-xl border border-zinc-800 bg-zinc-900/40 p-5 hover:border-zinc-700 hover:bg-zinc-900/60 transition-all"
                  >
                    {/* Section header */}
                    <div className="flex items-center justify-between mb-4">
                      <h3 className="font-semibold text-zinc-100 flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-full ring-2 ring-offset-1 ring-offset-zinc-900"
                          style={{ backgroundColor: section.color, boxShadow: `0 0 8px ${section.color}40` }}
                        />
                        {section.name}
                      </h3>
                      <span className="text-2xl font-bold text-emerald-400 tabular-nums">
                        {headCount}
                      </span>
                    </div>

                    {/* Section meta */}
                    {(section.size_hectares || utilization !== null) && (
                      <div className="flex items-center gap-2 text-xs text-zinc-500 mb-3">
                        {section.size_hectares && <span>{section.size_hectares} ha</span>}
                        {utilization !== null && (
                          <span
                            className={`px-1.5 py-0.5 rounded ${
                              utilization > 90
                                ? "bg-red-500/15 text-red-400"
                                : utilization > 70
                                  ? "bg-amber-500/15 text-amber-400"
                                  : "bg-emerald-500/15 text-emerald-400"
                            }`}
                          >
                            {utilization}% cap.
                          </span>
                        )}
                      </div>
                    )}

                    {/* Cattle list */}
                    {section.cattle.length > 0 ? (
                      <div className="space-y-1.5 border-t border-zinc-800/50 pt-3">
                        {section.cattle.map((c) => (
                          <div
                            key={c.id}
                            className="flex items-center justify-between text-sm"
                          >
                            <span className="flex items-center gap-1.5 text-zinc-400">
                              {CATEGORY_ICONS[c.category] || "🐮"}
                              <span>{c.category}</span>
                              {c.breed && (
                                <span className="text-zinc-600 text-xs">({c.breed})</span>
                              )}
                            </span>
                            <div className="flex items-center gap-2">
                              {c.health_status !== "healthy" && (
                                <span className="text-xs px-1.5 py-0.5 rounded bg-red-500/15 text-red-400">
                                  {c.health_status}
                                </span>
                              )}
                              <span className="tabular-nums font-medium text-zinc-200">
                                {c.count}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-600 border-t border-zinc-800/50 pt-3 italic">
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

      {/* === Activity Tab === */}
      {tab === "activity" && (
        <div className="space-y-2">
          {activities.length === 0 ? (
            <EmptyState
              icon="📋"
              title="Sin actividad todavia"
              description="Las actividades se registran cuando mandas mensajes por el chat."
            />
          ) : (
            activities.map((act) => (
              <div
                key={act.id}
                className="flex items-start gap-3 rounded-lg border border-zinc-800/50 bg-zinc-900/30 p-3.5 hover:bg-zinc-900/50 transition-colors"
              >
                <span className="text-lg mt-0.5 shrink-0">
                  {ACTIVITY_ICONS[act.type] || "📌"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-zinc-200 leading-relaxed">{act.description}</p>
                  {act.raw_message && (
                    <p className="text-xs text-zinc-500 mt-1 truncate">
                      {act.message_type === "audio" ? "🎤 " : ""}
                      &quot;{act.raw_message}&quot;
                    </p>
                  )}
                </div>
                <div className="text-xs text-zinc-600 whitespace-nowrap tabular-nums">
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

      {/* === Chat Tab === */}
      {tab === "chat" && (
        <div className="flex flex-col rounded-2xl border border-zinc-800 bg-zinc-900/40 overflow-hidden" style={{ height: "520px" }}>
          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {chatMessages.length === 0 && (
              <div className="text-center py-10">
                <div className="text-4xl mb-3">💬</div>
                <p className="text-zinc-400 text-sm mb-5">
                  Chatea con CampoAI para gestionar tu campo
                </p>
                <div className="flex flex-wrap gap-2 justify-center max-w-md mx-auto">
                  {[
                    "Agregar potrero Norte de 80 hectareas",
                    "Registrar 50 vacas Angus en Norte",
                    "¿Cuantas cabezas hay en total?",
                    "Mover 10 terneros del Norte al Sur",
                  ].map((suggestion) => (
                    <button
                      key={suggestion}
                      onClick={() => setChatInput(suggestion)}
                      className="px-3 py-1.5 rounded-full bg-zinc-800 border border-zinc-700/50 text-zinc-400 text-xs hover:border-emerald-500/50 hover:text-emerald-400 transition-colors"
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
                      ? "bg-emerald-600 text-white rounded-br-md"
                      : "bg-zinc-800 text-zinc-200 rounded-bl-md"
                  }`}
                >
                  {msg.text}
                </div>
              </div>
            ))}

            {chatLoading && (
              <div className="flex justify-start">
                <div className="bg-zinc-800 text-zinc-400 rounded-2xl rounded-bl-md px-4 py-2.5 text-sm">
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
              className="flex-1 rounded-xl border border-zinc-700/50 bg-zinc-800/80 px-4 py-2.5 text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
            />
            <button
              onClick={sendChat}
              disabled={!chatInput.trim() || chatLoading}
              className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
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
  accent,
}: {
  label: string;
  value: number;
  icon: string;
  accent: string;
}) {
  const accentMap: Record<string, string> = {
    emerald: "text-emerald-400",
    blue: "text-blue-400",
    amber: "text-amber-400",
    purple: "text-purple-400",
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-4 hover:bg-zinc-900/60 transition-colors">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-base">{icon}</span>
        <span className="text-xs text-zinc-500 uppercase tracking-wider font-medium">
          {label}
        </span>
      </div>
      <div className={`text-2xl font-bold tabular-nums ${accentMap[accent]}`}>
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function EmptyState({
  icon,
  title,
  description,
  example,
}: {
  icon: string;
  title: string;
  description: string;
  example?: string;
}) {
  return (
    <div className="text-center py-16 rounded-2xl border border-zinc-800 bg-zinc-900/30">
      <div className="text-4xl mb-3">{icon}</div>
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-zinc-400 text-sm mb-4 max-w-sm mx-auto">{description}</p>
      {example && (
        <code className="px-3 py-1.5 rounded-lg bg-zinc-800 text-emerald-400 text-sm">
          &quot;{example}&quot;
        </code>
      )}
    </div>
  );
}
