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

export interface SectionOccupancyRow {
  section_id: string;
  occupied_since: string | null;
  last_vacated_at: string | null;
}

/** Attach the grazing/rest clock (section_occupancy, 045) to section rows.
 * Sections with no row keep null dates: their start is unknown, not "today". */
export function mergeOccupancy<T extends GrazingSectionInput>(sections: T[], occupancy: SectionOccupancyRow[]): T[] {
  const bySection = new Map(occupancy.map((row) => [row.section_id, row]));
  return sections.map((section) => {
    const row = bySection.get(section.id);
    return row ? { ...section, occupied_since: row.occupied_since, last_vacated_at: row.last_vacated_at } : section;
  });
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

/** Past this many days in one potrero, campo natural starts losing the
 * regrowth it needs; the plan suggests moving on. */
export const DEFAULT_MAX_GRAZING_DAYS = 21;

export interface MoveReason {
  code: "days" | "pasture" | "stocking" | "water";
  label: string;
}

/** Why the animals in this potrero should move, most urgent first; empty when
 * nothing says so (or the potrero is empty). */
export function moveReasons(status: SectionFieldStatus, maxGrazingDays = DEFAULT_MAX_GRAZING_DAYS): MoveReason[] {
  if (status.heads === 0) return [];
  const reasons: MoveReason[] = [];
  if (status.waterStatus === "seco") reasons.push({ code: "water", label: "sin agua" });
  if (status.stocking === "over") reasons.push({ code: "stocking", label: `sobrecargado (${status.stockingReason})` });
  if (POOR_PASTURE.has(status.pastureStatus)) reasons.push({ code: "pasture", label: status.pastureStatus === "seco" ? "pasto seco" : "pasto sobrepastoreado" });
  if (status.daysOccupied != null && status.daysOccupied >= maxGrazingDays) reasons.push({ code: "days", label: `${status.daysOccupied} días de pastoreo` });
  return reasons;
}

export interface DestinationSuggestion {
  sectionId: string;
  name: string;
  score: number;
  /** Short Spanish reasons shown next to the suggestion. */
  notes: string[];
  /** The destination's stocking if these heads moved in. */
  resultingStocking: StockingLevel;
}

/** Rank empty potreros that could take `heads` animals (`ug` animal units).
 * Hard rules: empty, no active crop, water not dry, pasture not worn out,
 * capacity not exceeded. Then prefer longer rest, good pasture and water. */
export function suggestDestinations(
  statuses: SectionFieldStatus[],
  from: { sectionId: string | null; heads: number; ug: number },
  minRestDays = DEFAULT_MIN_REST_DAYS,
  limit = 3,
): DestinationSuggestion[] {
  const suggestions: DestinationSuggestion[] = [];
  for (const status of statuses) {
    if (status.id === from.sectionId || status.heads > 0 || status.crops.length > 0) continue;
    if (status.waterStatus === "seco" || POOR_PASTURE.has(status.pastureStatus)) continue;
    const resulting = stockingFor(from.heads, from.ug, status.capacity, status.hectares).level;
    if (resulting === "over") continue;

    const notes: string[] = [];
    let score = 0;
    if (status.daysRested == null) {
      score += 10;
      notes.push("descanso sin registrar");
    } else if (status.daysRested >= minRestDays) {
      score += 30 + Math.min(status.daysRested - minRestDays, 60) / 3;
      notes.push(`${status.daysRested} d de descanso`);
    } else {
      score -= 20;
      notes.push(`solo ${status.daysRested} d de descanso`);
    }
    if (status.pastureStatus === "bueno") score += 15;
    if (status.pastureStatus === "creciendo") {
      score += 5;
      notes.push("pasto creciendo");
    }
    if (status.waterStatus === "bueno") score += 10;
    else if (POOR_WATER.has(status.waterStatus)) {
      score -= 10;
      notes.push(status.waterStatus === "bajo" ? "agua baja" : "inundado");
    }
    if (resulting === "high") {
      score -= 10;
      notes.push("quedaría al límite");
    }
    if (status.capacity == null && status.hectares == null) notes.push("sin capacidad cargada");
    suggestions.push({ sectionId: status.id, name: status.name, score: Math.round(score * 10) / 10, notes, resultingStocking: resulting });
  }
  return suggestions.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "es")).slice(0, limit);
}

export interface RotationMove {
  fromSectionId: string;
  fromName: string;
  heads: number;
  reasons: MoveReason[];
  destinations: DestinationSuggestion[];
}

/** Every occupied potrero whose animals should move, with where they could go.
 * Destinations already proposed for an earlier (more urgent) move are not
 * offered again, so two herds are never sent to the same potrero. */
export function planRotation(statuses: SectionFieldStatus[], options: { maxGrazingDays?: number; minRestDays?: number } = {}): RotationMove[] {
  const urgency = (reasons: MoveReason[]) => reasons.reduce((sum, reason) => sum + ({ water: 8, stocking: 4, pasture: 2, days: 1 })[reason.code], 0);
  const candidates = statuses
    .map((status) => ({ status, reasons: moveReasons(status, options.maxGrazingDays) }))
    .filter((entry) => entry.reasons.length > 0)
    .sort((a, b) => urgency(b.reasons) - urgency(a.reasons) || b.status.heads - a.status.heads);

  const taken = new Set<string>();
  return candidates.map(({ status, reasons }) => {
    const available = statuses.filter((candidate) => !taken.has(candidate.id));
    const destinations = suggestDestinations(available, { sectionId: status.id, heads: status.heads, ug: status.ug }, options.minRestDays);
    if (destinations[0]) taken.add(destinations[0].sectionId);
    return { fromSectionId: status.id, fromName: status.name, heads: status.heads, reasons, destinations };
  });
}
