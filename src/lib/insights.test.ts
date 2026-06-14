import { describe, it, expect } from "vitest";
import { isStale } from "./insights";

const NOW = new Date("2026-06-14T12:00:00Z").getTime();
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe("isStale", () => {
  it("treats missing or invalid timestamps as stale", () => {
    expect(isStale(null, NOW)).toBe(true);
    expect(isStale(undefined, NOW)).toBe(true);
    expect(isStale("not-a-date", NOW)).toBe(true);
  });
  it("is fresh within the window", () => {
    expect(isStale(ago(3), NOW)).toBe(false);
  });
  it("is stale past the window", () => {
    expect(isStale(ago(8), NOW)).toBe(true);
  });
  it("respects a custom max age", () => {
    expect(isStale(ago(2), NOW, 1)).toBe(true);
    expect(isStale(ago(2), NOW, 5)).toBe(false);
  });
});
