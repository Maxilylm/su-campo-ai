import { describe, expect, it } from "vitest";
import { padronForShape, pointInGeometry } from "./geo";

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
