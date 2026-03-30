"use client";

import { useState, useEffect, useCallback } from "react";
import { EmptyState } from "@/components/EmptyState";

// ─── Types ──────────────────────────────────

interface Activity {
  id: string;
  type: string;
  description: string;
  raw_message: string | null;
  message_type: string;
  created_at: string;
}

// ─── Constants ──────────────────────────────

const ACT_ICON: Record<string, string> = {
  movement: "🔄", count_update: "📊", health: "🏥", note: "📝", setup: "⚙️", registration: "📋",
};

// ─── Page Component ─────────────────────────

export default function RegistroPage() {
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  const loadActivities = useCallback(async () => {
    try {
      const res = await fetch("/api/activities?limit=50");
      if (res.ok) setActivities(await res.json());
    } catch (e) {
      console.error("Load activities error:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadActivities();
  }, [loadActivities]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="text-zinc-500 text-sm animate-pulse">Cargando registro...</div>
      </div>
    );
  }

  if (activities.length === 0) {
    return <EmptyState icon="📋" message="Sin actividad — Las actividades se registran automaticamente." />;
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
