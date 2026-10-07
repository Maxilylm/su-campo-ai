// Distances on the ground for map features. Coordinates are GeoJSON order,
// [lng, lat]. Haversine on a spherical Earth is within ~0.5 % of the
// ellipsoid, far better than a fence drawn by tapping on satellite tiles.

export type LngLat = [number, number];

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function isLngLat(value: unknown): value is LngLat {
  return Array.isArray(value) && value.length >= 2
    && typeof value[0] === "number" && typeof value[1] === "number"
    && Number.isFinite(value[0]) && Number.isFinite(value[1])
    && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}

/** Great-circle distance in meters between two [lng, lat] points. */
export function haversineMeters(a: LngLat, b: LngLat): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Length of a polyline in meters; invalid vertices are skipped. */
export function pathLengthMeters(points: unknown): number {
  if (!Array.isArray(points)) return 0;
  const valid = points.filter(isLngLat);
  let total = 0;
  for (let i = 1; i < valid.length; i++) total += haversineMeters(valid[i - 1], valid[i]);
  return total;
}

/** Length of a LineString / MultiLineString geometry in meters (0 otherwise). */
export function geometryLengthMeters(geometry: unknown): number {
  if (!geometry || typeof geometry !== "object") return 0;
  const { type, coordinates } = geometry as { type?: unknown; coordinates?: unknown };
  if (type === "LineString") return pathLengthMeters(coordinates);
  if (type === "MultiLineString" && Array.isArray(coordinates)) {
    return coordinates.reduce((sum: number, line) => sum + pathLengthMeters(line), 0);
  }
  return 0;
}

/** "350 m", "1,2 km", "12 km" — how a fence length reads in the field. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters <= 0) return "0 m";
  if (meters < 1000) return `${Math.round(meters).toLocaleString("es-UY")} m`;
  const km = meters / 1000;
  const digits = km < 10 ? 1 : 0;
  return `${km.toLocaleString("es-UY", { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
}

/** Ground meters covered by one screen pixel at a Web Mercator zoom level. */
export function metersPerPixel(lat: number, zoom: number): number {
  return (156_543.033_92 * Math.cos(toRad(lat))) / 2 ** zoom;
}

/**
 * The nearest candidate vertex within `maxMeters` of `point`, or null. Used
 * to snap a fence's vertices onto potrero and padrón corners so the fence
 * and the boundary it follows line up.
 */
export function nearestVertex(point: LngLat, candidates: LngLat[], maxMeters: number): LngLat | null {
  let best: LngLat | null = null;
  let bestDistance = maxMeters;
  for (const candidate of candidates) {
    const distance = haversineMeters(point, candidate);
    if (distance <= bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** Every outer-ring vertex of the Polygon / MultiPolygon geometries given. */
export function polygonVertices(geometries: unknown[]): LngLat[] {
  const out: LngLat[] = [];
  const pushRing = (ring: unknown) => {
    if (!Array.isArray(ring)) return;
    for (const vertex of ring) if (isLngLat(vertex)) out.push([vertex[0], vertex[1]]);
  };
  for (const geometry of geometries) {
    if (!geometry || typeof geometry !== "object") continue;
    const { type, coordinates } = geometry as { type?: unknown; coordinates?: unknown };
    if (!Array.isArray(coordinates)) continue;
    if (type === "Polygon") pushRing(coordinates[0]);
    else if (type === "MultiPolygon") for (const polygon of coordinates) if (Array.isArray(polygon)) pushRing(polygon[0]);
  }
  return out;
}
