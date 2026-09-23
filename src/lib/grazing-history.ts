import { DEFAULT_MIN_REST_DAYS, type SectionFieldStatus } from "./grazing";

// Grazing history per potrero (migration 047): past occupations, the rest
// between them, and the pressure the potrero carried. Pure, so the panel,
// the plan and the assistant read the same numbers.

export interface GrazingPeriodRow {
  section_id: string;
  started_at: string;
  ended_at: string | null;
  heads_at_start: number;
  /** Most heads seen during the period (048); absent on rows read before it. */
  peak_heads?: number | null;
}

export interface GrazingPeriodSummary {
  startedAt: string;
  endedAt: string | null;
  days: number;
  heads: number;
  /** Rest before this period started, when the previous one is known. */
  restBeforeDays: number | null;
}

export interface GrazingHistory {
  periods: GrazingPeriodSummary[];
  /** Last full rest (between the two most recent periods); null if unknown. */
  lastRestDays: number | null;
  /** The last full rest was shorter than the recommended minimum. */
  lastRestShort: boolean;
  /** Head-days over the window, from heads at each period's start. */
  animalDays: number;
  animalDaysPerHa: number | null;
}

const DAY_MS = 86_400_000;

function days(fromIso: string, toMs: number): number {
  return Math.max(0, Math.round((toMs - Date.parse(fromIso)) / DAY_MS));
}

/** Newest first. `windowDays` bounds animal-days (a season); periods that
 * straddle the window start only count their share inside it. */
/** One line for the potrero panel and the assistant, or null without history. */
export function grazingHistoryLine(history: GrazingHistory | undefined): string | null {
  if (!history || history.periods.length === 0) return null;
  const parts: string[] = [];
  if (history.lastRestDays != null) parts.push(`último descanso ${history.lastRestDays} d${history.lastRestShort ? " (corto)" : ""}`);
  const closed = history.periods.filter((period) => period.endedAt).length;
  if (closed > 0) parts.push(`${closed} ${closed === 1 ? "pastoreo registrado" : "pastoreos registrados"}`);
  if (history.animalDaysPerHa != null && history.animalDaysPerHa > 0) parts.push(`${history.animalDaysPerHa} días-animal/ha en 12 meses`);
  return parts.length ? parts.join(" · ") : null;
}

export function summarizeGrazingHistory(
  rows: GrazingPeriodRow[],
  hectares: number | null,
  now: number,
  options: { windowDays?: number; minRestDays?: number; limit?: number } = {},
): GrazingHistory {
  const windowStart = now - (options.windowDays ?? 365) * DAY_MS;
  const minRest = options.minRestDays ?? DEFAULT_MIN_REST_DAYS;
  const sorted = rows
    .filter((row) => Number.isFinite(Date.parse(row.started_at)))
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));

  let animalDays = 0;
  const chronological: GrazingPeriodSummary[] = sorted.map((row, index) => {
    const end = row.ended_at ? Date.parse(row.ended_at) : now;
    const previous = sorted[index - 1];
    const restBeforeDays = previous?.ended_at ? days(previous.ended_at, Date.parse(row.started_at)) : null;
    const inWindowStart = Math.max(Date.parse(row.started_at), windowStart);
    // A herd arrives batch by batch, so the peak -- not the heads when the
    // period opened -- is what the potrero carried.
    const heads = Math.max(0, row.heads_at_start, row.peak_heads ?? 0);
    if (end > inWindowStart) animalDays += heads * ((end - inWindowStart) / DAY_MS);
    return { startedAt: row.started_at, endedAt: row.ended_at, days: days(row.started_at, end), heads, restBeforeDays };
  });

  const newest = chronological.slice().reverse();
  const lastRestDays = newest.find((period) => period.restBeforeDays != null)?.restBeforeDays ?? null;
  const roundedAnimalDays = Math.round(animalDays);
  return {
    periods: newest.slice(0, options.limit ?? 5),
    lastRestDays,
    lastRestShort: lastRestDays != null && lastRestDays < minRest,
    animalDays: roundedAnimalDays,
    animalDaysPerHa: hectares && hectares > 0 ? Math.round(roundedAnimalDays / hectares) : null,
  };
}

export const GRAZING_HISTORY_WINDOW_DAYS = 365;

/** Oldest `ended_at` worth loading: the window plus enough to know the rest
 * before its first period. */
export function grazingHistorySince(now: number): string {
  return new Date(now - (GRAZING_HISTORY_WINDOW_DAYS + 60) * DAY_MS).toISOString();
}

/** Attach each potrero's summarized history, in place. Shared by the field
 * status loader and the assistant's context so they cannot disagree. */
export function attachGrazingHistory(statuses: SectionFieldStatus[], rows: GrazingPeriodRow[], now: number): void {
  const bySection = new Map<string, GrazingPeriodRow[]>();
  for (const row of rows) {
    const list = bySection.get(row.section_id) ?? [];
    list.push(row);
    bySection.set(row.section_id, list);
  }
  for (const status of statuses) {
    const sectionRows = bySection.get(status.id);
    if (sectionRows?.length) status.history = summarizeGrazingHistory(sectionRows, status.hectares, now, { windowDays: GRAZING_HISTORY_WINDOW_DAYS });
  }
}

/** The open period's running peak lives in grazing_period_peaks (049) until
 * the period closes; fold it into the open row before summarizing. */
export function withRunningPeaks(rows: GrazingPeriodRow[], peaks: { section_id: string; peak_heads: number }[]): GrazingPeriodRow[] {
  const bySection = new Map(peaks.map((peak) => [peak.section_id, peak.peak_heads]));
  return rows.map((row) => (row.ended_at === null && bySection.has(row.section_id)
    ? { ...row, peak_heads: Math.max(row.peak_heads ?? 0, bySection.get(row.section_id) ?? 0) }
    : row));
}
