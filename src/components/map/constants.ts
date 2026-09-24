// Shared types and on-map palette for FarmMap. These hex values are drawn on
// satellite imagery by Leaflet (SVG stroke/fill attributes cannot read CSS
// tokens) and double as legend swatches, so they stay literal here.

import type { StockingLevel } from "@/lib/grazing";

export interface Padron {
  id: string;
  padron_code: string;
  padron_number: number;
  department_code: string;
  department_name: string;
  area_m2: number | null;
  geometry: GeoJSON.Geometry;
  sections?: { id: string; name: string; color: string; map_center?: Record<string, unknown> | null }[];
}

export interface MapFeature {
  id: string;
  type: string;
  name: string | null;
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
}

export const DEPARTMENTS = [
  ["A", "Canelones"], ["B", "Maldonado"], ["C", "Rocha"],
  ["D", "Treinta y Tres"], ["E", "Cerro Largo"], ["F", "Rivera"],
  ["G", "Artigas"], ["H", "Salto"], ["I", "Paysandú"],
  ["J", "Río Negro"], ["K", "Soriano"], ["L", "Colonia"],
  ["M", "San José"], ["N", "Flores"], ["O", "Florida"],
  ["P", "Lavalleja"], ["Q", "Durazno"], ["R", "Tacuarembó"],
  ["V", "Montevideo"],
] as const;

export const FEATURE_TYPES = [
  { value: "road", label: "Camino", color: "#a1887f", icon: "🛤️", dash: "8 4" },
  { value: "portera", label: "Portera", color: "#fbbf24", icon: "🚪", dash: "" },
  { value: "alambrado", label: "Alambrado", color: "#78909c", icon: "🔗", dash: "4 4" },
  { value: "aguada", label: "Aguada", color: "#42a5f5", icon: "💧", dash: "" },
  { value: "manga", label: "Manga o corral", color: "#ef5350", icon: "🏗️", dash: "" },
] as const;

export type FeatureType = (typeof FEATURE_TYPES)[number];

export const featureType = (value: string | null | undefined): FeatureType | undefined =>
  FEATURE_TYPES.find((type) => type.value === value);

/** Aguadas and porteras are single points; the rest are drawn as lines. */
export const isPointFeature = (value: string | null | undefined) => value === "aguada" || value === "portera";

export const FALLBACK_FEATURE_COLOR = "#ffffff";
export const SEARCH_RESULT_COLOR = "#fbbf24";

export const PADRON_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
export const padronColor = (index: number) => PADRON_COLORS[index % PADRON_COLORS.length];

// Stocking overrides a potrero's own color so trouble reads at a glance.
export const STOCKING_FILL: Partial<Record<StockingLevel, string>> = { over: "#ef4444", high: "#f59e0b" };

export const SECTION_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];
export const DEFAULT_SUBSECTION_COLOR = "#22c55e";

export const SECTION_COLOR_NAMES: Record<string, string> = {
  "#22c55e": "verde", "#3b82f6": "azul", "#f59e0b": "ámbar", "#ef4444": "rojo",
  "#8b5cf6": "violeta", "#ec4899": "rosa", "#06b6d4": "celeste", "#84cc16": "lima",
};

export const hectaresFromM2 = (areaM2: number) => Math.round(areaM2 / 10000 * 10) / 10;
