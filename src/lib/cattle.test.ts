import { describe, it, expect } from "vitest";
import { computeCattleSplit, duplicateEarTags, isValidCattleCategory, normalizedEarTag } from "./cattle";

describe("isValidCattleCategory", () => {
  it("accepts the categories supported by the app", () => {
    expect(isValidCattleCategory("vaca")).toBe(true);
    expect(isValidCattleCategory("novillo")).toBe(true);
  });

  it("rejects arbitrary or non-string categories", () => {
    expect(isValidCattleCategory("capibara")).toBe(false);
    expect(isValidCattleCategory(null)).toBe(false);
    expect(isValidCattleCategory(1)).toBe(false);
  });
});

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

describe("ear tag identity", () => {
  it("normalizes spaces, casing, and Unicode presentation forms", () => {
    expect(normalizedEarTag("  a－１０  ")).toBe("A-10");
    expect(normalizedEarTag("   ")).toBeNull();
  });

  it("finds duplicate non-empty tags without treating blank tags as identities", () => {
    expect(duplicateEarTags(["A-10", " a-10 ", "", null, "B-2", "b-2"])).toEqual(["A-10", "B-2"]);
  });
});
