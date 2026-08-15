export const SUPABASE_READ_TIMEOUT_MS = 7_000;

/**
 * Resolve a slow dependency with a bounded fallback instead of leaving the
 * caller waiting for the platform's invocation timeout.
 *
 * The original operation is intentionally not cancelled here: this helper is
 * used around Supabase promises whose query builder is already created. The
 * timeout protects the request that owns the operation, while the attached
 * handlers prevent a late rejection from becoming an unhandled promise.
 */
export function withTimeout<T>(operation: PromiseLike<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      resolve(fallback);
    }, timeoutMs);

    Promise.resolve(operation).then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      (error) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
      },
    );
  });
}
