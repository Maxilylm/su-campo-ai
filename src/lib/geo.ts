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

function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(sum / 2);
}

const isCoordinate = (value: unknown): value is [number, number] =>
  Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number"
  && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;

/** A padrón's shape as a potrero's area: the outer ring of its largest part,
 * closed, and thinned evenly to at most `maxVertices` points (what
 * `sections.map_center` accepts). Holes are dropped: a potrero is one ring.
 * Null when the geometry has no usable area. */
export function padronOutlinePolygon(geometry: unknown, maxVertices = 500): { type: "Polygon"; coordinates: [number, number][][] } | null {
  if (!geometry || typeof geometry !== "object") return null;
  const { type, coordinates } = geometry as { type?: string; coordinates?: unknown };
  if (!Array.isArray(coordinates)) return null;
  const polygons = type === "Polygon" ? [coordinates] : type === "MultiPolygon" ? coordinates : [];
  let best: [number, number][] | null = null;
  let bestArea = 0;
  for (const polygon of polygons) {
    if (!Array.isArray(polygon) || !Array.isArray(polygon[0])) continue;
    const ring = (polygon[0] as unknown[]).filter(isCoordinate).map(([lng, lat]) => [lng, lat] as [number, number]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (ring.length > 1 && first[0] === last[0] && first[1] === last[1]) ring.pop();
    if (ring.length < 3) continue;
    const area = ringArea(ring);
    if (area > bestArea) {
      best = ring;
      bestArea = area;
    }
  }
  if (!best) return null;
  const open = maxVertices - 1;
  const thinned = best.length <= open
    ? best
    : Array.from({ length: open }, (_, index) => best[Math.floor((index * best.length) / open)]);
  return { type: "Polygon", coordinates: [[...thinned, thinned[0]]] };
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
