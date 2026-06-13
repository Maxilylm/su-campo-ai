import { describe, it, expect } from "vitest";
import { computeCattleSplit } from "./cattle";

describe("computeCattleSplit", () => {
  it("moves the whole batch when move_count equals the source count", () => {
    expect(computeCattleSplit(30, 30)).toEqual({ mode: "all", moved: 30 });
  });

  it("moves the whole batch when move_count exceeds the source count", () => {
    expect(computeCattleSplit(30, 50)).toEqual({ mode: "all", moved: 30 });
  });

  it("splits the batch on a partial move", () => {
    expect(computeCattleSplit(30, 10)).toEqual({
      mode: "split",
      moved: 10,
      remaining: 20,
    });
  });

  it("rejects a non-positive move_count", () => {
    expect(computeCattleSplit(30, 0).mode).toBe("invalid");
    expect(computeCattleSplit(30, -5).mode).toBe("invalid");
  });

  it("rejects an empty source batch", () => {
    expect(computeCattleSplit(0, 5).mode).toBe("invalid");
  });

  it("conserves head count on a split (moved + remaining === source)", () => {
    const r = computeCattleSplit(100, 37);
    if (r.mode !== "split") throw new Error("expected split");
    expect(r.moved + r.remaining).toBe(100);
  });
});
