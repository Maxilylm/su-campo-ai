const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/;

/**
 * Read an optional retry key without accepting arbitrary header contents.
 * `false` means the caller supplied a malformed key; `null` means no key.
 */
export function parseIdempotencyKey(value: string | null): string | null | false {
  if (value == null || value.trim() === "") return null;
  const key = value.trim();
  return IDEMPOTENCY_KEY_PATTERN.test(key) ? key : false;
}
