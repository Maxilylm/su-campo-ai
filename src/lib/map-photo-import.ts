// "Plano del campo" from a photo: what the vision model is asked for, how its
// answer is validated, and how the shapes it finds (in image coordinates,
// 0..1 from the top-left corner) land on the map once the photo is pinned
// over the satellite view. Nothing here writes: every shape becomes a draft
// the user confirms one by one.
import type { LngLat } from "./geo-measure";
import { isWaterPointKind, type WaterPointKind } from "./water-points";

export type NormPoint = [number, number];

export interface DraftPotrero {
  key: string;
  name: string;
  hectares: number | null;
  ring: NormPoint[];
}

export interface DraftAguada {
  key: string;
  name: string;
  kind: WaterPointKind;
  point: NormPoint;
}

export interface DraftLine {
  key: string;
  type: "alambrado" | "road";
  name: string | null;
  points: NormPoint[];
}

export interface MapExtraction {
  potreros: DraftPotrero[];
  aguadas: DraftAguada[];
  lines: DraftLine[];
  /** Short notes from the model (scale, legend, unreadable parts). */
  notes: string | null;
}

export interface OverlayBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export const MAX_DRAFT_POTREROS = 60;
export const MAX_DRAFT_AGUADAS = 60;
export const MAX_DRAFT_LINES = 100;
export const MAX_DRAFT_VERTICES = 200;

export const MAP_PHOTO_SYSTEM = [
  "Sos un asistente que lee planos de campos ganaderos y agrícolas de Uruguay (dibujados a mano, croquis, planos de agrimensor o fotos de un mapa impreso).",
  "Respondé SOLO un objeto JSON, sin texto alrededor.",
  "Las coordenadas son relativas a la imagen: x de 0 (borde izquierdo) a 1 (borde derecho), y de 0 (borde superior) a 1 (borde inferior).",
  "No inventes elementos que no se vean. Si algo no se lee, omitilo y explicalo en \"notas\".",
].join(" ");

export const MAP_PHOTO_PROMPT = `Extraé del plano:
- "potreros": cada potrero o división cerrada, con "nombre" (como está escrito; si no tiene, "Potrero 1", "Potrero 2"…), "hectareas" (número si está escrito, si no null) y "poligono" (lista de vértices [x, y] en orden, siguiendo el contorno; entre 3 y 40 vértices).
- "aguadas": tajamares, bebederos, pozos, molinos, tanques, con "nombre", "tipo" (uno de: tajamar, bebedero, pozo, molino, arroyo, canada, tanque) y "punto" [x, y].
- "lineas": alambrados y caminos que no sean simplemente el borde de un potrero ya listado, con "tipo" ("alambrado" o "camino"), "nombre" (o null) y "puntos" (lista de [x, y]).
- "notas": una frase sobre lo que no se pudo leer, o null.
Formato: {"potreros":[{"nombre":"Norte","hectareas":45,"poligono":[[0.1,0.1],[0.5,0.1],[0.5,0.4],[0.1,0.4]]}],"aguadas":[{"nombre":"Tajamar","tipo":"tajamar","punto":[0.3,0.2]}],"lineas":[{"tipo":"camino","nombre":null,"puntos":[[0,0.5],[1,0.5]]}],"notas":null}`;

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

function firstArray(record: Record<string, unknown>, keys: string[]): unknown[] {
  for (const key of keys) if (Array.isArray(record[key])) return record[key] as unknown[];
  return [];
}

function firstValue(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (record[key] !== undefined) return record[key];
  return undefined;
}

function cleanName(value: unknown, max = 80): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const text = String(value).replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, max) : null;
}

function rawPair(value: unknown): [number, number] | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  const record = asRecord(value);
  if (record) {
    const x = Number(record.x);
    const y = Number(record.y);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  return null;
}

/**
 * Models sometimes answer in percent (0–100) or pixels despite the prompt.
 * Pick one scale for the whole answer: only when most coordinates are above
 * 1 (a stray outlier is dropped later, not allowed to shrink everything),
 * then percent or pixels by the largest one.
 */
function coordinateScale(pairs: [number, number][], image?: { width: number; height: number }): ((p: [number, number]) => [number, number]) | null {
  const values = pairs.flatMap(([x, y]) => [Math.abs(x), Math.abs(y)]);
  const above = values.filter((value) => value > 1.05).length;
  if (values.length === 0 || above <= values.length / 2) return (p) => p;
  const maxValue = Math.max(...values);
  if (maxValue <= 105) return ([x, y]) => [x / 100, y / 100];
  if (image && image.width > 0 && image.height > 0 && maxValue <= Math.max(image.width, image.height) * 1.05) {
    return ([x, y]) => [x / image.width, y / image.height];
  }
  return null;
}

const round4 = (value: number) => Math.round(value * 10_000) / 10_000;

function normalizePoint(pair: [number, number], scale: (p: [number, number]) => [number, number]): NormPoint | null {
  const [x, y] = scale(pair);
  // A little slack for shapes drawn to the very edge of the photo.
  if (x < -0.02 || x > 1.02 || y < -0.02 || y > 1.02) return null;
  return [round4(Math.min(1, Math.max(0, x))), round4(Math.min(1, Math.max(0, y)))];
}

function dedupeConsecutive(points: NormPoint[]): NormPoint[] {
  const out: NormPoint[] = [];
  for (const point of points) {
    const last = out[out.length - 1];
    if (!last || last[0] !== point[0] || last[1] !== point[1]) out.push(point);
  }
  return out;
}

function thin(points: NormPoint[], max: number): NormPoint[] {
  if (points.length <= max) return points;
  return Array.from({ length: max }, (_, index) => points[Math.floor((index * points.length) / max)]);
}

/** Twice the signed area of a normalized ring; ~0 means a sliver or a line. */
function ringArea2(ring: NormPoint[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) sum += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(sum);
}

const KIND_ALIASES: Record<string, WaterPointKind> = {
  "cañada": "canada", canada: "canada", represa: "tajamar", laguna: "tajamar", tajamar: "tajamar",
  bebedero: "bebedero", pozo: "pozo", perforacion: "pozo", "perforación": "pozo", molino: "molino",
  arroyo: "arroyo", tanque: "tanque", "tanque australiano": "tanque",
};

function aguadaKind(value: unknown): WaterPointKind {
  if (isWaterPointKind(value)) return value;
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return KIND_ALIASES[text] ?? "tajamar";
}

function lineType(value: unknown): "alambrado" | "road" | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (/alambr|fence|cerco|boyero/.test(text)) return "alambrado";
  if (/camin|road|senda|calle/.test(text)) return "road";
  return null;
}

/**
 * Validate whatever the vision model returned. Unknown keys are ignored,
 * malformed items dropped, coordinates clamped to the photo, counts capped.
 * Returns null only when the answer isn't an object at all.
 */
export function parseMapExtraction(raw: unknown, image?: { width: number; height: number }): MapExtraction | null {
  const root = asRecord(raw);
  if (!root) return null;
  const rawPotreros = firstArray(root, ["potreros", "paddocks", "parcels"]).slice(0, MAX_DRAFT_POTREROS * 2);
  const rawAguadas = firstArray(root, ["aguadas", "water", "water_points"]).slice(0, MAX_DRAFT_AGUADAS * 2);
  const rawLines = firstArray(root, ["lineas", "líneas", "lines", "fences"]).slice(0, MAX_DRAFT_LINES * 2);

  const potreroPairs = rawPotreros.map((item) => {
    const record = asRecord(item);
    const vertices = record ? firstArray(record, ["poligono", "polígono", "polygon", "ring", "vertices", "puntos"]) : [];
    return { record, pairs: vertices.map(rawPair).filter((pair): pair is [number, number] => pair !== null) };
  });
  const aguadaPairs = rawAguadas.map((item) => {
    const record = asRecord(item);
    return { record, pair: record ? rawPair(firstValue(record, ["punto", "point", "posicion", "posición"])) : null };
  });
  const linePairs = rawLines.map((item) => {
    const record = asRecord(item);
    const points = record ? firstArray(record, ["puntos", "points", "linea", "línea"]) : [];
    return { record, pairs: points.map(rawPair).filter((pair): pair is [number, number] => pair !== null) };
  });

  const all = [
    ...potreroPairs.flatMap((item) => item.pairs),
    ...aguadaPairs.flatMap((item) => (item.pair ? [item.pair] : [])),
    ...linePairs.flatMap((item) => item.pairs),
  ];
  const scale = coordinateScale(all, image) ?? ((p: [number, number]) => p);

  const potreros: DraftPotrero[] = [];
  for (const { record, pairs } of potreroPairs) {
    if (!record || potreros.length >= MAX_DRAFT_POTREROS) continue;
    let ring = dedupeConsecutive(pairs.map((pair) => normalizePoint(pair, scale)).filter((point): point is NormPoint => point !== null));
    if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring = ring.slice(0, -1);
    ring = thin(ring, MAX_DRAFT_VERTICES);
    if (ring.length < 3 || ringArea2(ring) < 1e-5) continue;
    const hectaresRaw = Number(firstValue(record, ["hectareas", "hectáreas", "hectares", "ha"]));
    potreros.push({
      key: `p${potreros.length + 1}`,
      name: cleanName(firstValue(record, ["nombre", "name"])) ?? `Potrero ${potreros.length + 1}`,
      hectares: Number.isFinite(hectaresRaw) && hectaresRaw > 0 && hectaresRaw < 100_000 ? Math.round(hectaresRaw * 100) / 100 : null,
      ring,
    });
  }

  const aguadas: DraftAguada[] = [];
  for (const { record, pair } of aguadaPairs) {
    if (!record || !pair || aguadas.length >= MAX_DRAFT_AGUADAS) continue;
    const point = normalizePoint(pair, scale);
    if (!point) continue;
    const kind = aguadaKind(firstValue(record, ["tipo", "kind", "type"]));
    aguadas.push({
      key: `a${aguadas.length + 1}`,
      name: cleanName(firstValue(record, ["nombre", "name"])) ?? `Aguada ${aguadas.length + 1}`,
      kind,
      point,
    });
  }

  const lines: DraftLine[] = [];
  for (const { record, pairs } of linePairs) {
    if (!record || lines.length >= MAX_DRAFT_LINES) continue;
    const type = lineType(firstValue(record, ["tipo", "type", "kind"]));
    if (!type) continue;
    const points = thin(dedupeConsecutive(pairs.map((pair) => normalizePoint(pair, scale)).filter((point): point is NormPoint => point !== null)), MAX_DRAFT_VERTICES);
    if (points.length < 2) continue;
    lines.push({ key: `l${lines.length + 1}`, type, name: cleanName(firstValue(record, ["nombre", "name"])), points });
  }

  const notes = cleanName(firstValue(root, ["notas", "notes"]), 300);
  return { potreros, aguadas, lines, notes };
}

/** True when the bounds describe a real, non-inverted area on Earth. */
export function isValidOverlayBounds(bounds: OverlayBounds): boolean {
  const values = [bounds.north, bounds.south, bounds.east, bounds.west];
  return values.every(Number.isFinite)
    && bounds.north <= 90 && bounds.south >= -90 && bounds.east <= 180 && bounds.west >= -180
    && bounds.north > bounds.south && bounds.east > bounds.west;
}

/** Bounds from two opposite corners in any order ([lng, lat] each). */
export function boundsFromCorners(a: LngLat, b: LngLat): OverlayBounds {
  return {
    north: Math.max(a[1], b[1]),
    south: Math.min(a[1], b[1]),
    east: Math.max(a[0], b[0]),
    west: Math.min(a[0], b[0]),
  };
}

/** Shift the whole photo so its center lands on `center` ([lng, lat]). */
export function moveBoundsTo(bounds: OverlayBounds, center: LngLat): OverlayBounds {
  const halfLat = (bounds.north - bounds.south) / 2;
  const halfLng = (bounds.east - bounds.west) / 2;
  return { north: center[1] + halfLat, south: center[1] - halfLat, east: center[0] + halfLng, west: center[0] - halfLng };
}

/** Grow (factor > 1) or shrink the photo around its center. */
export function scaleBounds(bounds: OverlayBounds, factor: number): OverlayBounds {
  if (!Number.isFinite(factor) || factor <= 0) return bounds;
  const centerLat = (bounds.north + bounds.south) / 2;
  const centerLng = (bounds.east + bounds.west) / 2;
  const halfLat = ((bounds.north - bounds.south) / 2) * factor;
  const halfLng = ((bounds.east - bounds.west) / 2) * factor;
  return { north: centerLat + halfLat, south: centerLat - halfLat, east: centerLng + halfLng, west: centerLng - halfLng };
}

/** Image point (0..1 from the top-left) → [lng, lat] under the pinned photo. */
export function normalizedToLngLat([x, y]: NormPoint, bounds: OverlayBounds): LngLat {
  const lng = bounds.west + x * (bounds.east - bounds.west);
  const lat = bounds.north - y * (bounds.north - bounds.south);
  return [Math.round(lng * 1e7) / 1e7, Math.round(lat * 1e7) / 1e7];
}

/** A draft potrero as the GeoJSON Polygon `sections.map_center` stores (closed ring). */
export function draftPotreroPolygon(ring: NormPoint[], bounds: OverlayBounds): { type: "Polygon"; coordinates: LngLat[][] } {
  const coordinates = ring.map((point) => normalizedToLngLat(point, bounds));
  return { type: "Polygon", coordinates: [[...coordinates, coordinates[0]]] };
}

export function draftLineString(points: NormPoint[], bounds: OverlayBounds): { type: "LineString"; coordinates: LngLat[] } {
  return { type: "LineString", coordinates: points.map((point) => normalizedToLngLat(point, bounds)) };
}

export function draftPoint(point: NormPoint, bounds: OverlayBounds): { type: "Point"; coordinates: LngLat } {
  return { type: "Point", coordinates: normalizedToLngLat(point, bounds) };
}

const foldName = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/^potrero\s+/, "").replace(/\s+/g, " ").trim();

/** An existing potrero with the same name (accents, case and a leading
 * "Potrero" ignored), so a plan can place it instead of duplicating it. */
export function matchSectionByName<T extends { id: string; name: string }>(name: string, sections: T[]): T | null {
  const wanted = foldName(name);
  if (!wanted) return null;
  return sections.find((section) => foldName(section.name) === wanted) ?? null;
}
