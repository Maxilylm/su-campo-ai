import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { isValidCattleCategory, normalizedEarTag } from "@/lib/cattle";
import { isValidDateValue } from "@/lib/date";

const MAX_IMPORT_ROWS = 200;

function text(value: unknown, maxLength = 500): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req, 1_200_000);
  if ("error" in parsed) return parsed.error;
  const rows = parsed.data.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "El archivo no contiene filas para importar." }, { status: 400 });
  }
  if (rows.length > MAX_IMPORT_ROWS) {
    return NextResponse.json({ error: `La importación admite hasta ${MAX_IMPORT_ROWS} filas por vez.` }, { status: 413 });
  }

  const db = getSupabaseAdmin();
  const { data: sections, error: sectionsError } = await db
    .from("sections")
    .select("id, name")
    .eq("farm_id", result.farmId);
  if (sectionsError) return databaseFailure("cattle import sections lookup", sectionsError);
  const sectionIds = new Set((sections || []).map((section) => section.id));
  const errors: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  const seenEarTags = new Map<string, number>();

  rows.forEach((row, index) => {
    const line = index + 2;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`Fila ${line}: formato inválido.`);
      return;
    }
    const data = row as Record<string, unknown>;
    const category = text(data.category) || "vaca";
    const count = data.count == null || data.count === "" ? 1 : Number(data.count);
    const weight = data.weightKg == null || data.weightKg === "" ? null : Number(data.weightKg);
    const sectionId = text(data.sectionId);
    const birthDate = text(data.birthDate, 20);
    const earTag = text(data.earTag, 100);
    const normalizedTag = normalizedEarTag(earTag);

    if (!isValidCattleCategory(category)) errors.push(`Fila ${line}: categoría inválida.`);
    if (!Number.isInteger(count) || count < 1) errors.push(`Fila ${line}: cantidad debe ser un entero positivo.`);
    if (weight !== null && (!Number.isFinite(weight) || weight <= 0)) errors.push(`Fila ${line}: peso debe ser positivo.`);
    if (birthDate && !isValidDateValue(birthDate)) errors.push(`Fila ${line}: fecha de nacimiento inválida.`);
    if (sectionId && !sectionIds.has(sectionId)) errors.push(`Fila ${line}: sección no válida para este campo.`);
    if (normalizedTag) {
      const previousLine = seenEarTags.get(normalizedTag);
      if (previousLine) errors.push(`Fila ${line}: la caravana «${earTag}» también aparece en la fila ${previousLine}.`);
      else seenEarTags.set(normalizedTag, line);
    }

    inserts.push({
      farm_id: result.farmId,
      section_id: sectionId || null,
      category,
      breed: text(data.breed, 100),
      count,
      tag_range: text(data.tagRange, 100),
      ear_tag: earTag,
      health_status: text(data.healthStatus, 50) || "healthy",
      weight_kg: weight,
      birth_date: birthDate || null,
      origin: text(data.origin, 50) || "propio",
      vaccination_status: text(data.vaccinationStatus, 50) || "pendiente",
      reproductive_status: text(data.reproductiveStatus, 50),
      notes: text(data.notes, 2000),
    });
  });

  if (errors.length > 0) {
    return NextResponse.json({ error: "Hay filas que necesitan corrección.", rowErrors: errors.slice(0, 20) }, { status: 400 });
  }

  const importedTags = new Set(inserts.map((row) => normalizedEarTag(row.ear_tag)).filter((tag): tag is string => Boolean(tag)));
  if (importedTags.size > 0) {
    const { data: existing, error: existingError } = await db
      .from("cattle")
      .select("ear_tag")
      .eq("farm_id", result.farmId)
      .not("ear_tag", "is", null);
    if (existingError) return databaseFailure("cattle import ear tag lookup", existingError);
    const existingTags = new Set((existing || []).map((row) => normalizedEarTag(row.ear_tag)).filter((tag): tag is string => Boolean(tag)));
    const conflicts = inserts
      .map((row, index) => ({ tag: normalizedEarTag(row.ear_tag), line: index + 2 }))
      .filter((row) => row.tag && existingTags.has(row.tag));
    if (conflicts.length > 0) {
      return NextResponse.json({
        error: "Hay caravanas que ya están asignadas en este campo.",
        rowErrors: conflicts.slice(0, 20).map((row) => `Fila ${row.line}: la caravana ya existe en este campo.`),
      }, { status: 409 });
    }
  }

  const { data, error } = await db.from("cattle").insert(inserts).select("id");
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "Una caravana ya está asignada a otro registro de este campo." }, { status: 409 });
    }
    return databaseFailure("cattle import", error);
  }
  return NextResponse.json({ imported: data?.length || 0 });
}
