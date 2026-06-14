// Pure staleness check for cached insights — unit-testable.
export function isStale(generatedAtIso: string | null | undefined, now: number, maxAgeDays = 7): boolean {
  if (!generatedAtIso) return true;
  const t = new Date(generatedAtIso).getTime();
  if (Number.isNaN(t)) return true;
  return now - t > maxAgeDays * 86_400_000;
}
