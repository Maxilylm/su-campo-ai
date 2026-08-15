import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { validateFinanceImportRows } from "@/lib/finance-import";

const MAX_IMPORT_ROWS = 200;

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req, 1_200_000);
  if ("error" in parsed) return parsed.error;
  const rawRows = parsed.data.rows;
  if (!Array.isArray(rawRows) || rawRows.length === 0) {
    return NextResponse.json({ error: "El archivo no contiene filas para importar." }, { status: 400 });
  }

  const validation = validateFinanceImportRows(rawRows, MAX_IMPORT_ROWS);
  if (validation.errors.length > 0) {
    return NextResponse.json({ error: "Hay filas que necesitan corrección.", rowErrors: validation.errors.slice(0, 20) }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const [sectionsResult, cropsResult, cattleResult] = await Promise.all([
    db.from("sections").select("id").eq("farm_id", result.farmId),
    db.from("crops").select("id, section_id").eq("farm_id", result.farmId),
    db.from("cattle").select("id, section_id").eq("farm_id", result.farmId),
  ]);
  if (sectionsResult.error) return databaseFailure("financial import sections lookup", sectionsResult.error);
  if (cropsResult.error) return databaseFailure("financial import crops lookup", cropsResult.error);
  if (cattleResult.error) return databaseFailure("financial import cattle lookup", cattleResult.error);

  const sectionIds = new Set((sectionsResult.data || []).map((row) => row.id));
  const cropSections = new Map((cropsResult.data || []).map((row) => [row.id, row.section_id]));
  const cattleSections = new Map((cattleResult.data || []).map((row) => [row.id, row.section_id]));
  const relationErrors: string[] = [];
  validation.rows.forEach((row, index) => {
    const line = index + 2;
    if (row.sectionId && !sectionIds.has(row.sectionId)) relationErrors.push(`Fila ${line}: sección no válida para este campo.`);
    if (row.cropId && !cropSections.has(row.cropId)) relationErrors.push(`Fila ${line}: cultivo no válido para este campo.`);
    if (row.cattleId && !cattleSections.has(row.cattleId)) relationErrors.push(`Fila ${line}: lote de hacienda no válido para este campo.`);
    const cropSection = row.cropId ? cropSections.get(row.cropId) : null;
    const cattleSection = row.cattleId ? cattleSections.get(row.cattleId) : null;
    if (row.sectionId && cropSection && row.sectionId !== cropSection) relationErrors.push(`Fila ${line}: el cultivo no pertenece a la sección indicada.`);
    if (row.sectionId && cattleSection && row.sectionId !== cattleSection) relationErrors.push(`Fila ${line}: la hacienda no pertenece a la sección indicada.`);
    if (!row.sectionId && cropSection && cattleSection && cropSection !== cattleSection) relationErrors.push(`Fila ${line}: cultivo y hacienda pertenecen a secciones distintas.`);
  });
  if (relationErrors.length > 0) {
    return NextResponse.json({ error: "Hay vínculos que necesitan corrección.", rowErrors: relationErrors.slice(0, 20) }, { status: 400 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const inserts = validation.rows.map((row) => ({
    farm_id: result.farmId,
    type: row.type,
    category: row.category,
    description: row.description,
    amount: row.amount,
    currency: row.currency,
    date: row.date || today,
    section_id: row.sectionId,
    crop_id: row.cropId,
    cattle_id: row.cattleId,
    notes: row.notes,
  }));
  const { data, error } = await db.from("financial_transactions").insert(inserts).select("id");
  if (error) return databaseFailure("financial import", error);
  return NextResponse.json({ imported: data?.length || 0 });
}
