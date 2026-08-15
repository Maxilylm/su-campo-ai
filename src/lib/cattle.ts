// Pure decision logic for moving a cattle batch between sections.
// Kept free of any DB access so it can be unit-tested in isolation;
// `executeOperations` consumes the result and performs the actual writes.

export const CATTLE_CATEGORIES = [
  "vaca", "toro", "ternero", "ternera", "novillo", "vaquillona", "caballo", "yegua", "oveja",
] as const;

export function isValidCattleCategory(value: unknown): value is (typeof CATTLE_CATEGORIES)[number] {
  return typeof value === "string" && (CATTLE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Caravanas identify an individual record within a field. Compare them in a
 * forgiving way so accidental spaces, casing, or Unicode presentation forms
 * cannot create two records for the same physical tag.
 */
export function normalizedEarTag(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").trim().toUpperCase();
  return normalized || null;
}

/** Build a small bounded set of database values that match the tag index. */
export function earTagCandidates(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const normalizedValue = value.normalize("NFKC");
  const trimmed = normalizedValue.trim();
  const normalized = normalizedEarTag(value);
  if (!normalized) return [];
  return [...new Set([
    value,
    normalizedValue,
    trimmed,
    trimmed.toLowerCase(),
    trimmed.toUpperCase(),
    ` ${trimmed}`,
    `${trimmed} `,
    ` ${trimmed} `,
  ])];
}

export function duplicateEarTags(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const value of values) {
    const tag = normalizedEarTag(value);
    if (!tag) continue;
    if (seen.has(tag)) duplicates.add(tag);
    seen.add(tag);
  }
  return [...duplicates];
}

export type CattleSplit =
  | { mode: "invalid"; reason: string }
  | { mode: "all"; moved: number }
  | { mode: "split"; moved: number; remaining: number };

export function computeCattleSplit(
  sourceCount: number,
  moveCount: number
): CattleSplit {
  if (!Number.isFinite(sourceCount) || sourceCount <= 0) {
    return { mode: "invalid", reason: "source batch is empty" };
  }
  if (!Number.isFinite(moveCount) || moveCount <= 0) {
    return { mode: "invalid", reason: "move_count must be positive" };
  }
  if (moveCount >= sourceCount) {
    // Moving the whole batch (or more than exists) — relocate the record as-is.
    return { mode: "all", moved: sourceCount };
  }
  // Partial move — source shrinks, a new record is created at the destination.
  return { mode: "split", moved: moveCount, remaining: sourceCount - moveCount };
}
