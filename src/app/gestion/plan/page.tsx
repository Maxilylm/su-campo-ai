"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarCheck, CloudRain, Printer, RefreshCw, Share2, Sparkles, SprayCan, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { useFarm } from "@/contexts/FarmContext";
import { fetchWithTimeout } from "@/lib/fetch";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";
import { aiChatHandoffKey, buildOperationalChatPrompt } from "@/lib/ai-handoff";
import { dailyPlanText, type DailyPlan, type PlanItemKind, type PlanUrgency } from "@/lib/daily-plan";

const KIND_LABELS: Record<PlanItemKind, string> = {
  water: "Agua",
  move: "Rotación",
  vaccination: "Sanidad",
  task: "Tarea",
  harvest: "Cosecha",
};

const URGENCY_STYLES: Record<PlanUrgency, { label: string; className: string }> = {
  overdue: { label: "Atrasado", className: "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300" },
  today: { label: "Hoy", className: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  soon: { label: "Próximos días", className: "border-border bg-muted text-muted-foreground" },
};

function localToday(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

type PlanResponse = DailyPlan & { fieldStatusAvailable: boolean; weatherAvailable: boolean };

export default function PlanDelDiaPage() {
  const navigate = useOfflineAwareNavigation();
  const { farm, userId, offlineMode, isOnline } = useFarm();
  const offline = offlineMode || !isOnline;
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    if (offline) {
      setLoading(false);
      return;
    }
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    try {
      const res = await fetchWithTimeout(`/api/daily-plan?today=${localToday()}`, { cache: "no-store", signal: controller.signal }, 12000);
      if (!res.ok) throw new Error("daily plan request failed");
      const body = await res.json();
      if (controller.signal.aborted) return;
      setPlan(body);
      setError(false);
    } catch {
      if (!controller.signal.aborted) setError(true);
    } finally {
      if (requestRef.current === controller) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  }, [offline]);

  useEffect(() => {
    void load();
    return () => requestRef.current?.abort();
  }, [load]);
  useDataChangedRefresh(load, !offline);

  function shareWhatsApp() {
    if (!plan) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(dailyPlanText(plan, farm?.name))}`, "_blank", "noopener,noreferrer");
  }

  function askCampoAI() {
    if (!plan || !userId) return;
    try {
      window.sessionStorage.setItem(aiChatHandoffKey(userId), buildOperationalChatPrompt(
        plan.stops.flatMap((stop) => stop.items.map((item) => ({
          label: `${stop.name}: ${item.title}`,
          detail: [item.detail, item.blockedBy ? `no hoy: ${item.blockedBy}` : ""].filter(Boolean).join(" · "),
        }))),
        "Plan del día",
      ));
    } catch {
      // Storage can be blocked; the chat still opens, just without the draft.
    }
    navigate("/chat");
  }

  const header = (
    <PageHeader
      breadcrumbs={[{ label: "Gestión", href: "/gestion/inventario" }, { label: "Plan del día" }]}
      title="Plan del día"
      description="Lo que hay que hacer hoy, agrupado por potrero para recorrer el campo en orden."
      actions={plan && plan.counts.total > 0 ? (
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button variant="outline" size="sm" onClick={shareWhatsApp}><Share2 className="mr-1.5 h-4 w-4" />WhatsApp</Button>
          <Button variant="outline" size="sm" onClick={() => window.print()}><Printer className="mr-1.5 h-4 w-4" />Imprimir</Button>
          <Button size="sm" onClick={askCampoAI} disabled={!userId}><Sparkles className="mr-1.5 h-4 w-4" />Organizar con CampoAI</Button>
        </div>
      ) : undefined}
    />
  );

  if (offline) {
    return <div className="space-y-6">{header}<LoadErrorState title="El plan del día necesita conexión" description="Se arma con el clima y el estado actual de los potreros. Conectate para verlo." /></div>;
  }
  if (loading && !plan) return <LoadingPage />;
  if (error && !plan) return <div className="space-y-6">{header}<LoadErrorState title="No se pudo armar el plan del día" onRetry={() => { void load(); }} /></div>;
  if (!plan) return null;

  const dateLabel = new Date(`${plan.date}T12:00:00Z`).toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

  return (
    <div className="space-y-6">
      {header}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          <span className="font-medium capitalize text-foreground">{dateLabel}</span>
          {plan.counts.total > 0 && ` · ${plan.counts.total} ${plan.counts.total === 1 ? "tarea" : "tareas"}`}
          {plan.counts.overdue > 0 && ` · ${plan.counts.overdue} atrasadas`}
          {plan.counts.blocked > 0 && ` · ${plan.counts.blocked} frenadas por el clima`}
        </p>
        <Button variant="ghost" size="sm" onClick={() => { void load(); }} disabled={loading} className="print:hidden">
          <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Actualizar
        </Button>
      </div>

      {plan.weather ? (
        <section aria-label="Clima de hoy" className={`rounded-xl border p-4 ${plan.weather.sprayOk ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
          <p className="flex items-center gap-2 text-sm font-medium">
            <SprayCan className="h-4 w-4 shrink-0" aria-hidden />
            {plan.weather.sprayOk ? "Se puede pulverizar" : "No pulverizar hoy"}
            <span className="font-normal text-muted-foreground">— {plan.weather.sprayReason}</span>
          </p>
          {plan.weather.notes.map((note) => (
            <p key={note} className="mt-1.5 flex items-start gap-2 text-sm"><CloudRain className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{note}</p>
          ))}
        </section>
      ) : (
        <p className="text-xs text-muted-foreground">Sin pronóstico disponible: cargá la ubicación en Mi campo para sumar el clima al plan.</p>
      )}

      {!plan.fieldStatusAvailable && (
        <p role="status" className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300"><TriangleAlert className="h-4 w-4" aria-hidden />No se pudo leer el estado de los potreros; el plan no incluye rotación ni aguadas.</p>
      )}

      {plan.stops.length === 0 ? (
        <EmptyState icon={CalendarCheck} title="Día tranquilo" description="No hay tareas, vacunaciones, cosechas ni movimientos de hacienda para hoy o los próximos dos días." actionLabel="Ver agenda completa" onAction={() => navigate("/gestion/agenda")} />
      ) : (
        <ol className="space-y-3">
          {plan.stops.map((stop, index) => (
            <li key={stop.sectionId ?? "general"} className="break-inside-avoid rounded-xl border border-border bg-card p-4">
              <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary" aria-hidden>{index + 1}</span>
                <h2 className="font-medium">{stop.name}</h2>
                {stop.context && <span className="text-sm text-muted-foreground">{stop.context}</span>}
              </div>
              <ul className="space-y-2">
                {stop.items.map((item) => {
                  const urgency = URGENCY_STYLES[item.urgency];
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => navigate(item.href)}
                        className={`group flex w-full items-start gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted/60 ${item.blockedBy ? "opacity-70" : ""}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${urgency.className}`}>{urgency.label}</span>
                            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{KIND_LABELS[item.kind]}</span>
                          </span>
                          <span className={`mt-1 block text-sm font-medium ${item.blockedBy ? "line-through decoration-muted-foreground/60" : ""}`}>{item.title}</span>
                          {item.detail && <span className="mt-0.5 block text-xs text-muted-foreground">{item.detail}</span>}
                          {item.blockedBy && <span className="mt-1 block text-xs font-medium text-amber-700 dark:text-amber-300">No hoy: {item.blockedBy}</span>}
                        </span>
                        <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 print:hidden" aria-hidden />
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
