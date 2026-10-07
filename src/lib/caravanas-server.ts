// Server helpers shared by the /api/caravanas routes.
import { NextResponse } from "next/server";
import { CARAVANAS_MIGRATION_FILE } from "./caravanas";

/** Columns of a caravana row as the page needs it (lote and potrero names included). */
export const CARAVANA_SELECT =
  "id, tag_number, visual_tag, sex, breed, category, birth_date, cattle_id, section_id, status, source, notes, created_at, updated_at, cattle(id, category, breed, count, section_id, sections(name)), sections(name)";

/** Table, column or function from 054 not found (PostgREST schema cache or Postgres). */
export function isCaravanasSchemaMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  if (["PGRST202", "PGRST204", "PGRST205", "42P01", "42703", "42883"].includes(error.code || "")) return true;
  return /(animal_tags|dicose_number|animal_tag_summary|import_animal_tags).*(does not exist|not found|could not find)|could not find.*(animal_tags|dicose_number|animal_tag_summary|import_animal_tags)/i
    .test(error.message || "");
}

export function caravanasMigrationRequired() {
  return NextResponse.json({
    error: "Aplicá la migración 054_caravanas.sql en Supabase para usar el registro de caravanas.",
    code: "caravanas_migration_required",
    migration: CARAVANAS_MIGRATION_FILE,
  }, { status: 503 });
}

export function caravanasTimeout(action: string) {
  return NextResponse.json(
    { error: `Supabase tardó demasiado al ${action}. Intentá nuevamente.`, code: "caravanas_timeout" },
    { status: 504 },
  );
}

/** Free text → safe fragment for a PostgREST or() filter (no separators or wildcards). */
export function sanitizeCaravanaQuery(value: string | null): string {
  return (value || "").normalize("NFKC").replace(/[,()*%\\"'.:]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
}
