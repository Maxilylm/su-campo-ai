import { describe, expect, it, vi } from "vitest";
import { createKeyedCache } from "./keyed-cache";

describe("createKeyedCache", () => {
  it("shares one in-flight load among concurrent callers", async () => {
    const cache = createKeyedCache<number>({ ttlMs: 1000 });
    const load = vi.fn(async () => 7);
    const results = await Promise.all([1, 2, 3].map(() => cache.get("u", load, () => true)));
    expect(results).toEqual([7, 7, 7]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("reuses cacheable values until the TTL passes", async () => {
    let clock = 0;
    const cache = createKeyedCache<number>({ ttlMs: 100, now: () => clock });
    const load = vi.fn(async () => clock);
    await cache.get("u", load, () => true);
    clock = 99;
    expect(await cache.get("u", load, () => true)).toBe(0);
    clock = 100;
    expect(await cache.get("u", load, () => true)).toBe(100);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("never caches values the caller rejects, and forgets on invalidate", async () => {
    const cache = createKeyedCache<string>({ ttlMs: 1000 });
    const failing = vi.fn(async () => "error");
    await cache.get("u", failing, (value) => value !== "error");
    await cache.get("u", failing, (value) => value !== "error");
    expect(failing).toHaveBeenCalledTimes(2);
    const ok = vi.fn(async () => "ok");
    await cache.get("v", ok, () => true);
    cache.invalidate("v");
    await cache.get("v", ok, () => true);
    expect(ok).toHaveBeenCalledTimes(2);
  });

  it("does not re-cache a load that was in flight when the key was invalidated", async () => {
    const cache = createKeyedCache<string>({ ttlMs: 60_000 });
    let release!: (value: string) => void;
    const stale = cache.get("u", () => new Promise<string>((resolve) => { release = resolve; }), () => true);
    cache.invalidate("u"); // membership changed while the old lookup was running
    release("editor");
    expect(await stale).toBe("editor"); // the request already in progress still gets its answer
    const fresh = vi.fn(async () => "viewer");
    expect(await cache.get("u", fresh, () => true)).toBe("viewer");
    expect(fresh).toHaveBeenCalledTimes(1);
  });

  it("keeps separate keys separate and bounds its size", async () => {
    const cache = createKeyedCache<string>({ ttlMs: 1000, maxEntries: 2 });
    const load = vi.fn(async () => "x");
    await cache.get("a", load, () => true);
    await cache.get("b", load, () => true);
    await cache.get("c", load, () => true); // evicts "a"
    await cache.get("a", load, () => true);
    expect(load).toHaveBeenCalledTimes(4);
  });
});
