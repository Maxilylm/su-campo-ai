import { isPastCalendarDate } from "./date";

export interface CropMetricRow {
  status?: string | null;
  yield_kg?: number | null;
  planted_hectares?: number | null;
}

export function countOverdueDates(values: Array<string | null | undefined>, today: string): number {
  return values.filter((value) => isPastCalendarDate(value, today)).length;
}

export function averageValidCropYield(crops: CropMetricRow[]): number {
  const yields = crops
    .map((crop) => {
      const yieldKg = crop.yield_kg;
      const plantedHectares = crop.planted_hectares;
      return typeof yieldKg === "number" && Number.isFinite(yieldKg) && yieldKg >= 0
        && typeof plantedHectares === "number" && Number.isFinite(plantedHectares) && plantedHectares > 0
        ? yieldKg / plantedHectares
        : null;
    })
    .filter((value): value is number => value !== null);
  return yields.length > 0 ? yields.reduce((total, value) => total + value, 0) / yields.length : 0;
}

export function countActiveCrops(crops: Array<{ status?: string | null }>): number {
  return crops.filter((crop) => crop.status !== "harvested" && crop.status !== "failed").length;
}

/** Health events that are problems (not routine management like births or weaning). */
export const HEALTH_PROBLEM_TYPES = new Set(["enfermedad", "lesion", "muerte"]);

/** Illness, injury and death cases per month from `since` (YYYY-MM-DD), oldest first. */
export function healthProblemsByMonth(
  events: Array<{ type?: string | null; date_occurred?: string | null }>,
  since: string,
): { month: string; count: number; deaths: number }[] {
  const byMonth = new Map<string, { count: number; deaths: number }>();
  for (const event of events) {
    if (typeof event.date_occurred !== "string" || event.date_occurred.slice(0, 10) < since) continue;
    if (!event.type || !HEALTH_PROBLEM_TYPES.has(event.type)) continue;
    const month = event.date_occurred.slice(0, 7);
    const slot = byMonth.get(month) || { count: 0, deaths: 0 };
    slot.count += 1;
    if (event.type === "muerte") slot.deaths += 1;
    byMonth.set(month, slot);
  }
  return [...byMonth.entries()]
    .map(([month, slot]) => ({ month, ...slot }))
    .sort((a, b) => a.month.localeCompare(b.month));
}
