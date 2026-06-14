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
