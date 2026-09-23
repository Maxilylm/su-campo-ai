// Per-potrero field status: what is in each section, how hard it is stocked,
// and how long it has been grazed or rested. Pure, so the map, the alerts, the
// daily plan and the assistant all read the same numbers.

/** Animal-unit equivalences (UG) per category — rounded from the Plan
 * Agropecuario tables used in Uruguay. Batches carry no age, so each category
 * takes its most common weight class. */
export const UG_BY_CATEGORY: Record<string, number> = {
  vaca: 1,
  toro: 1.2,
  novillo: 0.8,
  vaquillona: 0.7,
  ternero: 0.4,
  ternera: 0.4,
  caballo: 1.2,
  yegua: 1.2,
  oveja: 0.17,
};
const DEFAULT_UG = 1;

/** Without a head capacity, UG/ha against what campo natural carries year-round. */
export const UG_PER_HA_HIGH = 1;
export const UG_PER_HA_OVER = 1.5;
/** A potrero at or above this share of its capacity is flagged before it overflows. */
export const CAPACITY_HIGH_SHARE = 0.9;
/** Rest a campo natural potrero usually needs before it is grazed again. */
export const DEFAULT_MIN_REST_DAYS = 30;

const ACTIVE_CROP_STATUSES = new Set(["planted", "growing"]);
const DAY_MS = 86_400_000;

export const CATEGORY_LABELS: Record<string, [string, string]> = {
  vaca: ["vaca", "vacas"],
  toro: ["toro", "toros"],
  novillo: ["novillo", "novillos"],
  vaquillona: ["vaquillona", "vaquillonas"],
  ternero: ["ternero", "terneros"],
  ternera: ["ternera", "terneras"],
  caballo: ["caballo", "caballos"],
  yegua: ["yegua", "yeguas"],
  oveja: ["oveja", "ovejas"],
};

const CROP_LABELS: Record<string, string> = {
  soja: "Soja", maiz: "Maíz", trigo: "Trigo", cebada: "Cebada", sorgo: "Sorgo",
  girasol: "Girasol", arroz: "Arroz", avena: "Avena", pradera: "Pradera", raigras: "Raigrás",
};

export interface GrazingSectionInput {
  id: string;
  name: string;
  size_hectares?: number | string | null;
  capacity?: number | null;
  color?: string | null;
  water_status?: string | null;
  pasture_status?: string | null;
  padron_id?: string | null;
  map_center?: unknown;
  occupied_since?: string | null;
  last_vacated_at?: string | null;
}

export interface GrazingCattleInput {
  id: string;
  section_id: string | null;
  category: string;
  count: number;
  breed?: string | null;
  health_status?: string | null;
}

export interface GrazingCropInput {
  id: string;
  section_id: string | null;
  crop_type: string;
  variety?: string | null;
  status?: string | null;
  planted_hectares?: number | string | null;
  expected_harvest?: string | null;
}

export type StockingLevel = "empty" | "ok" | "high" | "over";

export interface SectionFieldStatus {
  id: string;
  name: string;
  color: string | null;
  hectares: number | null;
  capacity: number | null;
  waterStatus: string;
  pastureStatus: string;
  hasGeometry: boolean;
  padronId: string | null;
  heads: number;
  byCategory: { category: string; count: number }[];
  batches: { id: string; category: string; count: number; breed: string | null; healthStatus: string | null }[];
  ug: number;
  headsPerHa: number | null;
  ugPerHa: number | null;
  capacityShare: number | null;
  stocking: StockingLevel;
  /** Human reason for a high/over level, e.g. "52 de 40 cabezas". */
  stockingReason: string | null;
  crops: { id: string; cropType: string; label: string; variety: string | null; status: string; expectedHarvest: string | null }[];
  daysOccupied: number | null;
  daysRested: number | null;
  /** Short Spanish summary for map labels and the assistant. */
  summary: string;
}

function toNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function wholeDaysSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return Math.max(0, Math.floor((now - time) / DAY_MS));
}

export function categoryLabel(category: string, count: number): string {
  const labels = CATEGORY_LABELS[category];
  if (!labels) return category;
  return count === 1 ? labels[0] : labels[1];
}

export function cropLabel(cropType: string): string {
  const key = cropType.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return CROP_LABELS[key] ?? (cropType.charAt(0).toUpperCase() + cropType.slice(1));
}

export function ugFor(category: string, count: number): number {
  return (UG_BY_CATEGORY[category] ?? DEFAULT_UG) * count;
}

function stockingFor(heads: number, ug: number, capacity: number | null, hectares: number | null): { level: StockingLevel; reason: string | null; share: number | null } {
  if (heads <= 0) return { level: "empty", reason: null, share: null };
  if (capacity != null && capacity > 0) {
    const share = heads / capacity;
    const reason = `${heads} de ${capacity} cabezas`;
    if (heads > capacity) return { level: "over", reason, share };
    if (share >= CAPACITY_HIGH_SHARE) return { level: "high", reason, share };
    return { level: "ok", reason: null, share };
  }
  if (hectares != null && hectares > 0) {
    const ugPerHa = ug / hectares;
    const reason = `${round(ugPerHa, 2)} UG/ha`;
    if (ugPerHa > UG_PER_HA_OVER) return { level: "over", reason, share: null };
    if (ugPerHa > UG_PER_HA_HIGH) return { level: "high", reason, share: null };
  }
  return { level: "ok", reason: null, share: null };
}

function summarize(status: Omit<SectionFieldStatus, "summary">): string {
  const parts: string[] = [];
  if (status.heads > 0) {
    parts.push(status.byCategory.length === 1
      ? `${status.heads} ${categoryLabel(status.byCategory[0].category, status.heads)}`
      : `${status.heads} cab.`);
    if (status.daysOccupied != null) parts.push(`${status.daysOccupied} d`);
  }
  if (status.crops.length > 0) parts.push(status.crops.map((crop) => crop.label).join(" + "));
  if (status.heads === 0 && status.crops.length === 0) {
    parts.push(status.daysRested != null ? `libre · ${status.daysRested} d descanso` : "libre");
  }
  return parts.join(" · ");
}

export function buildFieldStatus(
  sections: GrazingSectionInput[],
  cattle: GrazingCattleInput[],
  crops: GrazingCropInput[],
  now: number,
): SectionFieldStatus[] {
  const cattleBySection = new Map<string, GrazingCattleInput[]>();
  for (const batch of cattle) {
    if (!batch.section_id || !(batch.count > 0)) continue;
    const list = cattleBySection.get(batch.section_id) ?? [];
    list.push(batch);
    cattleBySection.set(batch.section_id, list);
  }
  const cropsBySection = new Map<string, GrazingCropInput[]>();
  for (const crop of crops) {
    if (!crop.section_id || !ACTIVE_CROP_STATUSES.has(crop.status ?? "planted")) continue;
    const list = cropsBySection.get(crop.section_id) ?? [];
    list.push(crop);
    cropsBySection.set(crop.section_id, list);
  }

  return sections.map((section) => {
    const batches = cattleBySection.get(section.id) ?? [];
    const heads = batches.reduce((sum, batch) => sum + batch.count, 0);
    const categoryTotals = new Map<string, number>();
    for (const batch of batches) categoryTotals.set(batch.category, (categoryTotals.get(batch.category) ?? 0) + batch.count);
    const byCategory = [...categoryTotals].map(([category, count]) => ({ category, count })).sort((a, b) => b.count - a.count);
    const ug = round(batches.reduce((sum, batch) => sum + ugFor(batch.category, batch.count), 0), 2);
    const hectares = toNumber(section.size_hectares);
    const capacity = toNumber(section.capacity);
    const stocking = stockingFor(heads, ug, capacity, hectares);
    const occupied = heads > 0;
    const sectionCrops = (cropsBySection.get(section.id) ?? []).map((crop) => ({
      id: crop.id,
      cropType: crop.crop_type,
      label: cropLabel(crop.crop_type),
      variety: crop.variety ?? null,
      status: crop.status ?? "planted",
      expectedHarvest: crop.expected_harvest ?? null,
    }));
    const base: Omit<SectionFieldStatus, "summary"> = {
      id: section.id,
      name: section.name,
      color: section.color ?? null,
      hectares,
      capacity,
      waterStatus: section.water_status || "bueno",
      pastureStatus: section.pasture_status || "bueno",
      hasGeometry: section.map_center != null,
      padronId: section.padron_id ?? null,
      heads,
      byCategory,
      batches: batches.map((batch) => ({ id: batch.id, category: batch.category, count: batch.count, breed: batch.breed ?? null, healthStatus: batch.health_status ?? null })),
      ug,
      headsPerHa: occupied && hectares ? round(heads / hectares, 2) : null,
      ugPerHa: occupied && hectares ? round(ug / hectares, 2) : null,
      capacityShare: stocking.share == null ? null : round(stocking.share, 2),
      stocking: stocking.level,
      stockingReason: stocking.reason,
      crops: sectionCrops,
      // The occupancy clock only means something in the state it describes:
      // a stale occupied_since on an empty potrero is not "days grazed".
      daysOccupied: occupied ? wholeDaysSince(section.occupied_since, now) : null,
      daysRested: occupied ? null : wholeDaysSince(section.last_vacated_at, now),
    };
    return { ...base, summary: summarize(base) };
  });
}

const POOR_PASTURE = new Set(["sobrepastoreado", "seco"]);
const POOR_WATER = new Set(["bajo", "seco", "inundado"]);

/** Something a manager should look at today: too many animals, a worn-out
 * pasture, or animals standing where the water is failing. */
export function sectionNeedsAttention(status: SectionFieldStatus): boolean {
  return status.stocking === "over"
    || status.stocking === "high"
    || POOR_PASTURE.has(status.pastureStatus)
    || (status.heads > 0 && POOR_WATER.has(status.waterStatus));
}

export interface FieldTotals {
  sections: number;
  occupied: number;
  heads: number;
  ug: number;
  hectares: number;
  ugPerHa: number | null;
  over: number;
  high: number;
}

export function fieldTotals(statuses: SectionFieldStatus[]): FieldTotals {
  const hectares = statuses.reduce((sum, status) => sum + (status.hectares ?? 0), 0);
  const ug = round(statuses.reduce((sum, status) => sum + status.ug, 0), 2);
  return {
    sections: statuses.length,
    occupied: statuses.filter((status) => status.heads > 0).length,
    heads: statuses.reduce((sum, status) => sum + status.heads, 0),
    ug,
    hectares: round(hectares, 2),
    ugPerHa: hectares > 0 ? round(ug / hectares, 2) : null,
    over: statuses.filter((status) => status.stocking === "over").length,
    high: statuses.filter((status) => status.stocking === "high").length,
  };
}
