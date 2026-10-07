import type { CaravanaStatus } from "@/lib/caravanas";

export interface CaravanaLoteRef {
  id: string;
  category: string;
  breed: string | null;
  count: number;
  section_id: string | null;
  sections: { name: string } | null;
}

export interface CaravanaItem {
  id: string;
  tag_number: string;
  visual_tag: string | null;
  sex: string | null;
  breed: string | null;
  category: string | null;
  birth_date: string | null;
  cattle_id: string | null;
  section_id: string | null;
  status: CaravanaStatus;
  source: string;
  notes: string | null;
  cattle: CaravanaLoteRef | null;
  sections: { name: string } | null;
}

/** A lote (cattle row) as /api/cattle returns it, reduced to what this page uses. */
export interface LoteOption {
  id: string;
  label: string;
  count: number;
  sectionId: string | null;
}

export interface SectionOption {
  id: string;
  name: string;
}

export interface CaravanaFilters {
  q: string;
  status: CaravanaStatus | "all";
  /** uuid, "none" (sin lote) or "" (todos). */
  cattleId: string;
  /** uuid, "none" (sin lote ni potrero) or "" (todos). */
  sectionId: string;
}

export const EMPTY_FILTERS: CaravanaFilters = { q: "", status: "activo", cattleId: "", sectionId: "" };

/** Radix Select cannot hold "", so "no value" options use this. */
export const NONE = "__none";
export const ALL = "__all";

/** The animal's potrero: its lote's when it has one. */
export function effectiveSectionName(item: CaravanaItem): string | null {
  if (item.cattle_id) return item.cattle?.sections?.name ?? null;
  return item.sections?.name ?? null;
}
