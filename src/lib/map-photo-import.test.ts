import { describe, expect, it } from "vitest";
import {
  boundsFromCorners, draftLineString, draftPoint, draftPotreroPolygon, isValidOverlayBounds, matchSectionByName,
  mergeKnownSections, moveBoundsTo, normalizedToLngLat, parseMapExtraction, scaleBounds, sectionsContainingPoint, MAX_DRAFT_POTREROS,
} from "./map-photo-import";
import { isValidSectionMapCenter } from "./section-input";

const square = [[0.1, 0.1], [0.5, 0.1], [0.5, 0.4], [0.1, 0.4]];
const BOUNDS = { north: -33, south: -33.1, east: -56, west: -56.2 };

describe("parseMapExtraction", () => {
  it("keeps well-formed potreros, aguadas and lines", () => {
    const result = parseMapExtraction({
      potreros: [{ nombre: "Norte", hectareas: 45, poligono: square }],
      aguadas: [{ nombre: "Tajamar", tipo: "tajamar", punto: [0.3, 0.2] }],
      lineas: [{ tipo: "alambrado", nombre: null, puntos: [[0, 0.5], [1, 0.5]] }, { tipo: "camino", puntos: [[0.2, 0], [0.2, 1]] }],
      notas: "Falta la leyenda",
    });
    expect(result).toEqual({
      potreros: [{ key: "p1", name: "Norte", hectares: 45, ring: square }],
      aguadas: [{ key: "a1", name: "Tajamar", kind: "tajamar", point: [0.3, 0.2] }],
      lines: [
        { key: "l1", type: "alambrado", name: null, points: [[0, 0.5], [1, 0.5]] },
        { key: "l2", type: "road", name: null, points: [[0.2, 0], [0.2, 1]] },
      ],
      notes: "Falta la leyenda",
    });
  });

  it("reads its own output back unchanged (the client re-validates the server's answer)", () => {
    const once = parseMapExtraction({
      potreros: [{ nombre: "Norte", hectareas: 45, poligono: square }],
      aguadas: [{ nombre: "Pozo", tipo: "pozo", punto: [0.3, 0.2] }],
      lineas: [{ tipo: "camino", nombre: "Ruta", puntos: [[0, 0.5], [1, 0.5]] }],
      notas: "ok",
    });
    expect(parseMapExtraction(once)).toEqual(once);
  });

  it("returns null for non-objects and empty lists for missing keys", () => {
    expect(parseMapExtraction(null)).toBeNull();
    expect(parseMapExtraction([])).toBeNull();
    expect(parseMapExtraction({})).toEqual({ potreros: [], aguadas: [], lines: [], notes: null });
  });

  it("drops degenerate shapes and out-of-image points, closes and dedupes rings", () => {
    const result = parseMapExtraction({
      potreros: [
        { nombre: "Línea", poligono: [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]] },
        { nombre: "Dos", poligono: [[0.1, 0.1], [0.2, 0.2]] },
        { nombre: "Cerrado", poligono: [...square, [0.1, 0.1]] },
        { nombre: "Repetido", poligono: [[0.1, 0.1], [0.1, 0.1], [0.5, 0.1], [0.5, 0.4]] },
        "basura",
      ],
      aguadas: [{ nombre: "Lejos", punto: [3, 3] }, { nombre: "Sin punto" }, { nombre: "Cerca", punto: [0.5, 0.5] }],
      lineas: [{ tipo: "río", puntos: [[0, 0], [1, 1]] }, { tipo: "alambrado", puntos: [[0.1, 0.1]] }],
    }, { width: 2, height: 2 });
    expect(result?.potreros.map((p) => [p.name, p.ring.length])).toEqual([["Cerrado", 4], ["Repetido", 3]]);
    // One stray coordinate is dropped, not taken as a reason to rescale everything.
    expect(result?.aguadas.map((a) => a.name)).toEqual(["Cerca"]);
    expect(result?.lines).toEqual([]);
  });

  it("rescales percent and pixel answers", () => {
    const percent = parseMapExtraction({ aguadas: [{ nombre: "A", punto: [50, 25] }] });
    expect(percent?.aguadas[0].point).toEqual([0.5, 0.25]);
    const pixels = parseMapExtraction({ aguadas: [{ nombre: "A", punto: [800, 300] }] }, { width: 1600, height: 1200 });
    expect(pixels?.aguadas[0].point).toEqual([0.5, 0.25]);
  });

  it("cleans names, maps kind aliases and sanity-checks hectares", () => {
    const result = parseMapExtraction({
      potreros: [{ name: "  <b>Bajo</b>\n del arroyo ", hectares: -4, polygon: square }, { poligono: square, hectareas: "12,5" }],
      aguadas: [{ nombre: "Cañadita", tipo: "Cañada", punto: [0.5, 0.5] }, { tipo: "pileta", punto: [0.6, 0.6] }],
    });
    expect(result?.potreros[0]).toMatchObject({ name: "b Bajo /b del arroyo", hectares: null });
    expect(result?.potreros[1]).toMatchObject({ name: "Potrero 2", hectares: null });
    expect(result?.aguadas.map((a) => [a.name, a.kind])).toEqual([["Cañadita", "canada"], ["Aguada 2", "tajamar"]]);
  });

  it("caps how many drafts it returns", () => {
    const many = Array.from({ length: 500 }, () => ({ poligono: square }));
    expect(parseMapExtraction({ potreros: many })?.potreros).toHaveLength(MAX_DRAFT_POTREROS);
  });
});

describe("overlay bounds", () => {
  it("validates and builds from corners in any order", () => {
    expect(isValidOverlayBounds(BOUNDS)).toBe(true);
    expect(isValidOverlayBounds({ ...BOUNDS, north: -34 })).toBe(false);
    expect(isValidOverlayBounds({ ...BOUNDS, east: Number.NaN })).toBe(false);
    expect(boundsFromCorners([-56, -33.1], [-56.2, -33])).toEqual(BOUNDS);
  });
  it("moves and scales around the center", () => {
    const moved = moveBoundsTo(BOUNDS, [-55, -32]);
    expect(moved.north - moved.south).toBeCloseTo(0.1, 9);
    expect((moved.east + moved.west) / 2).toBeCloseTo(-55, 9);
    const bigger = scaleBounds(BOUNDS, 2);
    expect(bigger.east - bigger.west).toBeCloseTo(0.4, 9);
    expect((bigger.north + bigger.south) / 2).toBeCloseTo(-33.05, 9);
    expect(scaleBounds(BOUNDS, 0)).toBe(BOUNDS);
  });
});

describe("normalized → lng/lat", () => {
  it("maps the top-left corner to north-west and y grows southwards", () => {
    expect(normalizedToLngLat([0, 0], BOUNDS)).toEqual([-56.2, -33]);
    expect(normalizedToLngLat([1, 1], BOUNDS)).toEqual([-56, -33.1]);
    expect(normalizedToLngLat([0.5, 0.25], BOUNDS)).toEqual([-56.1, -33.025]);
  });
  it("builds geometries the existing APIs accept", () => {
    const polygon = draftPotreroPolygon(square as [number, number][], BOUNDS);
    expect(polygon.coordinates[0]).toHaveLength(5);
    expect(polygon.coordinates[0][0]).toEqual(polygon.coordinates[0][4]);
    expect(isValidSectionMapCenter(polygon)).toBe(true);
    expect(draftLineString([[0, 0], [1, 1]], BOUNDS).coordinates).toEqual([[-56.2, -33], [-56, -33.1]]);
    expect(draftPoint([1, 0], BOUNDS)).toEqual({ type: "Point", coordinates: [-56, -33] });
  });
});

describe("matchSectionByName", () => {
  const sections = [{ id: "1", name: "Potrero Norte" }, { id: "2", name: "Bajo del Arroyo" }];
  it("ignores accents, case and a leading 'Potrero'", () => {
    expect(matchSectionByName("norte", sections)?.id).toBe("1");
    expect(matchSectionByName("BAJO DEL ARROYÓ", sections)?.id).toBe("2");
    expect(matchSectionByName("Sur", sections)).toBeNull();
    expect(matchSectionByName("  ", sections)).toBeNull();
  });
});

describe("known sections during a review", () => {
  const norte = { type: "Polygon", coordinates: [[[-56.03, -33.01], [-56.0, -33.01], [-56.0, -33.0], [-56.03, -33.0], [-56.03, -33.01]]] };
  const nuevo = { type: "Polygon", coordinates: [[[-56.03, -33.02], [-56.0, -33.02], [-56.0, -33.01], [-56.03, -33.01], [-56.03, -33.02]]] };

  it("adds potreros created in this review before the reload shows them", () => {
    const known = mergeKnownSections([{ id: "1", name: "Norte", polygon: norte }], [{ id: "2", name: "Bajo", polygon: nuevo }]);
    expect(sectionsContainingPoint([-56.01, -33.015], known)).toEqual(["2"]);
    expect(matchSectionByName("bajo", known)?.id).toBe("2");
  });
  it("lets a placement update a loaded potrero, and keeps a known shape when a later row has none", () => {
    const placed = mergeKnownSections([{ id: "1", name: "Norte", polygon: null }], [{ id: "1", name: "Norte", polygon: nuevo }]);
    expect(placed).toEqual([{ id: "1", name: "Norte", polygon: nuevo }]);
    const kept = mergeKnownSections([{ id: "1", name: "Norte", polygon: norte }, { id: "1", name: "Norte", polygon: null }], []);
    expect(kept[0].polygon).toBe(norte);
    expect(sectionsContainingPoint([-56.01, -33.005], kept)).toEqual(["1"]);
  });
});
