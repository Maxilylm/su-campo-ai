// Lightweight in-memory token-bucket rate limiter to protect the Groq free tier.
// Keyed per farm. In-memory means per-serverless-instance (not globally shared),
// which is fine as a cheap abuse/runaway guard — not a billing-grade limiter.

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

// Module-level store + Date.now() wrapper for use in route handlers.
const buckets = new Map<string, BucketState>();

// Default: burst of 10, refill 1 token / 6s (~10 sustained requests/min per farm).
const DEFAULTS: BucketOptions = { capacity: 10, refillPerSec: 1 / 6 };

export function checkRateLimit(
  key: string,
  opts: BucketOptions = DEFAULTS
): { allowed: boolean; retryAfterSec: number } {
  const result = consumeToken(buckets.get(key), Date.now(), opts);
  buckets.set(key, result.state);
  return { allowed: result.allowed, retryAfterSec: result.retryAfterSec };
}
