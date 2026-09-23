// Minimal GeoJSON geometry helpers for placing potreros inside padrones.
// Coordinates are [lng, lat]; planar ray casting is exact enough at the
// scale of a farm.

type Ring = number[][];

function pointInRing([x, y]: [number, number], ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point: [number, number], rings: Ring[]): boolean {
  if (!rings[0] || !pointInRing(point, rings[0])) return false;
  // Holes (inner rings) exclude the point.
  return !rings.slice(1).some((hole) => pointInRing(point, hole));
}

export function pointInGeometry(point: [number, number], geometry: unknown): boolean {
  if (!geometry || typeof geometry !== "object") return false;
  const { type, coordinates } = geometry as { type?: string; coordinates?: unknown };
  if (!Array.isArray(coordinates)) return false;
  if (type === "Polygon") return pointInPolygon(point, coordinates as Ring[]);
  if (type === "MultiPolygon") return (coordinates as Ring[][]).some((polygon) => pointInPolygon(point, polygon));
  return false;
}

/** The padrón a drawn potrero belongs to: the one containing most of its
 * vertices, or the only padrón when the farm has just one. */
export function padronForShape<T extends { id: string; geometry: unknown }>(vertices: [number, number][], padrones: T[]): T | null {
  if (padrones.length === 0 || vertices.length === 0) return null;
  let best: T | null = null;
  let bestHits = 0;
  for (const padron of padrones) {
    const hits = vertices.filter((vertex) => pointInGeometry(vertex, padron.geometry)).length;
    if (hits > bestHits) {
      best = padron;
      bestHits = hits;
    }
  }
  return best ?? (padrones.length === 1 ? padrones[0] : null);
}
