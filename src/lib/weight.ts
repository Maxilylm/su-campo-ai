// Pure weight / average-daily-gain helpers — no IO, unit-testable.

export interface WeightRecord { date: string; weight_kg: number }

// Sort ascending by date (does not mutate the input).
export function sortByDate(records: WeightRecord[]): WeightRecord[] {
  return [...records].sort((a, b) => a.date.localeCompare(b.date));
}

// Average daily gain (kg/day) between the first and last weighing.
// Returns null if there aren't two weighings spanning at least one day.
export function computeADG(records: WeightRecord[]): number | null {
  if (records.length < 2) return null;
  const sorted = sortByDate(records);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const days = (new Date(last.date).getTime() - new Date(first.date).getTime()) / 86_400_000;
  if (days <= 0) return null;
  return (last.weight_kg - first.weight_kg) / days;
}

export interface BatchWeightGain {
  id: string;
  label: string;
  /** kg/day between the batch's first and last weighing in the records. */
  adg: number;
  weighings: number;
  days: number;
  lastWeight: number;
}

// Daily gain per batch, best first. Batches need two weighings on different
// days; records of batches that no longer exist are ignored.
export function adgByBatch(
  records: { cattle_id: string; date: string; weight_kg: number }[],
  batches: { id: string; category: string; breed?: string | null }[],
): BatchWeightGain[] {
  const byBatch = new Map<string, WeightRecord[]>();
  for (const record of records) {
    if (!Number.isFinite(record.weight_kg)) continue;
    const list = byBatch.get(record.cattle_id) || [];
    list.push({ date: record.date, weight_kg: record.weight_kg });
    byBatch.set(record.cattle_id, list);
  }
  return batches
    .flatMap((batch) => {
      const weighings = byBatch.get(batch.id) || [];
      const adg = computeADG(weighings);
      if (adg === null) return [];
      const sorted = sortByDate(weighings);
      const last = sorted[sorted.length - 1];
      return [{
        id: batch.id,
        label: `${batch.category}${batch.breed ? ` (${batch.breed})` : ""}`,
        adg: Math.round(adg * 1000) / 1000,
        weighings: weighings.length,
        days: Math.round((new Date(last.date).getTime() - new Date(sorted[0].date).getTime()) / 86_400_000),
        lastWeight: last.weight_kg,
      }];
    })
    .sort((a, b) => b.adg - a.adg || a.label.localeCompare(b.label));
}
