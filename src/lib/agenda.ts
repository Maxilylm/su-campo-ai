// Agenda unificada: convierte tareas, vacunaciones y cosechas en un plan
// ordenado por día. La derivación es pura para poder probarla sin Supabase.
import { buildDeadlineActions, type DeadlineInput } from "./briefing";
import { addDays, daysBetween } from "./calendar-grid";
import { isValidDateOnly } from "./date";
import type { Tone } from "./status-styles";

export type AgendaKind = "task" | "vaccination" | "harvest";
export type AgendaPriority = "low" | "medium" | "high";

export interface AgendaItem {
  id: string;
  kind: AgendaKind;
  date: string;
  daysFromNow: number;
  title: string;
  detail: string;
  href: string;
  priority?: AgendaPriority;
  sectionId?: string;
}

export interface AgendaInputs {
  vaccinations: {
    id: string;
    vaccine_name: string;
    next_due: string | null;
    section_id?: string | null;
    cattle_id?: string | null;
    sections?: { name: string } | null;
  }[];
  crops: {
    id: string;
    crop_type: string;
    status: string | null;
    expected_harvest: string | null;
    actual_harvest: string | null;
    section_id?: string | null;
    sections?: { name: string } | null;
  }[];
  tasks: {
    id: string;
    title: string;
    due_date: string | null;
    priority: AgendaPriority;
    status: string;
    section_id?: string | null;
    cattle_id?: string | null;
    crop_id?: string | null;
    sections?: { name: string } | null;
  }[];
}

const AGENDA_PREFIX: Record<AgendaKind, string> = {
  task: "tsk-",
  vaccination: "vac-",
  harvest: "crp-",
};

const AGENDA_HREF: Record<AgendaKind, string> = {
  task: "/gestion/tareas?taskId=",
  vaccination: "/produccion/sanidad?vaccinationId=",
  harvest: "/produccion/agricultura?cropId=",
};

const PRIORITY_ORDER: Record<AgendaPriority, number> = { high: 0, medium: 1, low: 2 };

export function buildAgenda(input: AgendaInputs, now: number, horizonDays = 60): AgendaItem[] {
  const deadlines: DeadlineInput[] = [
    ...input.vaccinations.map((vaccination) => ({
      id: vaccination.id,
      kind: "vaccination" as const,
      label: `Vacunación: ${vaccination.vaccine_name}`,
      date: vaccination.next_due,
      sectionName: vaccination.sections?.name,
      sectionId: vaccination.section_id,
      cattleId: vaccination.cattle_id,
    })),
    ...input.crops
      .filter((crop) => crop.expected_harvest && !crop.actual_harvest && crop.status !== "harvested" && crop.status !== "failed")
      .map((crop) => ({
        id: crop.id,
        kind: "harvest" as const,
        label: `Cosecha: ${crop.crop_type}`,
        date: crop.expected_harvest,
        sectionName: crop.sections?.name,
        sectionId: crop.section_id,
        cropId: crop.id,
      })),
    ...input.tasks
      .filter((task) => task.status !== "completed" && task.due_date)
      .map((task) => ({
        id: task.id,
        kind: "task" as const,
        label: `Tarea: ${task.title}`,
        date: task.due_date,
        sectionName: task.sections?.name,
        sectionId: task.section_id,
        cattleId: task.cattle_id,
        cropId: task.crop_id,
        priority: task.priority,
      })),
  ];

  const taskPriority = new Map(input.tasks.map((task) => [task.id, task.priority]));
  return buildDeadlineActions(deadlines, now, horizonDays)
    .map((action) => {
      const priority = action.kind === "task" ? taskPriority.get(action.id) : undefined;
      return {
        id: `${AGENDA_PREFIX[action.kind]}${action.id}`,
        kind: action.kind,
        date: action.date.slice(0, 10),
        daysFromNow: action.daysUntil,
        title: action.label,
        detail: action.detail,
        href: `${AGENDA_HREF[action.kind]}${encodeURIComponent(action.id)}`,
        ...(priority ? { priority } : {}),
        ...(action.sectionId ? { sectionId: action.sectionId } : {}),
      };
    })
    .sort((a, b) => {
      const dateOrder = a.date.localeCompare(b.date);
      if (dateOrder !== 0) return dateOrder;
      return (PRIORITY_ORDER[a.priority || "medium"] ?? 1) - (PRIORITY_ORDER[b.priority || "medium"] ?? 1);
    });
}

export function adjustAgendaToLocalDay(items: AgendaItem[], localTodayISO: string): AgendaItem[] {
  const today = Date.parse(localTodayISO);
  if (!Number.isFinite(today)) return items;
  return items.map((item) => ({
    ...item,
    daysFromNow: Math.round((Date.parse(item.date) - today) / 86_400_000),
  }));
}

export interface AgendaDayGroup {
  date: string;
  items: AgendaItem[];
}

export function groupAgendaByDay(items: AgendaItem[]): { overdue: AgendaItem[]; days: AgendaDayGroup[] } {
  const overdue = items.filter((item) => item.daysFromNow < 0);
  const days: AgendaDayGroup[] = [];
  for (const item of items.filter((entry) => entry.daysFromNow >= 0)) {
    const last = days[days.length - 1];
    if (last?.date === item.date) last.items.push(item);
    else days.push({ date: item.date, items: [item] });
  }
  return { overdue, days };
}

export function taskIdFromAgendaItemId(id: string): string | null {
  return id.startsWith(AGENDA_PREFIX.task) && id.length > AGENDA_PREFIX.task.length
    ? id.slice(AGENDA_PREFIX.task.length)
    : null;
}

/** Color is the item's state, not its kind: overdue, due today, or later. */
export function agendaDueTone(item: Pick<AgendaItem, "daysFromNow">): Tone {
  if (item.daysFromNow < 0) return "bad";
  if (item.daysFromNow === 0) return "warn";
  return "neutral";
}

/** "Tarea: Revisar alambrado" → "Revisar alambrado", for compact chips that
 * already show the kind as an icon. */
export function shortAgendaLabel(title: string): string {
  const match = /^(?:Tarea|Vacunación|Cosecha):\s*(.+)$/.exec(title);
  return match ? match[1] : title;
}

// Calendar window: an explicit from/to range (a month grid spans at most six
// weeks) instead of "the next N days". Validated and capped server-side.
export const MAX_AGENDA_WINDOW_DAYS = 62;
export const MAX_AGENDA_WINDOW_REACH_DAYS = 730;

export interface AgendaWindow {
  from: string;
  to: string;
}

/** null when neither bound was sent (the horizon mode applies). */
export function parseAgendaWindow(from: string | null, to: string | null, today: string): { window: AgendaWindow } | { error: string } | null {
  if (from === null && to === null) return null;
  if (!isValidDateOnly(from) || !isValidDateOnly(to)) return { error: "El período del calendario necesita fechas desde y hasta válidas (AAAA-MM-DD)." };
  if (from > to) return { error: "La fecha desde no puede ser posterior a la fecha hasta." };
  if (daysBetween(from, to) + 1 > MAX_AGENDA_WINDOW_DAYS) return { error: `El calendario carga como máximo ${MAX_AGENDA_WINDOW_DAYS} días por vez.` };
  if (from < addDays(today, -MAX_AGENDA_WINDOW_REACH_DAYS) || to > addDays(today, MAX_AGENDA_WINDOW_REACH_DAYS)) {
    return { error: "El calendario llega hasta dos años antes o después de hoy." };
  }
  return { window: { from, to } };
}

/** Horizon (days ahead) buildAgenda needs to reach the window's last day,
 * padded one day because the server's clock reads the UTC day. */
export function agendaWindowHorizon(window: AgendaWindow, today: string): number {
  return Math.max(0, daysBetween(today, window.to) + 1);
}

export function filterAgendaWindow(items: AgendaItem[], window: AgendaWindow): AgendaItem[] {
  return items.filter((item) => item.date >= window.from && item.date <= window.to);
}

export function countOverdueBefore(items: AgendaItem[], day: string): number {
  return items.filter((item) => item.daysFromNow < 0 && item.date < day).length;
}
