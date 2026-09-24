"use client";

import { useMemo, useState } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { alertActionHref, cropIdFromAlertId, expenseRegistrationHref, filterAlerts, healthIdFromAlertId, taskDraftFromAlert, taskIdFromAlertId, vaccinationRegistrationHref, type AlertFilter, type AlertKind, type Alert } from "@/lib/alerts";
import { alertSeverityTone, toneTint } from "@/lib/status-styles";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatStrip } from "@/components/StatCard";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { sendJsonResult } from "@/lib/mutate";
import { dateInputValue } from "@/lib/date";
import { snoozeDueDate } from "@/lib/tasks";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { CampoAIButton } from "@/components/CampoAIButton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  AlertTriangle, Bell, CalendarPlus, Check, CheckCircle2, ChevronRight, CloudRain,
  ClipboardCheck, Fence, DollarSign, ListPlus, Loader2, Package, RefreshCw, ShoppingCart, Stethoscope, Syringe, Wheat,
} from "lucide-react";

const ICONS: Record<AlertKind, typeof Bell> = {
  vaccination: Syringe,
  stock: Package,
  health: Stethoscope,
  harvest: Wheat,
  weather: CloudRain,
  task: ClipboardCheck,
  field: Fence,
};

const FILTERS: { value: AlertFilter; label: string }[] = [
  { value: "all", label: "Todos" },
  { value: "vaccination", label: "Vacunación" },
  { value: "stock", label: "Stock" },
  { value: "health", label: "Sanidad" },
  { value: "harvest", label: "Cosecha" },
  { value: "weather", label: "Clima" },
  { value: "task", label: "Tareas" },
  { value: "field", label: "Potreros" },
];

export default function PendientesPage() {
  const navigate = useOfflineAwareNavigation();
  const { alerts, alertsLoaded, alertsError, alertsTruncated, error, refreshAlerts, offlineMode, isOnline, readOnly: permissionReadOnly } = useFarm();
  const offlineReadOnly = offlineMode || !isOnline;
  const actionReadOnly = offlineReadOnly || permissionReadOnly;
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
    if (offlineReadOnly) return;
    setRefreshing(true);
    try {
      await refreshAlerts();
    } finally {
      setRefreshing(false);
    }
  }

  async function completeTask(alert: Alert) {
    const taskId = taskIdFromAlertId(alert.id);
    if (!taskId || completingId || actionReadOnly) return;
    setCompletingId(alert.id);
    try {
      const result = await sendJsonResult("/api/tasks", "PUT", { id: taskId, status: "completed" });
      if (result.ok) {
        toast.success("Tarea completada");
        await refreshAlerts();
      } else {
        toast.error(result.error || "No se pudo completar la tarea.");
      }
    } catch {
      toast.error("No se pudo completar la tarea.");
    } finally {
      setCompletingId(null);
    }
  }

  async function snoozeTask(alert: Alert) {
    const taskId = taskIdFromAlertId(alert.id);
    const nextDate = alert.dueDate ? snoozeDueDate(alert.dueDate, dateInputValue()) : undefined;
    if (!taskId || !nextDate || actionReadOnly || snoozingId) return;
    setSnoozingId(alert.id);
    try {
      const result = await sendJsonResult("/api/tasks", "PUT", { id: taskId, dueDate: nextDate });
      if (result.ok) {
        toast.success(`Tarea postergada al ${new Date(`${nextDate}T12:00:00`).toLocaleDateString("es-UY")}`);
        await refreshAlerts();
      } else {
        toast.error(result.error || "No se pudo postergar la tarea");
      }
    } catch {
      toast.error("No se pudo postergar la tarea");
    } finally {
      setSnoozingId(null);
    }
  }

  function createTaskFromAlert(alert: Alert) {
    if (actionReadOnly) return;
    const draft = taskDraftFromAlert(alert);
    if (!draft) return;
    const params = new URLSearchParams({ new: "1", title: draft.title, description: draft.description, priority: draft.priority });
    if (draft.dueDate) params.set("dueDate", draft.dueDate);
    if (draft.sectionId) params.set("sectionId", draft.sectionId);
    if (draft.cattleId) params.set("cattleId", draft.cattleId);
    if (draft.cropId) params.set("cropId", draft.cropId);
    navigate(`/gestion/tareas?${params.toString()}`);
  }

  async function resolveHealthAlert(alert: Alert) {
    const healthId = healthIdFromAlertId(alert.id);
    if (!healthId || resolvingId || actionReadOnly) return;
    setResolvingId(alert.id);
    try {
      const result = await sendJsonResult("/api/health", "PUT", { id: healthId, resolved: true });
      if (result.ok) {
        toast.success("Evento sanitario resuelto");
        await refreshAlerts();
      } else {
        toast.error(result.error || "No se pudo resolver el evento sanitario");
      }
    } catch {
      toast.error("No se pudo resolver el evento sanitario");
    } finally {
      setResolvingId(null);
    }
  }

  async function markHarvested(alert: Alert) {
    const cropId = cropIdFromAlertId(alert.id);
    if (!cropId || harvestingId || actionReadOnly) return;
    const now = new Date();
    const actualHarvest = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    setHarvestingId(alert.id);
    try {
      const result = await sendJsonResult("/api/crops", "PUT", { id: cropId, actualHarvest, status: "harvested" });
      if (result.ok) {
        toast.success("Cosecha registrada");
        await refreshAlerts();
      } else {
        toast.error(result.error || "No se pudo registrar la cosecha");
      }
    } catch {
      toast.error("No se pudo registrar la cosecha");
    } finally {
      setHarvestingId(null);
    }
  }


  if (!alertsLoaded && !error) return <LoadingPage />;
  if ((error || alertsError) && alerts.length === 0) {
    return (
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
        <LoadErrorState title={offlineReadOnly ? "Pendientes no disponibles sin conexión" : "No se pudieron cargar los pendientes"} description={offlineReadOnly ? "Sincronizá el panel desde Mi campo cuando recuperes la conexión para consultar los pendientes." : undefined} onRetry={offlineReadOnly ? undefined : refresh} />
      </main>
    );
  }

  const highCount = alerts.filter((alert) => alert.severity === "high").length;
  const alertAIFacts = [
    `Filtro: ${filter}`,
    `Pendientes visibles: ${filteredAlerts.length}${alertsTruncated ? "+" : ""}`,
    `Urgentes: ${highCount}`,
    ...filteredAlerts.slice(0, 30).map((alert) => `${alert.title}: ${alert.detail} (${alert.severity})`),
  ];

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
      <PageHeader
        title="Pendientes"
        description="Lo que necesita atención en el campo, de lo más urgente a lo próximo."
        actions={
          <>
            <CampoAIButton title="Pendientes" facts={alertAIFacts} partial={alertsTruncated} instruction="Ayudame a ordenar estos pendientes, explicar el riesgo y convertir los que correspondan en próximos pasos verificables." disabled={alerts.length === 0} />
            <Button variant="outline" onClick={refresh} disabled={refreshing || offlineReadOnly}>
              <RefreshCw className={refreshing ? "animate-spin" : undefined} aria-hidden="true" />
              Actualizar
            </Button>
          </>
        }
      />

      <div className="space-y-6">
        {alertsError && alerts.length > 0 && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-sm text-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
            <span className="flex-1">No se pudo actualizar; mostrando la última lista disponible.</span>
            {!offlineReadOnly && <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => void refresh()}>Reintentar</Button>}
          </div>
        )}

        {alertsTruncated && (
          <div role="status" className="flex items-center gap-2 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-sm text-foreground">
            <AlertTriangle className="h-4 w-4 shrink-0 text-warn" aria-hidden="true" />
            <span>La lista puede estar incompleta por límites de carga. Revisá los módulos de origen para ver todos los pendientes.</span>
          </div>
        )}

        <StatStrip
          items={[
            { label: "Pendientes", value: alerts.length, hint: alerts.length === 0 ? "Todo al día" : undefined },
            { label: "Urgentes", value: highCount, tone: highCount > 0 ? "bad" : undefined },
            { label: "Próximos", value: alerts.length - highCount },
          ]}
        />

        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="tablist" aria-label="Filtrar pendientes">
          {FILTERS.map((option) => (
            <Button
              key={option.value}
              variant={filter === option.value ? "secondary" : "ghost"}
              size="sm"
              role="tab"
              aria-selected={filter === option.value}
              onClick={() => setFilter(option.value)}
              className={filter === option.value ? "shrink-0 text-foreground" : "shrink-0 text-muted-foreground"}
            >
              {option.label}
              <span className="figure text-xs text-muted-foreground">{alertCounts[option.value]}</span>
            </Button>
          ))}
        </div>

        {filteredAlerts.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title={alerts.length === 0 ? "Todo al día" : "Sin pendientes en este filtro"}
            description={alerts.length === 0 ? "No hay vacunaciones, stock, sanidad, cosechas ni tareas que requieran atención." : "Probá con otra categoría para ver las demás acciones."}
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {filteredAlerts.map((alert) => {
              const Icon = ICONS[alert.kind];
              const high = alert.severity === "high";
              const expenseHref = expenseRegistrationHref(alert);
              return (
                <li key={alert.id} className="flex flex-col gap-2.5 px-4 py-3 md:flex-row md:items-center md:gap-3">
                  <button
                    type="button"
                    onClick={() => navigate(alertActionHref(alert))}
                    className="group flex min-w-0 flex-1 items-center gap-3 rounded-md text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md ${toneTint(alertSeverityTone(alert.severity))}`}>
                      <Icon className="h-4 w-4" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium group-hover:underline">{alert.title}</span>
                        {high && <Badge variant="bad">Urgente</Badge>}
                      </span>
                      <span className={`mt-0.5 block text-sm ${high ? "text-bad" : "text-muted-foreground"}`}>{alert.detail}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  </button>
                  <div className="flex flex-wrap gap-1.5 pl-12 md:shrink-0 md:pl-0">
                    {alert.kind === "task" && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Completar: ${alert.title}`}
                        disabled={actionReadOnly || completingId !== null}
                        onClick={() => void completeTask(alert)}
                      >
                        {completingId === alert.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Check aria-hidden="true" />}
                        Completar
                      </Button>
                    )}
                    {alert.kind === "task" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`+1 día: postergar ${alert.title}`}
                        title={permissionReadOnly ? "Tu acceso es de solo lectura" : offlineReadOnly ? "Necesitás conexión para postergar la tarea" : "Postergar tarea un día"}
                        disabled={actionReadOnly || completingId !== null || snoozingId !== null}
                        onClick={() => void snoozeTask(alert)}
                      >
                        {snoozingId === alert.id ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CalendarPlus aria-hidden="true" />}
                        +1 día
                      </Button>
                    )}
                    {alert.kind !== "task" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Crear tarea para ${alert.title}`}
                        onClick={() => createTaskFromAlert(alert)}
                        disabled={actionReadOnly}
                      >
                        <ListPlus aria-hidden="true" />
                        Crear tarea
                      </Button>
                    )}
                    {alert.kind === "vaccination" && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Registrar ${alert.title}`}
                        onClick={() => {
                          const href = vaccinationRegistrationHref(alert);
                          if (href) navigate(href);
                        }}
                        disabled={actionReadOnly}
                      >
                        <Syringe aria-hidden="true" />
                        Registrar
                      </Button>
                    )}
                    {alert.kind === "stock" && alert.inventoryId && (
                      <Button
                        variant="outline"
                        size="sm"
                        aria-label={`Comprar: registrar compra de ${alert.title}`}
                        onClick={() => navigate(`/gestion/inventario?buy=1&itemId=${encodeURIComponent(alert.inventoryId || "")}`)}
                        disabled={actionReadOnly}
                      >
                        <ShoppingCart aria-hidden="true" />
                        Comprar
                      </Button>
                    )}
                    {alert.kind === "health" && (
                      <ConfirmDialog
                        trigger={<Button variant="ghost" size="sm" aria-label={`Resolver ${alert.title}`} disabled={actionReadOnly || resolvingId !== null}><CheckCircle2 aria-hidden="true" />Resolver</Button>}
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
                        aria-label={`Gasto: registrar gasto de ${alert.title}`}
                        onClick={() => { if (!actionReadOnly) navigate(expenseHref); }}
                        disabled={actionReadOnly}
                      >
                        <DollarSign aria-hidden="true" />
                        Gasto
                      </Button>
                    )}
                    {alert.kind === "harvest" && (
                      <ConfirmDialog
                        trigger={<Button variant="ghost" size="sm" aria-label={`Cosechado: registrar cosecha de ${alert.title}`} disabled={actionReadOnly || harvestingId !== null}><CheckCircle2 aria-hidden="true" />Cosechado</Button>}
                        title="¿Registrar cosecha?"
                        description={`${alert.title}. Se guardará la fecha de hoy y el estado pasará a cosechado.`}
                        confirmLabel="Registrar cosecha"
                        confirmVariant="default"
                        onConfirm={() => { void markHarvested(alert); }}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </main>
  );
}
