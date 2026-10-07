// Idempotency-key bookkeeping for the import dialog. The key follows the
// exact rows sent: resending the same rows (a retry after a timeout, or the
// same file picked again) reuses the key so the server replays instead of
// importing twice; different rows, or rows the server definitely rejected,
// get a fresh key so they are not answered with the old batch.

export interface ImportAttempt {
  key: string;
  endpoint: string;
  /** JSON of the rows sent. */
  body: string;
}

export type ImportOutcome = "saved" | "rejected" | "uncertain";

/** The key for sending `body` to `endpoint`, reusing the previous attempt's only for identical rows. */
export function attemptFor(previous: ImportAttempt | null, endpoint: string, body: string, newKey: () => string): ImportAttempt {
  if (previous && previous.endpoint === endpoint && previous.body === body) return previous;
  return { key: newKey(), endpoint, body };
}

/**
 * What a response says about the write. A 2xx saved it. A 4xx with a JSON
 * error is a definite rejection made before writing (validation, conflict,
 * rate limit). A 5xx, or a body that isn't the API's JSON (platform timeout
 * or crash page), may have happened after the insert: uncertain.
 */
export function classifyImportResponse(status: number, payloadIsJson: boolean): ImportOutcome {
  if (status >= 200 && status < 300) return "saved";
  if (status >= 500 || !payloadIsJson) return "uncertain";
  return "rejected";
}

/** The attempt to remember after an outcome: only an uncertain one must be retried with the same key. */
export function attemptAfter(outcome: ImportOutcome, attempt: ImportAttempt): ImportAttempt | null {
  return outcome === "uncertain" ? attempt : null;
}
