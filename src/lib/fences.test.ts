import { describe, expect, it } from "vitest";
import { fenceKindOf, fenceProperties, fenceStrandsOf, fenceStyle, fenceTotals } from "./fences";

const line = (meters: number) => ({ type: "LineString", coordinates: [[-56.5, -33.0], [-56.5, -33.0 + meters / 111_195]] });

describe("fence kind and properties", () => {
  it("defaults legacy fences to convencional", () => {
    expect(fenceKindOf(undefined)).toBe("convencional");
    expect(fenceKindOf({})).toBe("convencional");
    expect(fenceKindOf({ fence_kind: "electrico" })).toBe("electrico");
    expect(fenceKindOf({ fence_kind: "laser" })).toBe("convencional");
  });
  it("validates strands", () => {
    expect(fenceStrandsOf({ strands: 5 })).toBe(5);
    expect(fenceStrandsOf({ strands: 0 })).toBeNull();
    expect(fenceStrandsOf({ strands: 2.5 })).toBeNull();
    expect(fenceProperties({ kind: "electrico", strands: "3" })).toEqual({ fence_kind: "electrico", strands: 3 });
    expect(fenceProperties({ kind: "<b>", strands: 99 })).toEqual({ fence_kind: "convencional" });
  });
});

describe("fenceTotals", () => {
  it("sums only alambrados, split by kind", () => {
    const totals = fenceTotals([
      { type: "alambrado", geometry: line(1000), properties: {} },
      { type: "alambrado", geometry: line(500), properties: { fence_kind: "electrico" } },
      { type: "road", geometry: line(9000) },
      { type: "alambrado", geometry: { type: "Point", coordinates: [0, 0] } },
    ]);
    expect(totals.count).toBe(3);
    expect(totals.totalM).toBeCloseTo(1500, 0);
    expect(totals.byKind.convencional.count).toBe(2);
    expect(totals.byKind.convencional.meters).toBeCloseTo(1000, 0);
    expect(totals.byKind.electrico.meters).toBeCloseTo(500, 0);
  });
});

describe("fenceStyle", () => {
  it("grows with zoom and stays inside its range", () => {
    expect(fenceStyle("convencional", 12).weight).toBe(1.5);
    expect(fenceStyle("convencional", 15).weight).toBe(2.5);
    expect(fenceStyle("convencional", 19).weight).toBe(3.5);
    expect(fenceStyle("convencional", Number.NaN).weight).toBe(2.5);
  });
  it("dashes only the electric fence and always draws a wider casing", () => {
    expect(fenceStyle("convencional", 16).dashArray).toBeUndefined();
    expect(fenceStyle("electrico", 16).dashArray).toMatch(/^\d+ \d+$/);
    for (const zoom of [10, 14, 18]) {
      const style = fenceStyle("electrico", zoom);
      expect(style.casingWeight).toBeGreaterThan(style.weight);
    }
  });
});
