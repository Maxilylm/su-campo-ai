// Aguadas (water_points, migration 055): validation for the API, labels for
// the UI and how an aguada's state reaches the potreros it serves.
import type { SectionFieldStatus } from "./grazing";
import { isLngLat } from "./geo-measure";

export type WaterPointKind = "tajamar" | "bebedero" | "pozo" | "molino" | "arroyo" | "canada" | "tanque";
export type WaterPointStatus = "ok" | "bajo" | "seco" | "roto";

export const WATER_POINT_KINDS: { value: WaterPointKind; label: string }[] = [
  { value: "tajamar", label: "Tajamar" },
  { value: "bebedero", label: "Bebedero" },
  { value: "pozo", label: "Pozo" },
  { value: "molino", label: "Molino" },
  { value: "arroyo", label: "Arroyo" },
  { value: "canada", label: "Cañada" },
  { value: "tanque", label: "Tanque" },
];

export const WATER_POINT_STATUSES: { value: WaterPointStatus; label: string; adjective: { m: string; f: string } }[] = [
  { value: "ok", label: "Con agua", adjective: { m: "con agua", f: "con agua" } },
  { value: "bajo", label: "Bajo", adjective: { m: "bajo", f: "baja" } },
  { value: "seco", label: "Seco", adjective: { m: "seco", f: "seca" } },
  { value: "roto", label: "Roto", adjective: { m: "roto", f: "rota" } },
];

const KIND_SET = new Set<string>(WATER_POINT_KINDS.map((kind) => kind.value));
const STATUS_SET = new Set<string>(WATER_POINT_STATUSES.map((status) => status.value));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FEMININE_KINDS = new Set<WaterPointKind>(["canada"]);

export const MAX_SERVED_SECTIONS = 50;

export const isWaterPointKind = (value: unknown): value is WaterPointKind => typeof value === "string" && KIND_SET.has(value);
export const isWaterPointStatus = (value: unknown): value is WaterPointStatus => typeof value === "string" && STATUS_SET.has(value);
export const waterPointKindLabel = (kind: string) => WATER_POINT_KINDS.find((item) => item.value === kind)?.label ?? "Aguada";
export const waterPointStatusLabel = (status: string) => WATER_POINT_STATUSES.find((item) => item.value === status)?.label ?? status;

/** "seca" for a cañada, "seco" for a tajamar: the word the foreman would use. */
export function waterPointStatusAdjective(status: WaterPointStatus, kind: WaterPointKind): string {
  const entry = WATER_POINT_STATUSES.find((item) => item.value === status);
  if (!entry) return status;
  return FEMININE_KINDS.has(kind) ? entry.adjective.f : entry.adjective.m;
}

export interface WaterPoint {
  id: string;
  name: string;
  kind: WaterPointKind;
  status: WaterPointStatus;
  capacity_liters: number | null;
  location: { type: "Point"; coordinates: [number, number] } | null;
  section_ids: string[];
  last_checked_at: string | null;
  notes: string | null;
  map_feature_id: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface WaterPointWrite {
  name?: string;
  kind?: WaterPointKind;
  status?: WaterPointStatus;
  capacity_liters?: number | null;
  location?: { type: "Point"; coordinates: [number, number] } | null;
  section_ids?: string[];
  last_checked_at?: string | null;
  notes?: string | null;
}

export type WaterPointParse = { ok: true; value: WaterPointWrite } | { ok: false; error: string };

/**
 * Validate a create (`partial: false`, name required) or an update
 * (`partial: true`, only the fields present). Body keys are camelCase, as
 * the client sends them. `checkedNow` marks the aguada as revisada.
 */
export function parseWaterPointInput(body: Record<string, unknown>, options: { partial: boolean; now?: Date }): WaterPointParse {
  const value: WaterPointWrite = {};
  const has = (key: string) => Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;

  if (has("name") || !options.partial) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name) return { ok: false, error: "Poné un nombre a la aguada." };
    if (name.length > 120) return { ok: false, error: "El nombre es demasiado largo (máximo 120 caracteres)." };
    value.name = name;
  }
  if (has("kind")) {
    if (!isWaterPointKind(body.kind)) return { ok: false, error: "Tipo de aguada inválido." };
    value.kind = body.kind;
  }
  if (has("status")) {
    if (!isWaterPointStatus(body.status)) return { ok: false, error: "Estado de aguada inválido." };
    value.status = body.status;
  }
  if (has("capacityLiters")) {
    const raw = body.capacityLiters;
    if (raw === null || raw === "") value.capacity_liters = null;
    else {
      const liters = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(liters) || liters < 0 || liters > 1e12) return { ok: false, error: "La capacidad debe ser un número de litros." };
      value.capacity_liters = Math.round(liters);
    }
  }
  if (has("location")) {
    const raw = body.location;
    if (raw === null) value.location = null;
    else {
      const coordinates = raw && typeof raw === "object" && (raw as { type?: unknown }).type === "Point" ? (raw as { coordinates?: unknown }).coordinates : null;
      if (!isLngLat(coordinates)) return { ok: false, error: "Ubicación inválida." };
      value.location = { type: "Point", coordinates: [coordinates[0], coordinates[1]] };
    }
  }
  if (has("sectionIds")) {
    const raw = body.sectionIds;
    if (!Array.isArray(raw) || raw.some((id) => typeof id !== "string" || !UUID.test(id))) return { ok: false, error: "Potreros inválidos." };
    const unique = [...new Set(raw as string[])];
    if (unique.length > MAX_SERVED_SECTIONS) return { ok: false, error: `Una aguada puede servir a ${MAX_SERVED_SECTIONS} potreros como máximo.` };
    value.section_ids = unique;
  }
  if (has("notes")) {
    const raw = body.notes;
    if (raw === null || raw === "") value.notes = null;
    else if (typeof raw !== "string") return { ok: false, error: "Notas inválidas." };
    else if (raw.length > 2000) return { ok: false, error: "Las notas son demasiado largas (máximo 2000 caracteres)." };
    else value.notes = raw.trim() || null;
  }
  if (body.checkedNow === true) value.last_checked_at = (options.now ?? new Date()).toISOString();
  if (options.partial && Object.keys(value).length === 0) return { ok: false, error: "No hay cambios para guardar." };
  return { ok: true, value };
}

export interface WaterPointEdit {
  name: string;
  kind: WaterPointKind;
  status: WaterPointStatus;
  capacityLiters: number | null;
  sectionIds: string[];
  notes: string;
}

/**
 * Only what the user changed, relative to the aguada as it was when the
 * sheet opened, as a PATCH body (camelCase). Untouched fields are left out,
 * so a save never overwrites what someone else changed meanwhile, and the
 * served potreros are sent as they are (never filtered by a potrero list
 * that may not have loaded). Empty when nothing changed.
 */
export function waterPointPatch(original: WaterPoint, edit: WaterPointEdit): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if (edit.name.trim() !== original.name) patch.name = edit.name.trim();
  if (edit.kind !== original.kind) patch.kind = edit.kind;
  if (edit.status !== original.status) patch.status = edit.status;
  if (edit.capacityLiters !== original.capacity_liters) patch.capacityLiters = edit.capacityLiters;
  const before = new Set(original.section_ids);
  const after = new Set(edit.sectionIds);
  if (before.size !== after.size || [...after].some((id) => !before.has(id))) patch.sectionIds = [...after];
  if ((edit.notes.trim() || null) !== (original.notes?.trim() || null)) patch.notes = edit.notes;
  return patch;
}

/** Row from the API/DB → WaterPoint, or null when it isn't one. */
export function normalizeWaterPoint(row: unknown): WaterPoint | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  if (typeof r.id !== "string" || typeof r.name !== "string") return null;
  const coordinates = r.location && typeof r.location === "object" ? (r.location as { coordinates?: unknown }).coordinates : null;
  const capacity = r.capacity_liters == null ? null : Number(r.capacity_liters);
  return {
    id: r.id,
    name: r.name,
    kind: isWaterPointKind(r.kind) ? r.kind : "tajamar",
    status: isWaterPointStatus(r.status) ? r.status : "ok",
    capacity_liters: capacity != null && Number.isFinite(capacity) ? capacity : null,
    location: isLngLat(coordinates) ? { type: "Point", coordinates: [coordinates[0], coordinates[1]] } : null,
    section_ids: Array.isArray(r.section_ids) ? r.section_ids.filter((id): id is string => typeof id === "string") : [],
    last_checked_at: typeof r.last_checked_at === "string" ? r.last_checked_at : null,
    notes: typeof r.notes === "string" ? r.notes : null,
    map_feature_id: typeof r.map_feature_id === "string" ? r.map_feature_id : null,
    ...(typeof r.created_at === "string" ? { created_at: r.created_at } : {}),
    ...(typeof r.updated_at === "string" ? { updated_at: r.updated_at } : {}),
  };
}

/** Whole days since the last check (null = never checked). */
export function daysSinceChecked(lastCheckedAt: string | null, now = Date.now()): number | null {
  if (!lastCheckedAt) return null;
  const at = Date.parse(lastCheckedAt);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, Math.floor((now - at) / 86_400_000));
}

/** "Revisada hoy", "Revisada hace 3 d", "Nunca revisada". */
export function checkedLabel(lastCheckedAt: string | null, now = Date.now()): string {
  const days = daysSinceChecked(lastCheckedAt, now);
  if (days == null) return "Nunca revisada";
  if (days === 0) return "Revisada hoy";
  if (days === 1) return "Revisada ayer";
  return `Revisada hace ${days} d`;
}

/** An aguada nobody has looked at in this long is due a visit. */
export const CHECK_OVERDUE_DAYS = 7;

export function isCheckOverdue(lastCheckedAt: string | null, now = Date.now()): boolean {
  const days = daysSinceChecked(lastCheckedAt, now);
  return days == null || days >= CHECK_OVERDUE_DAYS;
}

/** Badge tone (existing state tokens): water is info-blue, then warn, bad. */
export function waterStatusTone(status: WaterPointStatus): "info" | "warn" | "bad" {
  return status === "ok" ? "info" : status === "bajo" ? "warn" : "bad";
}

/** Problems first, then the longest unchecked, then by name. */
export function sortWaterPoints(points: WaterPoint[], now = Date.now()): WaterPoint[] {
  const rank: Record<WaterPointStatus, number> = { roto: 0, seco: 0, bajo: 1, ok: 2 };
  return [...points].sort((a, b) =>
    rank[a.status] - rank[b.status]
    || (daysSinceChecked(b.last_checked_at, now) ?? Infinity) - (daysSinceChecked(a.last_checked_at, now) ?? Infinity)
    || a.name.localeCompare(b.name, "es"));
}

// How a potrero's water reads, worst last. "inundado" is its own problem but
// no worse than "bajo" for ordering purposes.
const SECTION_WATER_RANK: Record<string, number> = { bueno: 0, inundado: 1, bajo: 1, seco: 2 };
const POINT_RANK: Record<WaterPointStatus, number> = { ok: 0, bajo: 1, seco: 2, roto: 2 };
const POINT_TO_SECTION: Record<WaterPointStatus, string> = { ok: "bueno", bajo: "bajo", seco: "seco", roto: "seco" };

export interface WaterPointRef {
  id: string;
  name: string;
  kind: WaterPointKind;
  status: WaterPointStatus;
}

/**
 * The water a potrero gets from its aguadas: the best one wins (animals walk
 * to whichever has water). Null when no aguada serves it.
 */
export function servedWaterStatus(points: Pick<WaterPoint, "status">[]): string | null {
  if (points.length === 0) return null;
  const best = points.reduce((a, b) => (POINT_RANK[b.status] < POINT_RANK[a.status] ? b : a));
  return POINT_TO_SECTION[best.status];
}

/**
 * Attach each potrero's aguadas and fold their state into `waterStatus`.
 * Cautious by design: aguadas can only make a potrero's water look worse
 * than what was recorded on the potrero itself, never better — a manual
 * "seco" stays "seco" even if a tajamar there is marked ok. `waterIssue`
 * names the failing aguadas when they are the reason. Mutates and returns.
 */
export function applyWaterPoints(statuses: SectionFieldStatus[], points: WaterPoint[]): SectionFieldStatus[] {
  const bySection = new Map<string, WaterPoint[]>();
  for (const point of points) {
    for (const sectionId of point.section_ids) {
      const list = bySection.get(sectionId) ?? [];
      list.push(point);
      bySection.set(sectionId, list);
    }
  }
  for (const status of statuses) {
    const served = bySection.get(status.id);
    if (!served || served.length === 0) continue;
    status.waterPoints = served.map((point) => ({ id: point.id, name: point.name, kind: point.kind, status: point.status }));
    const derived = servedWaterStatus(served);
    if (!derived) continue;
    const manualRank = SECTION_WATER_RANK[status.waterStatus] ?? 0;
    const derivedRank = SECTION_WATER_RANK[derived] ?? 0;
    if (derivedRank === 0 || derivedRank < manualRank) continue;
    if (derivedRank > manualRank) status.waterStatus = derived;
    if (status.waterStatus !== derived) continue;
    const failing = served.filter((point) => point.status !== "ok");
    const names = failing.slice(0, 3).map((point) => `${point.name} ${waterPointStatusAdjective(point.status, point.kind)}`);
    if (failing.length > 3) names.push(`y ${failing.length - 3} más`);
    status.waterIssue = `${failing.length === 1 ? "aguada" : "aguadas"}: ${names.join(", ")}`;
  }
  return statuses;
}

/** Short Spanish lines on the aguadas for the assistant's farm context. */
export function waterPointsAIContext(points: WaterPoint[], sectionNames: Map<string, string>, escape: (value: string) => string, now = Date.now()): string {
  if (points.length === 0) return "";
  const lines = points.map((point) => {
    const served = point.section_ids.map((id) => sectionNames.get(id)).filter((name): name is string => Boolean(name));
    const parts = [
      `- aguada "${escape(point.name)}" (${waterPointKindLabel(point.kind).toLowerCase()}): ${waterPointStatusLabel(point.status).toLowerCase()}`,
      served.length > 0 ? `abastece ${served.map(escape).join(", ")}` : "sin potreros asignados",
      checkedLabel(point.last_checked_at, now).toLowerCase(),
    ];
    if (point.capacity_liters) parts.push(`${point.capacity_liters.toLocaleString("es-UY")} L`);
    return parts.join(" · ");
  });
  return `\nAGUADAS (estado registrado en el mapa; una aguada seca o rota deja sin agua a los potreros que abastece):\n${lines.join("\n")}\n`;
}
