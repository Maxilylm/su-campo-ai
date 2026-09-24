import { describe, expect, it } from "vitest";
import { padronForShape, padronOutlinePolygon, pointInGeometry } from "./geo";
import { isValidSectionMapCenter } from "./section-input";

const square = (x: number, y: number, size: number) => ({ type: "Polygon", coordinates: [[[x, y], [x + size, y], [x + size, y + size], [x, y + size], [x, y]]] });

describe("pointInGeometry", () => {
  it("handles polygons, holes and multipolygons", () => {
    expect(pointInGeometry([0.5, 0.5], square(0, 0, 1))).toBe(true);
    expect(pointInGeometry([1.5, 0.5], square(0, 0, 1))).toBe(false);
    const withHole = { type: "Polygon", coordinates: [square(0, 0, 4).coordinates[0], square(1, 1, 1).coordinates[0]] };
    expect(pointInGeometry([1.5, 1.5], withHole)).toBe(false);
    expect(pointInGeometry([3, 3], withHole)).toBe(true);
    const multi = { type: "MultiPolygon", coordinates: [square(0, 0, 1).coordinates, square(5, 5, 1).coordinates] };
    expect(pointInGeometry([5.5, 5.5], multi)).toBe(true);
    expect(pointInGeometry([0, 0], { type: "Point", coordinates: [0, 0] })).toBe(false);
  });
});

describe("padronForShape", () => {
  const a = { id: "a", geometry: square(0, 0, 10) };
  const b = { id: "b", geometry: square(20, 0, 10) };

  it("picks the padrón holding most vertices", () => {
    expect(padronForShape([[21, 1], [22, 1], [22, 2], [1, 1]], [a, b])?.id).toBe("b");
  });

  it("falls back to the only padrón, and to nothing when ambiguous", () => {
    expect(padronForShape([[50, 50]], [a])?.id).toBe("a");
    expect(padronForShape([[50, 50]], [a, b])).toBeNull();
  });
});

describe("padronOutlinePolygon", () => {
  it("uses a polygon's outer ring, closed, and drops holes", () => {
    const withHole = { type: "Polygon", coordinates: [square(-57, -32, 0.01).coordinates[0], square(-56.996, -31.996, 0.001).coordinates[0]] };
    const outline = padronOutlinePolygon(withHole)!;
    expect(outline.type).toBe("Polygon");
    expect(outline.coordinates).toHaveLength(1);
    expect(outline.coordinates[0]).toEqual(square(-57, -32, 0.01).coordinates[0]);
    expect(isValidSectionMapCenter(outline)).toBe(true);
  });

  it("takes the largest part of a MultiPolygon", () => {
    const multi = { type: "MultiPolygon", coordinates: [square(-57, -32, 0.001).coordinates, square(-56.9, -32, 0.02).coordinates] };
    expect(padronOutlinePolygon(multi)!.coordinates[0][0]).toEqual([-56.9, -32]);
  });

  it("thins very detailed outlines to what a potrero can store", () => {
    const ring = Array.from({ length: 1500 }, (_, i) => [-57 + 0.01 * Math.cos((2 * Math.PI * i) / 1500), -32 + 0.01 * Math.sin((2 * Math.PI * i) / 1500)]);
    const outline = padronOutlinePolygon({ type: "Polygon", coordinates: [[...ring, ring[0]]] })!;
    expect(outline.coordinates[0].length).toBeLessThanOrEqual(500);
    expect(outline.coordinates[0].length).toBeGreaterThan(400);
    expect(outline.coordinates[0][0]).toEqual(outline.coordinates[0][outline.coordinates[0].length - 1]);
    expect(isValidSectionMapCenter(outline)).toBe(true);
  });

  it("returns null for anything without an area", () => {
    expect(padronOutlinePolygon(null)).toBeNull();
    expect(padronOutlinePolygon({ type: "Point", coordinates: [0, 0] })).toBeNull();
    expect(padronOutlinePolygon({ type: "Polygon", coordinates: [[[0, 0], [1, 1]]] })).toBeNull();
  });
});
