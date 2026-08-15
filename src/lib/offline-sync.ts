/** Extract the farm record from the raw /api/farm response. */
export function extractFarmFromSyncResponse(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const payload = value as Record<string, unknown>;
  return payload.farm && typeof payload.farm === "object" && !Array.isArray(payload.farm)
    ? payload.farm
    : null;
}

/** Run sync requests in bounded parallelism so one offline refresh does not
 * overload the API or Supabase connection pool. Results stay in input order. */
export async function allSettledWithConcurrency<T>(
  tasks: readonly (() => Promise<T>)[],
  concurrency: number,
  onSettled?: (completed: number, total: number) => void,
): Promise<PromiseSettledResult<T>[]> {
  if (tasks.length === 0) return [];
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency) || 1, tasks.length));
  const results = new Array<PromiseSettledResult<T>>(tasks.length);
  let nextIndex = 0;
  let completed = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= tasks.length) return;
      try {
        results[index] = { status: "fulfilled", value: await tasks[index]() };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      } finally {
        completed += 1;
        onSettled?.(completed, tasks.length);
      }
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}
