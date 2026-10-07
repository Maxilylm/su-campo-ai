// Alambrados: kind (convencional / eléctrico), length and on-map style.
// Pure so the side list, the popup and the tests agree on every number.
import { geometryLengthMeters } from "./geo-measure";

export type FenceKind = "convencional" | "electrico";

export const FENCE_KINDS: { value: FenceKind; label: string; description: string }[] = [
  { value: "convencional", label: "Convencional", description: "Postes y alambre liso o de púa" },
  { value: "electrico", label: "Eléctrico", description: "Boyero, uno o más hilos" },
];

export const fenceKindLabel = (kind: FenceKind) => FENCE_KINDS.find((item) => item.value === kind)?.label ?? "Convencional";

/** Fences drawn before kinds existed have no property: they are convencional. */
export function fenceKindOf(properties: unknown): FenceKind {
  if (properties && typeof properties === "object" && (properties as { fence_kind?: unknown }).fence_kind === "electrico") return "electrico";
  return "convencional";
}

/** Strands ("hilos"), when recorded: 1–12, else null. */
export function fenceStrandsOf(properties: unknown): number | null {
  const value = properties && typeof properties === "object" ? (properties as { strands?: unknown }).strands : null;
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 12 ? value : null;
}

/** Validated fence properties for a write; unknown keys are dropped. */
export function fenceProperties(input: { kind?: unknown; strands?: unknown }): { fence_kind: FenceKind; strands?: number } {
  const kind: FenceKind = input.kind === "electrico" ? "electrico" : "convencional";
  const strands = typeof input.strands === "number" ? input.strands : Number(input.strands);
  return Number.isInteger(strands) && strands >= 1 && strands <= 12 ? { fence_kind: kind, strands } : { fence_kind: kind };
}

export interface FenceLike {
  type: string;
  geometry: unknown;
  properties?: unknown;
}

export interface FenceTotals {
  count: number;
  totalM: number;
  byKind: Record<FenceKind, { count: number; meters: number }>;
}

export function fenceTotals(features: FenceLike[]): FenceTotals {
  const totals: FenceTotals = {
    count: 0,
    totalM: 0,
    byKind: { convencional: { count: 0, meters: 0 }, electrico: { count: 0, meters: 0 } },
  };
  for (const feature of features) {
    if (feature.type !== "alambrado") continue;
    const meters = geometryLengthMeters(feature.geometry);
    const kind = fenceKindOf(feature.properties);
    totals.count += 1;
    totals.totalM += meters;
    totals.byKind[kind].count += 1;
    totals.byKind[kind].meters += meters;
  }
  return totals;
}

export interface FenceStyle {
  /** Main stroke. */
  color: string;
  weight: number;
  dashArray?: string;
  /** Dark casing drawn under the stroke so it reads on any imagery. */
  casingColor: string;
  casingWeight: number;
}

// Satellite-facing colors (Leaflet SVG strokes can't read CSS tokens):
// silver wire for convencional, boyero yellow for eléctrico; both on a dark
// casing, so they never read as the thin colored potrero outlines.
export const FENCE_COLORS: Record<FenceKind, string> = { convencional: "#e5e7eb", electrico: "#facc15" };
const FENCE_CASING = "#111827";

/**
 * Zoom-aware stroke: hairline at farm overview (zoom ≤ 13), full weight from
 * zoom 17. Eléctrico is dashed like the insulators on a boyero line.
 */
export function fenceStyle(kind: FenceKind, zoom: number): FenceStyle {
  const z = Number.isFinite(zoom) ? Math.min(18, Math.max(10, zoom)) : 15;
  const weight = Math.round((z <= 13 ? 1.5 : z >= 17 ? 3.5 : 1.5 + (z - 13) * 0.5) * 10) / 10;
  const dash = Math.round(weight * 3);
  return {
    color: FENCE_COLORS[kind],
    weight,
    dashArray: kind === "electrico" ? `${dash} ${Math.round(dash * 0.6)}` : undefined,
    casingColor: FENCE_CASING,
    casingWeight: Math.round((weight + (z <= 13 ? 1.5 : 2.5)) * 10) / 10,
  };
}
