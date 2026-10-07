import { describe, expect, it } from "vitest";
import { formatDistance, geometryLengthMeters, haversineMeters, metersPerPixel, nearestVertex, pathLengthMeters, polygonVertices } from "./geo-measure";

describe("haversineMeters", () => {
  it("measures one degree of latitude as ~111.2 km", () => {
    expect(haversineMeters([-56, -33], [-56, -32])).toBeCloseTo(111_195, -1);
  });
  it("shrinks longitude degrees with latitude (cos 33° ≈ 0.839)", () => {
    const d = haversineMeters([-56, -33], [-55, -33]);
    expect(d).toBeGreaterThan(93_000);
    expect(d).toBeLessThan(93_500);
  });
  it("is zero for the same point and symmetric", () => {
    expect(haversineMeters([-56.1, -33.2], [-56.1, -33.2])).toBe(0);
    expect(haversineMeters([-56.1, -33.2], [-56.2, -33.25])).toBeCloseTo(haversineMeters([-56.2, -33.25], [-56.1, -33.2]), 6);
  });
});

describe("pathLengthMeters / geometryLengthMeters", () => {
  // ~100 m north then ~100 m east near Durazno.
  const north = [[-56.5, -33.0], [-56.5, -32.9991]];
  it("sums segments and skips invalid vertices", () => {
    expect(pathLengthMeters(north)).toBeCloseTo(100, 0);
    expect(pathLengthMeters([[-56.5, -33.0], ["x", 1], [-56.5, -32.9991]])).toBeCloseTo(100, 0);
    expect(pathLengthMeters("nope")).toBe(0);
    expect(pathLengthMeters([[-56.5, -33]])).toBe(0);
  });
  it("handles LineString and MultiLineString, 0 for anything else", () => {
    expect(geometryLengthMeters({ type: "LineString", coordinates: north })).toBeCloseTo(100, 0);
    expect(geometryLengthMeters({ type: "MultiLineString", coordinates: [north, north] })).toBeCloseTo(200, 0);
    expect(geometryLengthMeters({ type: "Point", coordinates: [-56, -33] })).toBe(0);
    expect(geometryLengthMeters(null)).toBe(0);
  });
});

describe("formatDistance", () => {
  it("uses meters under a km and es-UY decimals above", () => {
    expect(formatDistance(0)).toBe("0 m");
    expect(formatDistance(349.6)).toBe("350 m");
    expect(formatDistance(1234)).toBe("1,2 km");
    expect(formatDistance(12_600)).toBe("13 km");
    expect(formatDistance(Number.NaN)).toBe("0 m");
  });
});

describe("snapping helpers", () => {
  it("metersPerPixel halves per zoom level", () => {
    expect(metersPerPixel(0, 1) / metersPerPixel(0, 2)).toBeCloseTo(2, 6);
    expect(metersPerPixel(-33, 16)).toBeGreaterThan(1.9);
    expect(metersPerPixel(-33, 16)).toBeLessThan(2.1);
  });
  it("nearestVertex picks the closest candidate inside the radius", () => {
    const candidates: [number, number][] = [[-56.5, -33.0], [-56.5001, -33.0]];
    expect(nearestVertex([-56.50009, -33.0], candidates, 20)).toEqual([-56.5001, -33.0]);
    expect(nearestVertex([-56.6, -33.0], candidates, 20)).toBeNull();
  });
  it("polygonVertices reads outer rings of Polygon and MultiPolygon only", () => {
    const vertices = polygonVertices([
      { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]], [[0.2, 0.2], [0.3, 0.2], [0.3, 0.3]]] },
      { type: "MultiPolygon", coordinates: [[[[5, 5], [6, 5], [6, 6], [5, 5]]]] },
      { type: "LineString", coordinates: [[9, 9], [8, 8]] },
      null,
    ]);
    expect(vertices).toHaveLength(8);
    expect(vertices).toContainEqual([6, 6]);
    expect(vertices).not.toContainEqual([0.3, 0.3]);
  });
});
