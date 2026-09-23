// Per-instance cache for a small, hot lookup: concurrent callers for the same
// key share one in-flight promise, and a result the caller marks cacheable is
// reused for `ttlMs`. Failures are never cached, so the next call retries.

export interface KeyedCache<T> {
  get(key: string, load: () => Promise<T>, cacheable: (value: T) => boolean): Promise<T>;
  invalidate(key: string): void;
  clear(): void;
}

export function createKeyedCache<T>(options: { ttlMs: number; maxEntries?: number; now?: () => number }): KeyedCache<T> {
  const now = options.now ?? Date.now;
  const maxEntries = options.maxEntries ?? 500;
  const values = new Map<string, { value: T; expiresAt: number }>();
  const inFlight = new Map<string, Promise<T>>();

  return {
    get(key, load, cacheable) {
      const hit = values.get(key);
      if (hit && hit.expiresAt > now()) return Promise.resolve(hit.value);
      if (hit) values.delete(key);
      const pending = inFlight.get(key);
      if (pending) return pending;

      const promise = load()
        .then((value) => {
          if (cacheable(value)) {
            if (values.size >= maxEntries) values.delete(values.keys().next().value as string);
            values.set(key, { value, expiresAt: now() + options.ttlMs });
          }
          return value;
        })
        .finally(() => {
          if (inFlight.get(key) === promise) inFlight.delete(key);
        });
      inFlight.set(key, promise);
      return promise;
    },
    invalidate(key) {
      values.delete(key);
      inFlight.delete(key);
    },
    clear() {
      values.clear();
      inFlight.clear();
    },
  };
}
