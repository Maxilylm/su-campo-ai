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
}

export type AlertFilter = "all" | AlertKind;

export function filterAlerts(alerts: Alert[], filter: AlertFilter): Alert[] {
  return filter === "all" ? alerts : alerts.filter((alert) => alert.kind === filter);
}

export interface AlertInputs {
  vaccinations: { id: string; vaccine_name: string; next_due: string | null; sections?: { name: string } | null }[];
  inventory: { id: string; name: string; current_stock: number; min_stock: number | null; unit: string }[];
  health: { id: string; type: string; description: string; resolved: boolean | null }[];
  crops: {
    id: string; crop_type: string; status: string | null;
    expected_harvest: string | null; actual_harvest: string | null;
    sections?: { name: string } | null;
  }[];
  tasks?: {
    id: string;
    title: string;
    due_date: string | null;
    priority: "low" | "medium" | "high";
    status: string;
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
    })),
    ...input.crops
      .filter((c) => c.expected_harvest && !c.actual_harvest && c.status !== "harvested" && c.status !== "failed")
      .map((c) => ({
        id: c.id,
        kind: "harvest" as const,
        label: "Cosecha: " + c.crop_type,
        date: c.expected_harvest,
        sectionName: c.sections?.name,
      })),
    ...(input.tasks || [])
      .filter((task) => task.status !== "completed" && task.due_date)
      .map((task) => ({
        id: task.id,
        kind: "task" as const,
        label: "Tarea: " + task.title,
        date: task.due_date,
        sectionName: task.sections?.name,
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
    });
  }

  // High severity first; stable within a severity.
  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}
