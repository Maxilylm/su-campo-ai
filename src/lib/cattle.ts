// Pure decision logic for moving a cattle batch between sections.
// Kept free of any DB access so it can be unit-tested in isolation;
// `executeOperations` consumes the result and performs the actual writes.

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
