import { describe, it, expect } from "vitest";
import { consumeToken, type BucketState } from "./rate-limit";

const opts = { capacity: 3, refillPerSec: 1 }; // 3 burst, 1 token/sec

describe("consumeToken", () => {
  it("allows up to capacity on a fresh bucket", () => {
    let state: BucketState | undefined;
    let now = 1_000;
    for (let i = 0; i < 3; i++) {
      const r = consumeToken(state, now, opts);
      expect(r.allowed).toBe(true);
      state = r.state;
    }
  });

  it("blocks once tokens are exhausted", () => {
    let state: BucketState | undefined;
    const now = 1_000;
    for (let i = 0; i < 3; i++) state = consumeToken(state, now, opts).state;
    const blocked = consumeToken(state, now, opts);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBeGreaterThanOrEqual(1);
  });

  it("refills over time", () => {
    let state: BucketState | undefined;
    let now = 1_000;
    for (let i = 0; i < 3; i++) state = consumeToken(state, now, opts).state;
    expect(consumeToken(state, now, opts).allowed).toBe(false);
    // 2 seconds later → ~2 tokens back
    now += 2_000;
    const r1 = consumeToken(state, now, opts);
    expect(r1.allowed).toBe(true);
    const r2 = consumeToken(r1.state, now, opts);
    expect(r2.allowed).toBe(true);
  });

  it("never exceeds capacity on long idle", () => {
    const state: BucketState = { tokens: 3, updated: 0 };
    const r = consumeToken(state, 1_000_000, opts);
    // after consuming one, at most capacity-1 remain
    expect(r.state.tokens).toBeLessThanOrEqual(opts.capacity);
  });
});
