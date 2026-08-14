// Pure forward-agenda derivation — no DB access, so it can be unit-tested.
// Complements lib/alerts.ts: alerts is a reactive warning list; the agenda is a
// date-grouped work plan (what to do, on which day, over the next N days).

export type AgendaKind = "vaccination" | "harvest";

export interface AgendaItem {
  id: string;
  kind: AgendaKind;
  /** Day-precision ISO date (YYYY-MM-DD, UTC) the task falls on. */
  date: string;
  /** Whole days from `now` to the task's day; negative = overdue. */
  daysFromNow: number;
  title: string;
  detail: string;
  href: string;
}

export interface AgendaInputs {
  vaccinations: {
    id: string;
    vaccine_name: string;
    next_due: string | null;
    head_count: number | null;
    sections?: { name: string } | null;
  }[];
  crops: {
    id: string;
    crop_type: string;
    status: string | null;
    expected_harvest: string | null;
    actual_harvest: string | null;
    sections?: { name: string } | null;
  }[];
}

const DAY = 86_400_000;
const DEFAULT_HORIZON_DAYS = 60;

const toDay = (iso: string) => new Date(iso).toISOString().slice(0, 10);

function dayDiff(iso: string, now: number): number {
  const target = Date.parse(toDay(iso));
  const today = Date.parse(toDay(new Date(now).toISOString()));
  return Math.round((target - today) / DAY);
}

export function buildAgenda(
  input: AgendaInputs,
  now: number,
  horizonDays: number = DEFAULT_HORIZON_DAYS
): AgendaItem[] {
  const items: AgendaItem[] = [];

  for (const v of input.vaccinations) {
    if (!v.next_due) continue;
    const d = dayDiff(v.next_due, now);
    if (d > horizonDays) continue;
    const where = v.sections?.name ? ` · ${v.sections.name}` : "";
    const heads = v.head_count ? `${v.head_count} cabezas` : "";
    items.push({
      id: `vac-${v.id}`,
      kind: "vaccination",
      date: toDay(v.next_due),
      daysFromNow: d,
      title: `Vacunación: ${v.vaccine_name}`,
      detail: `${heads}${where}`.trim() || "Sin detalle",
      href: "/produccion/sanidad",
    });
  }

  for (const c of input.crops) {
    if (!c.expected_harvest || c.actual_harvest || c.status === "failed" || c.status === "harvested") continue;
    const d = dayDiff(c.expected_harvest, now);
    if (d > horizonDays) continue;
    const where = c.sections?.name ? ` · ${c.sections.name}` : "";
    items.push({
      id: `har-${c.id}`,
      kind: "harvest",
      date: toDay(c.expected_harvest),
      daysFromNow: d,
      title: `Cosecha: ${c.crop_type}`,
      detail: `Cosecha estimada${where}`,
      href: "/produccion/agricultura",
    });
  }

  return items.sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Recompute each item's `daysFromNow` against the viewer's local calendar day.
 * The API derives daysFromNow from the server's UTC day, so a viewer west of
 * UTC (e.g. UTC-3 at 22:00 local = 01:00 UTC next day) would see tomorrow's
 * tasks labelled "Hoy". Both arguments are day-precision "YYYY-MM-DD" strings.
 * Returns a new array; inputs are not mutated.
 */
export function adjustAgendaToLocalDay(items: AgendaItem[], localTodayISO: string): AgendaItem[] {
  const today = Date.parse(localTodayISO);
  return items.map((item) => ({
    ...item,
    daysFromNow: Math.round((Date.parse(item.date) - today) / DAY),
  }));
}

export interface AgendaDayGroup {
  date: string;
  items: AgendaItem[];
}

export function groupAgendaByDay(items: AgendaItem[]): {
  overdue: AgendaItem[];
  days: AgendaDayGroup[];
} {
  const overdue = items.filter((i) => i.daysFromNow < 0);
  const days: AgendaDayGroup[] = [];
  for (const item of items.filter((i) => i.daysFromNow >= 0)) {
    const last = days[days.length - 1];
    if (last && last.date === item.date) last.items.push(item);
    else days.push({ date: item.date, items: [item] });
  }
  return { overdue, days };
}
