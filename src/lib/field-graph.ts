// Which potreros share a fence ("linderos"), and how to walk animals from one
// potrero to another through neighbouring ones. Pure and dependency-free: the
// map, the rotation planner, the move dialog and the assistant all read the
// same graph, computed on the fly from the geometry stored in
// `sections.map_center`.
//
// Geometry is projected to meters with an equirectangular projection around
// the farm's own latitude. At farm scale (a few km) the error is far below
// the tolerance of a hand-drawn fence.

type LngLat = [number, number];
type XY = [number, number];
type Ring = XY[];
/** One polygon: outer ring first, then holes. */
type Poly = Ring[];

export interface FieldGraphInput {
  id: string;
  name: string;
  /** `sections.map_center`: a GeoJSON Polygon/MultiPolygon, a `{lat, lng}` label point, or null. */
  geometry: unknown;
}

export interface FieldGraphNode {
  id: string;
  name: string;
  /** [lng, lat] of the shape's centroid, or of the label point; null when unplaced. */
  centroid: LngLat | null;
  /** Square meters; null without a polygon. */
  areaM2: number | null;
  /** Only potreros drawn as an area can have linderos. */
  hasPolygon: boolean;
}

export interface FieldGraphEdge {
  a: string;
  b: string;
  /** Length of the shared fence, in meters. */
  sharedM: number;
  /** Straight line between the two centroids, in meters. */
  distanceM: number;
  /** A portera sits on the shared fence. */
  gate: boolean;
}

export interface FieldGraph {
  nodes: FieldGraphNode[];
  edges: FieldGraphEdge[];
  /** Groups of potreros reachable from each other, in input order. */
  components: string[][];
}

export interface FieldGraphOptions {
  /** Portera positions, [lng, lat]. */
  gates?: LngLat[];
  /** How far apart two drawn fences can be and still be the same fence. */
  toleranceM?: number;
  /** Shared fence needed to call two potreros neighbours; less is a corner. */
  minSharedM?: number;
  /** How far from both fences a portera can be placed and still count. */
  gateToleranceM?: number;
}

export const DEFAULT_TOLERANCE_M = 5;
export const DEFAULT_MIN_SHARED_M = 20;
export const DEFAULT_GATE_TOLERANCE_M = 15;
/** Crossing a fence without a known portera costs this much more than its
 * distance, so routes prefer porteras when there is a comparable choice. */
export const NO_GATE_COST_FACTOR = 1.3;

const EARTH_RADIUS_M = 6_371_008.8;
const DEG = Math.PI / 180;
const MAX_SAMPLES_PER_SEGMENT = 2_000;
/** Two fence stretches are the same fence only when roughly parallel (≤ ~30°). */
const MIN_PARALLEL_COS = Math.cos(30 * DEG);

// ── Geometry parsing ──

function isLngLat(value: unknown): value is LngLat {
  return Array.isArray(value) && value.length >= 2
    && typeof value[0] === "number" && typeof value[1] === "number"
    && Number.isFinite(value[0]) && Number.isFinite(value[1])
    && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}

function parseRing(value: unknown): LngLat[] | null {
  if (!Array.isArray(value)) return null;
  const ring = value.filter(isLngLat).map(([lng, lat]) => [lng, lat] as LngLat);
  if (ring.length > 1) {
    const [first, last] = [ring[0], ring[ring.length - 1]];
    if (first[0] === last[0] && first[1] === last[1]) ring.pop();
  }
  return ring.length >= 3 ? ring : null;
}

function parsePolygon(value: unknown): LngLat[][] | null {
  if (!Array.isArray(value)) return null;
  const outer = parseRing(value[0]);
  if (!outer) return null;
  const holes = value.slice(1).map(parseRing).filter((ring): ring is LngLat[] => ring !== null);
  return [outer, ...holes];
}

interface ParsedShape {
  polygons: LngLat[][][];
  point: LngLat | null;
}

function parseShape(geometry: unknown): ParsedShape {
  const empty: ParsedShape = { polygons: [], point: null };
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) return empty;
  const record = geometry as Record<string, unknown>;
  if (record.type === "Polygon") {
    const polygon = parsePolygon(record.coordinates);
    return { polygons: polygon ? [polygon] : [], point: null };
  }
  if (record.type === "MultiPolygon") {
    if (!Array.isArray(record.coordinates)) return empty;
    return { polygons: record.coordinates.map(parsePolygon).filter((polygon): polygon is LngLat[][] => polygon !== null), point: null };
  }
  if (record.type === "Point") return { polygons: [], point: isLngLat(record.coordinates) ? [record.coordinates[0], record.coordinates[1]] : null };
  if (!("type" in record) && isLngLat([record.lng, record.lat])) return { polygons: [], point: [record.lng as number, record.lat as number] };
  return empty;
}

// ── Planar helpers (meters) ──

interface Projection {
  toXY: (point: LngLat) => XY;
  toLngLat: (point: XY) => LngLat;
}

function projection(points: LngLat[]): Projection {
  const lng0 = points.length ? points.reduce((sum, point) => sum + point[0], 0) / points.length : 0;
  const lat0 = points.length ? points.reduce((sum, point) => sum + point[1], 0) / points.length : 0;
  const kx = EARTH_RADIUS_M * DEG * Math.cos(lat0 * DEG);
  const ky = EARTH_RADIUS_M * DEG;
  return {
    toXY: ([lng, lat]) => [(lng - lng0) * kx, (lat - lat0) * ky],
    toLngLat: ([x, y]) => [lng0 + x / kx, lat0 + y / ky],
  };
}

function signedArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return sum / 2;
}

function ringCentroid(ring: Ring): { area: number; x: number; y: number } {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const cross = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
    area += cross;
    cx += (ring[j][0] + ring[i][0]) * cross;
    cy += (ring[j][1] + ring[i][1]) * cross;
  }
  area /= 2;
  if (Math.abs(area) < 1e-9) return { area: 0, x: 0, y: 0 };
  return { area: Math.abs(area), x: cx / (6 * area), y: cy / (6 * area) };
}

function pointInRing([x, y]: XY, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolys(point: XY, polys: Poly[]): boolean {
  return polys.some((poly) => pointInRing(point, poly[0]) && !poly.slice(1).some((hole) => pointInRing(point, hole)));
}

/** Distance from a point to the segment, or Infinity when the point does not
 * project onto it: past the end of a fence is a corner, not the fence. */
function distanceAlongSegment([px, py]: XY, [ax, ay]: XY, [bx, by]: XY): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Infinity;
  const t = ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  if (t < 0 || t > 1) return Infinity;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function distanceToSegment([px, py]: XY, [ax, ay]: XY, [bx, by]: XY): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

interface Box { minX: number; minY: number; maxX: number; maxY: number }

function boxOf(points: XY[]): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const [x, y] of points) {
    if (x < box.minX) box.minX = x;
    if (y < box.minY) box.minY = y;
    if (x > box.maxX) box.maxX = x;
    if (y > box.maxY) box.maxY = y;
  }
  return box;
}

function boxesMeet(a: Box, b: Box, margin: number): boolean {
  return a.minX - margin <= b.maxX && b.minX - margin <= a.maxX && a.minY - margin <= b.maxY && b.minY - margin <= a.maxY;
}

interface Segment { a: XY; b: XY; box: Box }

interface Shape {
  polys: Poly[];
  segments: Segment[];
  box: Box;
}

function shapeOf(polys: Poly[]): Shape {
  const segments: Segment[] = [];
  for (const poly of polys) {
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i];
        const b = ring[(i + 1) % ring.length];
        segments.push({ a, b, box: boxOf([a, b]) });
      }
    }
  }
  return { polys, segments, box: boxOf(segments.flatMap((segment) => [segment.a, segment.b])) };
}

/** Meters of `from`'s boundary that lie on (within `tolerance` of) or inside
 * `to`. A hand-drawn fence is never exactly on its neighbour's line, and a
 * sliver of overlap is the same fence drawn twice. */
function boundaryAlong(from: Shape, to: Shape, tolerance: number): number {
  let shared = 0;
  for (const segment of from.segments) {
    if (!boxesMeet(segment.box, to.box, tolerance)) continue;
    const length = Math.hypot(segment.b[0] - segment.a[0], segment.b[1] - segment.a[1]);
    if (length === 0) continue;
    const candidates = to.segments.filter((other) => {
      if (!boxesMeet(segment.box, other.box, tolerance)) return false;
      const otherLength = Math.hypot(other.b[0] - other.a[0], other.b[1] - other.a[1]);
      if (otherLength === 0) return false;
      const dot = ((segment.b[0] - segment.a[0]) * (other.b[0] - other.a[0]) + (segment.b[1] - segment.a[1]) * (other.b[1] - other.a[1])) / (length * otherLength);
      return Math.abs(dot) >= MIN_PARALLEL_COS;
    });
    const pieces = Math.min(MAX_SAMPLES_PER_SEGMENT, Math.max(1, Math.ceil(length / tolerance)));
    const pieceLength = length / pieces;
    for (let k = 0; k < pieces; k++) {
      const t = (k + 0.5) / pieces;
      const sample: XY = [segment.a[0] + (segment.b[0] - segment.a[0]) * t, segment.a[1] + (segment.b[1] - segment.a[1]) * t];
      const onFence = candidates.some((other) => distanceAlongSegment(sample, other.a, other.b) <= tolerance);
      if (onFence || pointInPolys(sample, to.polys)) shared += pieceLength;
    }
  }
  return shared;
}

function nearBoundary(point: XY, shape: Shape, tolerance: number): boolean {
  return shape.segments.some((segment) => distanceToSegment(point, segment.a, segment.b) <= tolerance);
}

// ── Graph ──

export function buildFieldGraph(sections: FieldGraphInput[], options: FieldGraphOptions = {}): FieldGraph {
  const tolerance = options.toleranceM ?? DEFAULT_TOLERANCE_M;
  const minShared = options.minSharedM ?? DEFAULT_MIN_SHARED_M;
  const gateTolerance = options.gateToleranceM ?? DEFAULT_GATE_TOLERANCE_M;

  const parsed = sections.map((section) => parseShape(section.geometry));
  const allPoints = parsed.flatMap((shape) => shape.polygons.length > 0 ? shape.polygons.flatMap((polygon) => polygon[0]) : shape.point ? [shape.point] : []);
  const proj = projection(allPoints);

  const shapes: (Shape | null)[] = [];
  const centroids: (XY | null)[] = [];
  const nodes: FieldGraphNode[] = sections.map((section, index) => {
    const { polygons, point } = parsed[index];
    if (polygons.length === 0) {
      shapes.push(null);
      centroids.push(point ? proj.toXY(point) : null);
      return { id: section.id, name: section.name, centroid: point, areaM2: null, hasPolygon: false };
    }
    const polys: Poly[] = polygons.map((polygon) => polygon.map((ring) => ring.map(proj.toXY)));
    let area = 0;
    let sx = 0;
    let sy = 0;
    for (const poly of polys) {
      poly.forEach((ring, ringIndex) => {
        const c = ringCentroid(ring);
        const sign = ringIndex === 0 ? 1 : -1;
        area += sign * c.area;
        sx += sign * c.area * c.x;
        sy += sign * c.area * c.y;
      });
    }
    let centroid: XY;
    if (area > 1e-6) {
      centroid = [sx / area, sy / area];
    } else {
      const vertices = polys.flatMap((poly) => poly[0]);
      centroid = [vertices.reduce((sum, v) => sum + v[0], 0) / vertices.length, vertices.reduce((sum, v) => sum + v[1], 0) / vertices.length];
    }
    shapes.push(shapeOf(polys));
    centroids.push(centroid);
    return {
      id: section.id,
      name: section.name,
      centroid: proj.toLngLat(centroid),
      areaM2: Math.round(Math.max(0, polys.reduce((sum, poly) => sum + Math.abs(signedArea(poly[0])) - poly.slice(1).reduce((holes, hole) => holes + Math.abs(signedArea(hole)), 0), 0))),
      hasPolygon: true,
    };
  });

  const gates = (options.gates ?? []).filter(isLngLat).map(proj.toXY);
  const edges: FieldGraphEdge[] = [];
  for (let i = 0; i < nodes.length; i++) {
    const a = shapes[i];
    if (!a) continue;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = shapes[j];
      if (!b || !boxesMeet(a.box, b.box, tolerance)) continue;
      const shared = Math.max(boundaryAlong(a, b, tolerance), boundaryAlong(b, a, tolerance));
      if (shared < minShared) continue;
      const [ca, cb] = [centroids[i]!, centroids[j]!];
      edges.push({
        a: nodes[i].id,
        b: nodes[j].id,
        sharedM: Math.round(shared),
        distanceM: Math.round(Math.hypot(ca[0] - cb[0], ca[1] - cb[1])),
        gate: gates.some((gate) => nearBoundary(gate, a, gateTolerance) && nearBoundary(gate, b, gateTolerance)),
      });
    }
  }

  return { nodes, edges, components: componentsOf(nodes, edges) };
}

function adjacency(graph: Pick<FieldGraph, "edges">): Map<string, FieldGraphEdge[]> {
  const map = new Map<string, FieldGraphEdge[]>();
  for (const edge of graph.edges) {
    for (const id of [edge.a, edge.b]) {
      const list = map.get(id) ?? [];
      list.push(edge);
      map.set(id, list);
    }
  }
  return map;
}

function componentsOf(nodes: FieldGraphNode[], edges: FieldGraphEdge[]): string[][] {
  const links = adjacency({ edges });
  const seen = new Set<string>();
  const components: string[][] = [];
  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const component: string[] = [];
    const queue = [node.id];
    seen.add(node.id);
    while (queue.length > 0) {
      const id = queue.shift()!;
      component.push(id);
      for (const edge of links.get(id) ?? []) {
        const next = edge.a === id ? edge.b : edge.a;
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    components.push(component);
  }
  return components;
}

/** Portera points out of `map_features` rows; lines and other types are ignored. */
export function gatePointsFromFeatures(features: { type?: string | null; geometry?: unknown }[]): LngLat[] {
  const gates: LngLat[] = [];
  for (const feature of features) {
    if (feature.type !== "portera" || !feature.geometry || typeof feature.geometry !== "object") continue;
    const geometry = feature.geometry as { type?: unknown; coordinates?: unknown };
    if (geometry.type === "Point" && isLngLat(geometry.coordinates)) gates.push([geometry.coordinates[0], geometry.coordinates[1]]);
  }
  return gates;
}

/** The graph straight from `sections` rows and `map_features` rows. */
export function fieldGraphFromData(
  sections: { id: string; name: string; map_center?: unknown }[],
  features: { type?: string | null; geometry?: unknown }[] = [],
  options: Omit<FieldGraphOptions, "gates"> = {},
): FieldGraph {
  return buildFieldGraph(
    sections.map((section) => ({ id: section.id, name: section.name, geometry: section.map_center ?? null })),
    { ...options, gates: gatePointsFromFeatures(features) },
  );
}

export interface FieldNeighbour {
  id: string;
  name: string;
  sharedM: number;
  distanceM: number;
  gate: boolean;
}

/** Potreros sharing a fence with `id`, by name. */
export function neighboursOf(graph: FieldGraph, id: string): FieldNeighbour[] {
  const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
  return graph.edges
    .filter((edge) => edge.a === id || edge.b === id)
    .map((edge) => {
      const other = edge.a === id ? edge.b : edge.a;
      return { id: other, name: names.get(other) ?? other, sharedM: edge.sharedM, distanceM: edge.distanceM, gate: edge.gate };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export interface FieldRoute {
  /** Potrero ids from origin to destination, both included. */
  path: string[];
  names: string[];
  /** Names of the potreros crossed on the way (neither end). */
  via: string[];
  /** The two potreros share a fence. */
  direct: boolean;
  /** Sum of centroid-to-centroid legs, in meters. */
  distanceM: number;
  /** Fences on the route with a known portera. */
  gates: number;
}

/** Cheapest walk from one potrero to another through neighbouring ones
 * (Dijkstra on centroid distance, fences without a portera cost more), or
 * null when either end is unknown or no chain of linderos joins them. */
export function shortestRoute(graph: FieldGraph, from: string, to: string): FieldRoute | null {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!byId.has(from) || !byId.has(to)) return null;
  if (from === to) {
    const name = byId.get(from)!.name;
    return { path: [from], names: [name], via: [], direct: false, distanceM: 0, gates: 0 };
  }
  const links = adjacency(graph);
  const cost = new Map<string, number>([[from, 0]]);
  const previous = new Map<string, { id: string; edge: FieldGraphEdge }>();
  const done = new Set<string>();
  while (true) {
    let current: string | null = null;
    let best = Infinity;
    for (const [id, value] of cost) {
      if (!done.has(id) && value < best) {
        best = value;
        current = id;
      }
    }
    if (current === null) return null;
    if (current === to) break;
    done.add(current);
    for (const edge of links.get(current) ?? []) {
      const next = edge.a === current ? edge.b : edge.a;
      if (done.has(next)) continue;
      const step = Math.max(1, edge.distanceM) * (edge.gate ? 1 : NO_GATE_COST_FACTOR);
      const candidate = best + step;
      if (candidate < (cost.get(next) ?? Infinity)) {
        cost.set(next, candidate);
        previous.set(next, { id: current, edge });
      }
    }
  }

  const path = [to];
  let distanceM = 0;
  let gates = 0;
  for (let id = to; id !== from;) {
    const step = previous.get(id)!;
    distanceM += step.edge.distanceM;
    if (step.edge.gate) gates += 1;
    path.unshift(step.id);
    id = step.id;
  }
  const names = path.map((id) => byId.get(id)!.name);
  return { path, names, via: names.slice(1, -1), direct: path.length === 2, distanceM, gates };
}

/** "lindero directo" or "pasando por X, Y y Z" (empty for a potrero to itself). */
export function routeSummary(route: FieldRoute): string {
  if (route.direct) return "lindero directo";
  if (route.via.length === 0) return "";
  const shown = route.via.length > 4 ? [...route.via.slice(0, 3), `${route.via.length - 3} más`] : route.via;
  const list = shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(", ")} y ${shown[shown.length - 1]}`;
  return `pasando por ${list}`;
}
