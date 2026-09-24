"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarCheck, Printer, RefreshCw, Share2, Sparkles, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { EmptyState } from "@/components/EmptyState";
import { StatStrip } from "@/components/StatCard";
import { PlanRoute } from "@/components/plan/PlanRoute";
import { PlanWeatherGate } from "@/components/plan/PlanWeatherGate";
import { PlanWeek, type PlanWeekItem } from "@/components/plan/PlanWeek";
import { Button } from "@/components/ui/button";
import { useFarm } from "@/contexts/FarmContext";
import { fetchWithTimeout } from "@/lib/fetch";
import { retryTransientResponse } from "@/lib/retry";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";
import { aiChatHandoffKey, buildOperationalChatPrompt } from "@/lib/ai-handoff";
import type { DailyPlan, PlanItem } from "@/lib/daily-plan";
import { taskIdFromAgendaItemId } from "@/lib/agenda";
import { dateInputValue } from "@/lib/date";
import type { SectionFieldStatus } from "@/lib/grazing";
import type { SupplyCheck, WeekDay } from "@/lib/week-prep";
import { planChatItems, planDateLabel, planShareText } from "@/lib/plan-view";
import { sendJsonResult } from "@/lib/mutate";
import { MoveCattleDialog } from "@/components/MoveCattleDialog";
import { toast } from "sonner";

type PlanResponse = DailyPlan & {
  sections?: SectionFieldStatus[];
  week?: WeekDay<PlanWeekItem>[];
  supplies?: SupplyCheck[];
  fieldStatusAvailable: boolean;
  weatherAvailable: boolean;
};

export default function PlanDelDiaPage() {
  const navigate = useOfflineAwareNavigation();
  const { farm, userId, offlineMode, isOnline, readOnly } = useFarm();
  const offline = offlineMode || !isOnline;
  const canAct = !offline && !readOnly;
  const [moving, setMoving] = useState<{ sectionId: string; destinationId: string | null; wholeHerd: boolean } | null>(null);
  const [completingId, setCompletingId] = useState<string | null>(null);
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
      const res = await retryTransientResponse(() => fetchWithTimeout(`/api/daily-plan?today=${dateInputValue()}`, { cache: "no-store", signal: controller.signal }, 12000), { signal: controller.signal });
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

  async function completeTask(item: PlanItem) {
    const taskId = taskIdFromAgendaItemId(item.id);
    if (!taskId || completingId) return;
    setCompletingId(item.id);
    try {
      const result = await sendJsonResult("/api/tasks", "PUT", { id: taskId, status: "completed" });
      if (result.ok) {
        toast.success("Tarea completada");
        await load();
      } else {
        toast.error(result.error || "No se pudo completar la tarea.");
      }
    } finally {
      setCompletingId(null);
    }
  }

  function shareWhatsApp() {
    if (!plan) return;
    window.open(`https://wa.me/?text=${encodeURIComponent(planShareText(plan, farm?.name))}`, "_blank", "noopener,noreferrer");
  }

  function askCampoAI() {
    if (!plan || !userId) return;
    try {
      window.sessionStorage.setItem(aiChatHandoffKey(userId), buildOperationalChatPrompt(planChatItems(plan.stops), "Plan del día"));
    } catch {
      // Storage can be blocked; the chat still opens, just without the draft.
    }
    navigate("/chat");
  }

  const header = (
    <PageHeader
      title="Plan del día"
      description="Lo que hay que hacer hoy, en el orden para recorrer el campo."
      actions={plan && plan.counts.total > 0 ? (
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button onClick={shareWhatsApp}><Share2 aria-hidden="true" />Enviar por WhatsApp</Button>
          <Button variant="outline" onClick={() => window.print()}><Printer aria-hidden="true" />Imprimir</Button>
          <Button variant="ghost" onClick={askCampoAI} disabled={!userId}><Sparkles aria-hidden="true" />Organizar con CampoAI</Button>
        </div>
      ) : undefined}
    />
  );

  if (offline) {
    return <>{header}<LoadErrorState title="El plan del día necesita conexión" description="Se arma con el clima y el estado actual de los potreros. Conectate para verlo." /></>;
  }
  if (loading && !plan) return <LoadingPage />;
  if (error && !plan) return <>{header}<LoadErrorState title="No se pudo armar el plan del día" description="Revisá tu conexión y reintentá; el plan se arma con el clima y los potreros de hoy." onRetry={() => { void load(); }} /></>;
  if (!plan) return null;

  const movableSectionIds = new Set((plan.sections ?? []).map((section) => section.id));

  return (
    <>
      {header}

      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-sm font-medium">{planDateLabel(plan.date)}</p>
        <Button variant="ghost" size="sm" onClick={() => { void load(); }} disabled={loading} className="print:hidden">
          <RefreshCw className={loading ? "animate-spin" : undefined} aria-hidden="true" />Actualizar
        </Button>
      </div>

      {plan.counts.total > 0 && (
        <StatStrip
          className="mb-6"
          items={[
            { label: "Paradas", value: plan.stops.length },
            { label: "Tareas", value: plan.counts.total },
            { label: "Atrasadas", value: plan.counts.overdue, tone: plan.counts.overdue > 0 ? "bad" : undefined },
            { label: "Frenadas por el clima", value: plan.counts.blocked, tone: plan.counts.blocked > 0 ? "warn" : undefined },
          ]}
        />
      )}

      <div className="space-y-8">
        <div className="space-y-3">
          <PlanWeatherGate weather={plan.weather} blocked={plan.counts.blocked} />
          {!plan.fieldStatusAvailable && (
            <p role="status" className="flex items-start gap-2 text-sm text-warn">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              No se pudo leer el estado de los potreros, así que el plan no incluye rotación ni aguadas. Actualizá en unos minutos.
            </p>
          )}
        </div>

        {plan.stops.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="Día tranquilo" description="No hay tareas, vacunaciones, cosechas ni movimientos de hacienda para hoy o los próximos dos días." actionLabel="Ver la agenda completa" onAction={() => navigate("/gestion/agenda")} />
        ) : (
          <section aria-labelledby="route-title">
            <h2 id="route-title" className="mb-3 text-base font-semibold">
              Recorrido <span className="figure ml-1 text-sm font-normal text-muted-foreground">{plan.stops.length} {plan.stops.length === 1 ? "parada" : "paradas"}</span>
            </h2>
            <PlanRoute
              stops={plan.stops}
              canAct={canAct}
              movableSectionIds={movableSectionIds}
              completingId={completingId}
              onOpen={navigate}
              onComplete={(item) => void completeTask(item)}
              onMove={(sectionId, item) => setMoving({ sectionId, destinationId: item.destinationSectionId ?? null, wholeHerd: true })}
            />
          </section>
        )}

        <PlanWeek supplies={plan.supplies ?? []} week={plan.week ?? []} canBuy={!readOnly} onOpen={navigate} />
      </div>

      <MoveCattleDialog
        open={moving !== null}
        onOpenChange={(open) => { if (!open) setMoving(null); }}
        source={plan.sections?.find((section) => section.id === moving?.sectionId) ?? null}
        statuses={plan.sections ?? []}
        preferredDestinationId={moving?.destinationId}
        moveWholeHerd={moving?.wholeHerd ?? false}
        onMoved={() => { void load(); }}
      />
    </>
  );
}
