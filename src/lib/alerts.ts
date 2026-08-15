// Pure alert-derivation logic — no DB access, so it can be unit-tested.
// The route fetches rows and calls buildAlerts(); the home page renders the result.
import { buildDeadlineActions } from "./briefing";

export type AlertKind = "vaccination" | "stock" | "health" | "harvest" | "weather" | "task";
export type AlertSeverity = "high" | "medium";

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  href: string;
  dueDate?: string;
  sectionId?: string;
  cattleId?: string;
  cropId?: string;
  inventoryId?: string;
}

export type AlertFilter = "all" | AlertKind;

export interface TaskDraftFromAlert {
  title: string;
  description: string;
  dueDate: string;
  priority: "medium" | "high";
  sectionId?: string;
  cattleId?: string;
  cropId?: string;
}

export function filterAlerts(alerts: Alert[], filter: AlertFilter): Alert[] {
  return filter === "all" ? alerts : alerts.filter((alert) => alert.kind === filter);
}

export function alertActionHref(alert: Alert): string {
  if (alert.kind === "stock" && alert.inventoryId) {
    return `/gestion/inventario?buy=1&itemId=${encodeURIComponent(alert.inventoryId)}`;
  }
  if (alert.kind === "task") {
    const taskId = taskIdFromAlertId(alert.id);
    if (taskId) return `/gestion/tareas?taskId=${encodeURIComponent(taskId)}`;
  }
  if (alert.kind === "health") {
    const healthId = healthIdFromAlertId(alert.id);
    if (healthId) return `/produccion/sanidad?healthId=${encodeURIComponent(healthId)}`;
  }
  if (alert.kind === "harvest" && alert.cropId) {
    return `/produccion/agricultura?cropId=${encodeURIComponent(alert.cropId)}`;
  }
  if (alert.kind === "vaccination") {
    const vaccinationId = vaccinationIdFromAlertId(alert.id);
    if (vaccinationId) return `/produccion/sanidad?vaccinationId=${encodeURIComponent(vaccinationId)}`;
  }
  return alert.href;
}

export function vaccinationRegistrationHref(alert: Alert): string | null {
  if (alert.kind !== "vaccination") return null;
  const vaccineName = alert.title.replace(/^Vacunación:\s*/u, "").trim();
  if (!vaccineName) return null;
  const params = new URLSearchParams({ new: "vaccination", vaccineName });
  if (alert.sectionId) params.set("sectionId", alert.sectionId);
  if (alert.cattleId) params.set("cattleId", alert.cattleId);
  return `/produccion/sanidad?${params.toString()}`;
}

export interface FinancialExpenseContext {
  description: string;
  sectionId?: string;
  cattleId?: string;
}

export function financialExpenseHref(context: FinancialExpenseContext): string {
  const params = new URLSearchParams({
    new: "1",
    type: "egreso",
    category: "veterinario",
    description: context.description,
  });
  if (context.sectionId) params.set("sectionId", context.sectionId);
  if (context.cattleId) params.set("cattleId", context.cattleId);
  return `/gestion/finanzas?${params.toString()}`;
}

export function expenseRegistrationHref(alert: Alert): string | null {
  if (alert.kind === "vaccination") {
    const vaccineName = alert.title.replace(/^Vacunación:\s*/u, "").trim();
    if (!vaccineName) return null;
    return financialExpenseHref({
      description: `Vacunación: ${vaccineName}`,
      sectionId: alert.sectionId,
      cattleId: alert.cattleId,
    });
  }
  if (alert.kind === "health") {
    const description = alert.detail.trim() || alert.title.replace(/^Sanidad pendiente:\s*/u, "").trim();
    if (!description) return null;
    return financialExpenseHref({
      description: `Sanidad: ${description}`,
      sectionId: alert.sectionId,
      cattleId: alert.cattleId,
    });
  }
  return null;
}

export function taskIdFromAlertId(alertId: string): string | null {
  return alertId.startsWith("tsk-") && alertId.length > 4 ? alertId.slice(4) : null;
}

export function healthIdFromAlertId(alertId: string): string | null {
  return alertId.startsWith("hlt-") && alertId.length > 4 ? alertId.slice(4) : null;
}

export function vaccinationIdFromAlertId(alertId: string): string | null {
  return alertId.startsWith("vac-") && alertId.length > 4 ? alertId.slice(4) : null;
}

export function cropIdFromAlertId(alertId: string): string | null {
  return alertId.startsWith("crp-") && alertId.length > 4 ? alertId.slice(4) : null;
}

export function taskDraftFromAlert(alert: Alert): TaskDraftFromAlert | null {
  if (alert.kind === "task") return null;
  return {
    title: "Atender: " + alert.title,
    description: alert.detail,
    dueDate: alert.dueDate || "",
    priority: alert.severity === "high" ? "high" : "medium",
    ...(alert.sectionId ? { sectionId: alert.sectionId } : {}),
    ...(alert.cattleId ? { cattleId: alert.cattleId } : {}),
    ...(alert.cropId ? { cropId: alert.cropId } : {}),
  };
}

export interface AlertInputs {
  vaccinations: { id: string; vaccine_name: string; next_due: string | null; section_id?: string | null; cattle_id?: string | null; sections?: { name: string } | null }[];
  inventory: { id: string; name: string; current_stock: number; min_stock: number | null; unit: string }[];
  health: { id: string; type: string; description: string; resolved: boolean | null; section_id?: string | null; cattle_id?: string | null }[];
  crops: {
    id: string; crop_type: string; status: string | null;
    expected_harvest: string | null; actual_harvest: string | null;
    section_id?: string | null;
    sections?: { name: string } | null;
  }[];
  tasks?: {
    id: string;
    title: string;
    due_date: string | null;
    priority: "low" | "medium" | "high";
    status: string;
    section_id?: string | null;
    cattle_id?: string | null;
    crop_id?: string | null;
    sections?: { name: string } | null;
  }[];
  weather?: { wind: number; precip: number } | null;
}

export function buildAlerts(input: AlertInputs, now: number): Alert[] {
  const alerts: Alert[] = [];

  if (input.weather) {
    const { wind, precip } = input.weather;
    if (precip >= 1 || wind > 20) {
      const severe = precip >= 5 || wind > 30;
      alerts.push({
        id: "weather-spray",
        kind: "weather",
        severity: severe ? "high" : "medium",
        title: "No pulverizar ahora",
        detail: precip >= 1
          ? "Lluvia prevista (" + (Math.round(precip * 10) / 10) + " mm) — el producto se lava"
          : "Viento fuerte (" + Math.round(wind) + " km/h) — riesgo de deriva",
        href: "/",
      });
    }
  }

  const deadlineActions = buildDeadlineActions([
    ...input.vaccinations.map((v) => ({
      id: v.id,
      kind: "vaccination" as const,
      label: "Vacunación: " + v.vaccine_name,
      date: v.next_due,
      sectionName: v.sections?.name,
      sectionId: v.section_id,
      cattleId: v.cattle_id,
    })),
    ...input.crops
      .filter((c) => c.expected_harvest && !c.actual_harvest && c.status !== "harvested" && c.status !== "failed")
      .map((c) => ({
        id: c.id,
        kind: "harvest" as const,
        label: "Cosecha: " + c.crop_type,
        date: c.expected_harvest,
        sectionName: c.sections?.name,
        sectionId: c.section_id,
        cropId: c.id,
      })),
    ...(input.tasks || [])
      .filter((task) => task.status !== "completed" && task.due_date)
      .map((task) => ({
        id: task.id,
        kind: "task" as const,
        label: "Tarea: " + task.title,
        date: task.due_date,
        sectionName: task.sections?.name,
        sectionId: task.section_id,
        cattleId: task.cattle_id,
        cropId: task.crop_id,
        priority: task.priority,
      })),
  ], now);

  for (const action of deadlineActions) {
    alerts.push({
      id: (action.kind === "vaccination" ? "vac-" : action.kind === "harvest" ? "crp-" : "tsk-") + action.id,
      kind: action.kind,
      severity: action.daysUntil < 0 || (action.kind === "task" && input.tasks?.find((task) => task.id === action.id)?.priority === "high") ? "high" : "medium",
      title: action.label,
      detail: action.detail,
      href: action.kind === "vaccination" ? "/produccion/sanidad" : action.kind === "harvest" ? "/produccion/agricultura" : "/gestion/tareas",
      dueDate: action.date.slice(0, 10),
      ...(action.sectionId ? { sectionId: action.sectionId } : {}),
      ...(action.cattleId ? { cattleId: action.cattleId } : {}),
      ...(action.cropId ? { cropId: action.cropId } : {}),
    });
  }

  for (const it of input.inventory) {
    if (it.min_stock == null || it.current_stock >= it.min_stock) continue;
    alerts.push({
      id: `stk-${it.id}`,
      kind: "stock",
      severity: it.current_stock <= 0 ? "high" : "medium",
      title: `Stock bajo: ${it.name}`,
      detail: `${it.current_stock} ${it.unit} (mín ${it.min_stock})`,
      href: "/gestion/inventario",
      inventoryId: it.id,
    });
  }

  for (const h of input.health) {
    if (h.resolved) continue;
    alerts.push({
      id: `hlt-${h.id}`,
      kind: "health",
      severity: "medium",
      title: `Sanidad pendiente: ${h.type}`,
      detail: h.description,
      href: "/produccion/sanidad",
      ...(h.section_id ? { sectionId: h.section_id } : {}),
      ...(h.cattle_id ? { cattleId: h.cattle_id } : {}),
    });
  }

  // High severity first; stable within a severity.
  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}
