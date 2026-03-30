"use client";

import { useState, useEffect, useCallback } from "react";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import {
  ArrowLeftRight,
  BarChart3,
  Heart,
  FileText,
  Settings,
  ClipboardList,
  Mic,
} from "lucide-react";
import { type LucideIcon } from "lucide-react";

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

const ACT_ICON: Record<string, LucideIcon> = {
  movement: ArrowLeftRight,
  count_update: BarChart3,
  health: Heart,
  note: FileText,
  setup: Settings,
  registration: ClipboardList,
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
    return <LoadingPage />;
  }

  if (activities.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader
          breadcrumbs={[
            { label: "Gestion", href: "/gestion/inventario" },
            { label: "Registro" },
          ]}
          title="Registro de actividad"
          description="Historial cronologico de todas las acciones"
        />
        <EmptyState
          icon={ClipboardList}
          title="Sin actividad"
          description="Las actividades se registran automaticamente."
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[
          { label: "Gestion", href: "/gestion/inventario" },
          { label: "Registro" },
        ]}
        title="Registro de actividad"
        description="Historial cronologico de todas las acciones"
      />

      <div>
        {activities.map((a, index) => {
          const Icon = ACT_ICON[a.type] || ClipboardList;
          const isLast = index === activities.length - 1;

          return (
            <div key={a.id} className="flex gap-4">
              <div className="flex flex-col items-center">
                <div className="rounded-full bg-muted p-2">
                  <Icon className="h-4 w-4 text-muted-foreground" />
                </div>
                {!isLast && <div className="flex-1 w-px bg-border mt-2" />}
              </div>
              <div className="flex-1 pb-6">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm text-foreground leading-relaxed">
                    {a.description}
                  </p>
                  <span className="text-xs text-muted-foreground whitespace-nowrap tabular-nums shrink-0">
                    {new Date(a.created_at).toLocaleDateString("es-AR", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                {a.raw_message && (
                  <p className="border-l-2 border-muted pl-3 italic text-muted-foreground text-xs mt-2">
                    {a.message_type === "audio" && (
                      <Mic className="inline h-3 w-3 mr-1" />
                    )}
                    &quot;{a.raw_message}&quot;
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
