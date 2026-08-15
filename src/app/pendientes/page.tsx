"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { alertActionHref, cropIdFromAlertId, expenseRegistrationHref, filterAlerts, healthIdFromAlertId, taskDraftFromAlert, taskIdFromAlertId, vaccinationRegistrationHref, type AlertFilter, type AlertKind, type Alert } from "@/lib/alerts";
import { alertSeverityTone, toneTint } from "@/lib/status-styles";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { sendJsonResult } from "@/lib/mutate";
import { addCalendarDays } from "@/lib/date";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  AlertTriangle, Bell, CalendarPlus, Check, CheckCircle2, ChevronRight, CloudRain,
  ClipboardCheck, DollarSign, ListPlus, Loader2, Package, RefreshCw, ShoppingCart, Stethoscope, Syringe, Wheat,
} from "lucide-react";

const ICONS: Record<AlertKind, typeof Bell> = {
  vaccination: Syringe,
  stock: Package,
  health: Stethoscope,
  harvest: Wheat,
  weather: CloudRain,
  task: ClipboardCheck,
};

const FILTERS: { value: AlertFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "vaccination", label: "Vacunación" },
  { value: "stock", label: "Stock" },
  { value: "health", label: "Sanidad" },
  { value: "harvest", label: "Cosecha" },
  { value: "weather", label: "Clima" },
  { value: "task", label: "Tareas" },
];

export default function PendientesPage() {
  const router = useRouter();
  const { alerts, alertsLoaded, alertsError, alertsTruncated, error, refreshAlerts, offlineMode, isOnline } = useFarm();
  const readOnly = offlineMode || !isOnline;
  const [filter, setFilter] = useState<AlertFilter>("all");
  const [refreshing, setRefreshing] = useState(false);
  const [completingId, setCompletingId] = useState<string | null>(null);
  const [snoozingId, setSnoozingId] = useState<string | null>(null);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [harvestingId, setHarvestingId] = useState<string | null>(null);
  const filteredAlerts = useMemo(() => filterAlerts(alerts, filter), [alerts, filter]);
  const alertCounts = useMemo(
    () => Object.fromEntries(FILTERS.map((option) => [option.value, filterAlerts(alerts, option.value).length])) as Record<AlertFilter, number>,
    [alerts],
  );

  async function refresh() {
    if (readOnly) return;
    setRefreshing(true);
    try {
      await refreshAlerts();
    } finally {
      setRefreshing(false);
    }
  }

  async function completeTask(alert: Alert) {
    const taskId = taskIdFromAlertId(alert.id);
    if (!taskId || completingId || readOnly) return;
    setCompletingId(alert.id);
    const result = await sendJsonResult("/api/tasks", "PUT", { id: taskId, status: "completed" });
    if (result.ok) {
      toast.success("Tarea completada");
      await refreshAlerts();
    } else {
      toast.error(result.error || "No se pudo completar la tarea.");
    }
    setCompletingId(null);
  }

  async function snoozeTask(alert: Alert) {
    const taskId = taskIdFromAlertId(alert.id);
    const nextDate = alert.dueDate ? addCalendarDays(alert.dueDate, 1) : undefined;
    if (!taskId || !nextDate || readOnly || snoozingId) return;
    setSnoozingId(alert.id);
    const result = await sendJsonResult("/api/tasks", "PUT", { id: taskId, dueDate: nextDate });
    if (result.ok) {
      toast.success(`Tarea postergada al ${new Date(`${nextDate}T12:00:00`).toLocaleDateString("es-UY")}`);
      await refreshAlerts();
    } else {
      toast.error(result.error || "No se pudo postergar la tarea");
    }
    setSnoozingId(null);
  }

  function createTaskFromAlert(alert: Alert) {
    if (readOnly) return;
    const draft = taskDraftFromAlert(alert);
    if (!draft) return;
    const params = new URLSearchParams({ new: "1", title: draft.title, description: draft.description, priority: draft.priority });
    if (draft.dueDate) params.set("dueDate", draft.dueDate);
    if (draft.sectionId) params.set("sectionId", draft.sectionId);
    if (draft.cattleId) params.set("cattleId", draft.cattleId);
    if (draft.cropId) params.set("cropId", draft.cropId);
    router.push(`/gestion/tareas?${params.toString()}`);
  }

  async function resolveHealthAlert(alert: Alert) {
    const healthId = healthIdFromAlertId(alert.id);
    if (!healthId || resolvingId || readOnly) return;
    setResolvingId(alert.id);
    const result = await sendJsonResult("/api/health", "PUT", { id: healthId, resolved: true });
    if (result.ok) {
      toast.success("Evento sanitario resuelto");
      await refreshAlerts();
    } else {
      toast.error(result.error || "No se pudo resolver el evento sanitario");
    }
    setResolvingId(null);
  }

  async function markHarvested(alert: Alert) {
    const cropId = cropIdFromAlertId(alert.id);
    if (!cropId || harvestingId || readOnly) return;
    const now = new Date();
    const actualHarvest = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    setHarvestingId(alert.id);
    const result = await sendJsonResult("/api/crops", "PUT", { id: cropId, actualHarvest, status: "harvested" });
    if (result.ok) {
      toast.success("Cosecha registrada");
      await refreshAlerts();
    } else {
      toast.error(result.error || "No se pudo registrar la cosecha");
    }
    setHarvestingId(null);
  }

  if (!alertsLoaded && !error) return <LoadingPage />;
  if ((error || alertsError) && alerts.length === 0) return <LoadErrorState title={readOnly ? "Pendientes no disponibles sin conexión" : "No se pudieron cargar los pendientes"} description={readOnly ? "Sincronizá el panel desde Mi campo cuando recuperes la conexión para consultar los pendientes." : undefined} onRetry={readOnly ? undefined : refresh} />;

  const highCount = alerts.filter((alert) => alert.severity === "high").length;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Pendientes" }]}
        title="Pendientes"
        description="Una vista de las acciones que necesitan atención en el campo."
        actions={
          <Button variant="outline" onClick={refresh} disabled={refreshing || readOnly}>
            <RefreshCw className={`mr-1.5 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Actualizar
          </Button>
        }
      />

      {alertsError && alerts.length > 0 && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span className="flex-1">Mostrando la última actualización disponible.</span>
          {!readOnly && <button type="button" className="font-medium text-foreground hover:underline" onClick={() => void refresh()}>Reintentar</button>}
        </div>
      )}

      {alertsTruncated && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          <span>La lista puede estar incompleta por límites de carga. Revisá los módulos de origen para consultar todos los pendientes.</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs text-muted-foreground">Pendientes</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{alerts.length}</p>
        </div>
        <div className="rounded-xl border border-red-500/25 bg-card p-4">
          <p className="text-xs text-muted-foreground">Urgentes</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-red-600 dark:text-red-400">{highCount}</p>
        </div>
        <div className="col-span-2 rounded-xl border border-emerald-500/25 bg-card p-4 sm:col-span-1">
          <p className="text-xs text-muted-foreground">Estado</p>
          <p className="mt-1 flex items-center gap-1.5 text-sm font-medium">
            {alerts.length === 0 ? <><CheckCircle2 className="h-4 w-4 text-emerald-500" /> Todo al día</> : <><AlertTriangle className="h-4 w-4 text-amber-500" /> Requiere atención</>}
          </p>
        </div>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Filtrar pendientes">
        {FILTERS.map((option) => (
          <Button
            key={option.value}
            variant={filter === option.value ? "secondary" : "outline"}
            size="sm"
            role="tab"
            aria-selected={filter === option.value}
            onClick={() => setFilter(option.value)}
            className="shrink-0"
          >
            {option.label}
            <Badge variant="outline" className="ml-1.5 min-w-5 justify-center px-1.5">{alertCounts[option.value]}</Badge>
          </Button>
        ))}
      </div>

      {filteredAlerts.length === 0 ? (
        <div className="rounded-xl border border-border bg-card">
          <EmptyState
            icon={CheckCircle2}
            title={alerts.length === 0 ? "Todo al día" : "Sin pendientes en este filtro"}
            description={alerts.length === 0 ? "No hay vacunaciones, stock, sanidad, cosechas o tareas que requieran atención." : "Probá con otra categoría para ver las demás acciones."}
          />
        </div>
      ) : (
        <div className="space-y-2">
          {filteredAlerts.map((alert) => {
            const Icon = ICONS[alert.kind];
            const high = alert.severity === "high";
            const expenseHref = expenseRegistrationHref(alert);
            return (
              <div
                key={alert.id}
                className={`flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left ${high ? "border-red-500/30" : "border-amber-500/25"}`}
              >
                <button type="button"
                  onClick={() => router.push(alertActionHref(alert))}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${toneTint(alertSeverityTone(alert.severity))}`}>
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{alert.title}</span>
                      <Badge variant="outline" className="text-[10px] uppercase">{high ? "Urgente" : "Próximo"}</Badge>
                    </span>
                    <span className="mt-1 block text-sm text-muted-foreground">{alert.detail}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
                {alert.kind === "task" && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={readOnly || completingId !== null}
                    onClick={() => void completeTask(alert)}
                    className="shrink-0"
                  >
                    {completingId === alert.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">Completar</span>
                  </Button>
                )}
                {alert.kind === "task" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Postergar ${alert.title} un día`}
                    title={readOnly ? "Necesitás conexión para postergar la tarea" : "Postergar tarea un día"}
                    disabled={readOnly || completingId !== null || snoozingId !== null}
                    onClick={() => void snoozeTask(alert)}
                    className="shrink-0"
                  >
                    {snoozingId === alert.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarPlus className="h-3.5 w-3.5" />}
                    <span className="hidden sm:inline">+1 día</span>
                  </Button>
                )}
                {alert.kind !== "task" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Crear tarea para ${alert.title}`}
                    onClick={() => createTaskFromAlert(alert)}
                    disabled={readOnly}
                    className="shrink-0"
                  >
                    <ListPlus className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Crear tarea</span>
                  </Button>
                )}
                {alert.kind === "vaccination" && (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Registrar ${alert.title}`}
                    onClick={() => {
                      const href = vaccinationRegistrationHref(alert);
                      if (href) router.push(href);
                    }}
                    disabled={readOnly}
                    className="shrink-0"
                  >
                    <Syringe className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Registrar</span>
                  </Button>
                )}
                {alert.kind === "stock" && alert.inventoryId && (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label={`Registrar compra de ${alert.title}`}
                    onClick={() => router.push(`/gestion/inventario?buy=1&itemId=${encodeURIComponent(alert.inventoryId || "")}`)}
                    disabled={readOnly}
                    className="shrink-0"
                  >
                    <ShoppingCart className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Comprar</span>
                  </Button>
                )}
                {alert.kind === "health" && (
                  <ConfirmDialog
                    trigger={<Button variant="ghost" size="sm" aria-label={`Resolver ${alert.title}`} disabled={readOnly || resolvingId !== null} className="shrink-0"><CheckCircle2 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Resolver</span></Button>}
                    title="¿Marcar evento como resuelto?"
                    description={alert.detail}
                    confirmLabel="Marcar resuelto"
                    confirmVariant="default"
                    onConfirm={() => { void resolveHealthAlert(alert); }}
                  />
                )}
                {expenseHref && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Registrar gasto de ${alert.title}`}
                    onClick={() => { if (!readOnly) router.push(expenseHref); }}
                    disabled={readOnly}
                    className="shrink-0"
                  >
                    <DollarSign className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Gasto</span>
                  </Button>
                )}
                {alert.kind === "harvest" && (
                  <ConfirmDialog
                    trigger={<Button variant="ghost" size="sm" aria-label={`Registrar cosecha de ${alert.title}`} disabled={readOnly || harvestingId !== null} className="shrink-0"><CheckCircle2 className="h-3.5 w-3.5" /><span className="hidden sm:inline">Cosechado</span></Button>}
                    title="¿Registrar cosecha?"
                    description={`${alert.title}. Se guardará la fecha de hoy y el estado pasará a cosechado.`}
                    confirmLabel="Registrar cosecha"
                    confirmVariant="default"
                    onConfirm={() => { void markHarvested(alert); }}
                  />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
