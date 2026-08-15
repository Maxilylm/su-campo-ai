// Agenda unificada: convierte tareas, vacunaciones y cosechas en un plan
// ordenado por día. La derivación es pura para poder probarla sin Supabase.
import { buildDeadlineActions, type DeadlineInput } from "./briefing";

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
