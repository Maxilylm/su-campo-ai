// Token-bucket rate limiter, keyed per farm/scope. Backed by a shared
// Postgres table + atomic RPC (migration 036) so the limit is real across
// serverless instances, not per-instance. Falls back to an in-memory bucket
// (per-instance, best-effort) if the migration isn't applied yet or Supabase
// is unreachable, so a rate-limit outage never turns into a 500.

export interface BucketState {
  tokens: number;
  updated: number; // ms epoch of last refill
}

export interface BucketOptions {
  capacity: number; // max burst
  refillPerSec: number; // sustained rate
}

export interface RateResult {
  allowed: boolean;
  state: BucketState;
  retryAfterSec: number;
}

// Pure core: given the prior state and current time, decide if one token is available.
export function consumeToken(
  prev: BucketState | undefined,
  now: number,
  opts: BucketOptions
): RateResult {
  const state: BucketState = prev
    ? { ...prev }
    : { tokens: opts.capacity, updated: now };

  // Refill based on elapsed time, capped at capacity.
  const elapsedSec = Math.max(0, (now - state.updated) / 1000);
  state.tokens = Math.min(opts.capacity, state.tokens + elapsedSec * opts.refillPerSec);
  state.updated = now;

  if (state.tokens >= 1) {
    state.tokens -= 1;
    return { allowed: true, state, retryAfterSec: 0 };
  }
  const deficit = 1 - state.tokens;
  const retryAfterSec = Math.ceil(deficit / opts.refillPerSec);
  return { allowed: false, state, retryAfterSec };
}

// In-memory fallback store + Date.now() wrapper.
const buckets = new Map<string, BucketState>();

function checkRateLimitInMemory(key: string, opts: BucketOptions): { allowed: boolean; retryAfterSec: number } {
  const result = consumeToken(buckets.get(key), Date.now(), opts);
  buckets.set(key, result.state);
  return { allowed: result.allowed, retryAfterSec: result.retryAfterSec };
}

// Default: burst of 10, refill 1 token / 6s (~10 sustained requests/min per farm).
const DEFAULTS: BucketOptions = { capacity: 10, refillPerSec: 1 / 6 };

export async function checkRateLimit(
  key: string,
  opts: BucketOptions = DEFAULTS
): Promise<{ allowed: boolean; retryAfterSec: number }> {
  try {
    const { getSupabaseAdmin } = await import("./supabase");
    const db = getSupabaseAdmin();
    const { data, error } = await db
      .rpc("consume_rate_limit_token", { p_key: key, p_capacity: opts.capacity, p_refill_per_sec: opts.refillPerSec })
      .single();
    if (!error && data) {
      const row = data as { allowed: boolean; retry_after_sec: number };
      return { allowed: Boolean(row.allowed), retryAfterSec: Number(row.retry_after_sec) || 0 };
    }
  } catch {
    // Fall through to the in-memory fallback below.
  }
  return checkRateLimitInMemory(key, opts);
}
