import { escapeAIContextValue as esc } from "./ai-context";
import type { DeadlineAction } from "./briefing";
import type { RotationMove } from "./grazing";

// Deadlines for the assistant, grouped the way people ask about them. As one
// 30-day list with ISO dates, the model answered "¿qué hago esta semana?"
// with two tasks and dropped the Aftosa vaccination due in 5 days, and quoted
// "2026-09-20" back at the farmer (loop 10 walk).

const WEEKDAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

/** Farm-local calendar day. The farms are in Uruguay/Argentina (UTC-3); the
 * server runs in UTC, which is already "tomorrow" after 21:00 local. */
export function farmLocalToday(now: number, timeZone = "America/Montevideo"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(now));
}

export function humanDay(date: string): string {
  const parsed = new Date(`${date.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(parsed.getTime())) return date;
  return `${WEEKDAYS[parsed.getUTCDay()]} ${parsed.getUTCDate()}/${parsed.getUTCMonth() + 1}`;
}

/** A suggested herd move as a line of this week's work. Loop 10's verify:
 * listed only under MOVIMIENTOS SUGERIDOS, the model left it out of "¿qué
 * hago esta semana?" answers; inside ESTA SEMANA it is part of the week. */
function moveLine(move: RotationMove): string {
  const urgent = move.reasons.some((reason) => reason.code === "water" || reason.code === "stocking");
  const why = move.reasons.map((reason) => reason.label).join(", ");
  const best = move.destinations[0];
  const what = best
    ? `Mover ${move.heads} cab. de ${esc(move.fromName)} a ${esc(best.name)}`
    : `Buscar potrero para ${move.heads} cab. de ${esc(move.fromName)}`;
  return `- ${urgent ? "hoy" : "esta semana"} · ${what} (${why}; movimiento sugerido, requiere confirmación)\n`;
}

export function deadlinesAIContext(actions: DeadlineAction[], moves: RotationMove[] = []): string {
  if (actions.length === 0 && moves.length === 0) return "";
  const line = (action: DeadlineAction) => `- ${humanDay(action.date)} · ${esc(action.label)} (${esc(action.detail)})\n`;
  const overdue = actions.filter((action) => action.daysUntil < 0);
  const week = actions.filter((action) => action.daysUntil >= 0 && action.daysUntil <= 7);
  const later = actions.filter((action) => action.daysUntil > 7);
  let ctx = "\nPENDIENTES (calculado por CampoAI; fechas ya en formato para el productor, no las conviertas a ISO):\n";
  if (overdue.length) ctx += "ATRASADO:\n" + overdue.map(line).join("");
  if (week.length || moves.length) ctx += "ESTA SEMANA (hoy y los próximos 7 días):\n" + week.map(line).join("") + moves.map(moveLine).join("");
  if (later.length) ctx += "MÁS ADELANTE (hasta 30 días):\n" + later.map(line).join("");
  return ctx;
}
