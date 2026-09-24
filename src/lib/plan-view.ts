// View helpers for "Plan del día": labels, tones and the text handed to
// WhatsApp and CampoAI. Pure — the page and its components only render.
import { dailyPlanText, type DailyPlan, type PlanItemKind, type PlanStop, type PlanUrgency } from "./daily-plan";
import type { SupplyCheck, SupplyStatus } from "./week-prep";
import type { Tone } from "./status-styles";

export const PLAN_KIND_LABELS: Record<PlanItemKind, string> = {
  water: "Agua",
  move: "Rotación",
  vaccination: "Sanidad",
  task: "Tarea",
  harvest: "Cosecha",
};

export const PLAN_URGENCY: Record<PlanUrgency, { label: string; tone: Tone }> = {
  overdue: { label: "Atrasado", tone: "bad" },
  today: { label: "Hoy", tone: "warn" },
  soon: { label: "Próximos días", tone: "neutral" },
};

export const SUPPLY_STATUS: Record<SupplyStatus, { label: string; tone: Tone }> = {
  ok: { label: "En stock", tone: "good" },
  short: { label: "Falta stock", tone: "bad" },
  missing: { label: "Sin insumo", tone: "warn" },
};

/** Text class for a tone (a shared `toneText` in status-styles would replace this). */
export const TONE_TEXT: Record<Tone, string> = { bad: "text-bad", warn: "text-warn", good: "text-ok", neutral: "text-muted-foreground" };

function capitalize(label: string): string {
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** "Jueves, 24 de setiembre" — the plan's calendar day, never shifted by the viewer's zone. */
export function planDateLabel(date: string): string {
  return capitalize(new Date(`${date}T12:00:00Z`).toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }));
}

/** "Sábado, 26 set." — a day heading in "Esta semana". */
export function weekdayLabel(date: string): string {
  return capitalize(new Date(`${date}T12:00:00Z`).toLocaleDateString("es-UY", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }));
}

/** WhatsApp message: the route, plus the supplies still to buy this week. */
export function planShareText(plan: DailyPlan & { supplies?: SupplyCheck[] }, farmName?: string | null): string {
  const toPrepare = (plan.supplies ?? []).filter((check) => check.status !== "ok");
  return dailyPlanText(plan, farmName)
    + (toPrepare.length ? `\n\n*Preparar esta semana*\n${toPrepare.map((check) => `• ${check.summary}`).join("\n")}` : "");
}

/** One line per plan item, in route order, for the CampoAI hand-off. */
export function planChatItems(stops: PlanStop[]): { label: string; detail: string }[] {
  return stops.flatMap((stop) => stop.items.map((item) => ({
    label: `${stop.name}: ${item.title}`,
    detail: [item.detail, item.blockedBy ? `no hoy: ${item.blockedBy}` : ""].filter(Boolean).join(" · "),
  })));
}

/** "3 tareas · 1 atrasada" under a stop's name. */
export function stopTally(stop: PlanStop): string {
  const total = stop.items.length;
  const overdue = stop.items.filter((item) => item.urgency === "overdue").length;
  return `${total} ${total === 1 ? "tarea" : "tareas"}${overdue > 0 ? ` · ${overdue} ${overdue === 1 ? "atrasada" : "atrasadas"}` : ""}`;
}
