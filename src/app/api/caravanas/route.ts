import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { farmRelationError, requireFarm, validateFarmRelations } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { parseIdempotencyKey } from "@/lib/idempotency";
import { isUuid } from "@/lib/uuid";
import { toCSV } from "@/lib/csv";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  caravanaLoteLabel, caravanaSearchDigits, caravanasToSnigRows, isCaravanaCategory, isCaravanaSex, isCaravanaStatus,
  parseCaravanaSummary, validateImportPayloadRow, type CaravanaExportItem,
} from "@/lib/caravanas";
import {
  CARAVANA_SELECT, caravanasMigrationRequired, caravanasTimeout, isCaravanasSchemaMissing, sanitizeCaravanaQuery,
} from "@/lib/caravanas-server";

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;
const MAX_BULK_IDS = 500;
const EXPORT_CHUNK = 1000;
const MAX_EXPORT_ROWS = 20_000;
const EXPORT_TIMEOUT_MS = 20_000;
const MAX_LOTES_PER_SECTION_FILTER = 200;
const EXPORT_RATE_LIMIT = { capacity: 3, refillPerSec: 1 / 60 };
export const maxDuration = 30;

type Db = ReturnType<typeof getSupabaseAdmin>;

function tagConflict() {
  return NextResponse.json(
    { error: "Esa caravana ya está registrada en este campo.", code: "caravana_already_registered" },
    { status: 409 },
  );
}

/** Bulk UPDATE/DELETE lock rows in scan order; an import locks them in tag order. */
function lockConflict() {
  return NextResponse.json(
    { error: "Otra operación estaba modificando estas caravanas al mismo tiempo. Reintentá.", code: "caravanas_lock_conflict" },
    { status: 409 },
  );
}

function relationName(value: unknown): string | null {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row || typeof row !== "object" || !("name" in row)) return null;
  return typeof row.name === "string" ? row.name : null;
}

async function readDicose(db: Db, farmId: string): Promise<{ value: string | null; missing: boolean; failed: boolean }> {
  const result = await withTimeout(
    db.from("farms").select("dicose_number").eq("id", farmId).maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!result) return { value: null, missing: false, failed: true };
  if (result.error) return { value: null, missing: isCaravanasSchemaMissing(result.error), failed: !isCaravanasSchemaMissing(result.error) };
  const value = (result.data as { dicose_number?: unknown } | null)?.dicose_number;
  return { value: typeof value === "string" ? value : null, missing: false, failed: false };
}

/** Lote ids of a potrero, so a potrero filter also finds the animals of its lotes. */
async function loteIdsInSection(db: Db, farmId: string, sectionId: string) {
  return withTimeout(
    // Bounded so the id list stays a short URL; a potrero rarely holds more than a few lotes.
    db.from("cattle").select("id").eq("farm_id", farmId).eq("section_id", sectionId).limit(MAX_LOTES_PER_SECTION_FILTER),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
}

async function summary(db: Db, farmId: string) {
  const [summaryResult, dicose] = await Promise.all([
    withTimeout(db.rpc("animal_tag_summary", { p_farm_id: farmId }), SUPABASE_READ_TIMEOUT_MS, null),
    readDicose(db, farmId),
  ]);
  if (!summaryResult) return caravanasTimeout("leer las caravanas");
  if (summaryResult.error) {
    if (isCaravanasSchemaMissing(summaryResult.error)) return caravanasMigrationRequired();
    return databaseFailure("caravanas summary", summaryResult.error);
  }
  if (dicose.missing) return caravanasMigrationRequired();
  return NextResponse.json({ summary: parseCaravanaSummary(summaryResult.data), dicoseNumber: dicose.value });
}

async function exportCsv(db: Db, farmId: string) {
  // Same bucket as /api/export: a CSV of a large registry is up to 20 queries.
  const limit = await checkRateLimit(`export:${farmId}`, EXPORT_RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Se alcanzó el límite de exportaciones. Esperá un momento e intentá de nuevo." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }
  const dicose = await readDicose(db, farmId);
  if (dicose.missing) return caravanasMigrationRequired();
  const startedAt = Date.now();
  const items: CaravanaExportItem[] = [];
  let complete = false;
  for (let offset = 0; offset <= MAX_EXPORT_ROWS; offset += EXPORT_CHUNK) {
    const remainingMs = EXPORT_TIMEOUT_MS - (Date.now() - startedAt);
    if (remainingMs < 500) return caravanasTimeout("preparar la exportación");
    const chunk = await withTimeout(
      db.from("animal_tags").select(CARAVANA_SELECT).eq("farm_id", farmId)
        .order("tag_number").range(offset, offset + EXPORT_CHUNK - 1),
      Math.min(SUPABASE_READ_TIMEOUT_MS, remainingMs),
      null,
    );
    if (!chunk) return caravanasTimeout("preparar la exportación");
    if (chunk.error) {
      if (isCaravanasSchemaMissing(chunk.error)) return caravanasMigrationRequired();
      return databaseFailure("caravanas export", chunk.error);
    }
    const rows = (chunk.data || []) as Record<string, unknown>[];
    for (const row of rows) {
      const section = row.cattle_id ? relationName((Array.isArray(row.cattle) ? row.cattle[0] : row.cattle as Record<string, unknown> | null)?.sections) : relationName(row.sections);
      items.push({
        tag_number: String(row.tag_number),
        visual_tag: typeof row.visual_tag === "string" ? row.visual_tag : null,
        sex: typeof row.sex === "string" ? row.sex : null,
        breed: typeof row.breed === "string" ? row.breed : null,
        category: typeof row.category === "string" ? row.category : null,
        birth_date: typeof row.birth_date === "string" ? row.birth_date : null,
        status: typeof row.status === "string" ? row.status : "activo",
        loteLabel: row.cattle_id ? caravanaLoteLabel(row.cattle) : null,
        sectionName: section,
        notes: typeof row.notes === "string" ? row.notes : null,
      });
    }
    if (rows.length < EXPORT_CHUNK) { complete = true; break; }
  }
  if (!complete) {
    return NextResponse.json({ error: `La exportación supera el límite de ${MAX_EXPORT_ROWS.toLocaleString("es-UY")} caravanas.` }, { status: 413 });
  }
  const csv = items.length > 0
    ? toCSV(caravanasToSnigRows(items, dicose.value))
    : toCSV([{ "DICOSE": dicose.value || "", "Nro. Dispositivo": "", "Caravana visual": "", "Sexo": "", "Raza": "", "Fecha Nac.": "", "Categoría": "", "Estado": "", "Lote": "", "Potrero": "", "Notas": "" }]).split("\n")[0];
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="campoai-caravanas-snig.csv"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;
  const db = getSupabaseAdmin();
  const params = req.nextUrl.searchParams;
  if (params.get("view") === "summary") return summary(db, result.farmId);
  if (params.get("format") === "csv") return exportCsv(db, result.farmId);

  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Number.parseInt(params.get("pageSize") || "", 10) || DEFAULT_PAGE_SIZE));
  const page = Math.max(1, Number.parseInt(params.get("page") || "", 10) || 1);
  const status = params.get("status");
  const cattleId = params.get("cattleId");
  const sectionId = params.get("sectionId");
  if (status && status !== "all" && !isCaravanaStatus(status)) return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
  if (cattleId && cattleId !== "none" && !isUuid(cattleId)) return NextResponse.json({ error: "Lote inválido." }, { status: 400 });
  if (sectionId && sectionId !== "none" && !isUuid(sectionId)) return NextResponse.json({ error: "Potrero inválido." }, { status: 400 });

  // Filters as one PostgREST logic tree, applied to the page and (past the end) to the count.
  const conditions: string[] = [];
  if (status && status !== "all") conditions.push(`status.eq.${status}`);
  if (cattleId === "none") conditions.push("cattle_id.is.null");
  else if (cattleId) conditions.push(`cattle_id.eq.${cattleId}`);
  if (sectionId === "none") {
    conditions.push("cattle_id.is.null", "section_id.is.null");
  } else if (sectionId) {
    const lotes = await loteIdsInSection(db, result.farmId, sectionId);
    if (!lotes) return caravanasTimeout("filtrar por potrero");
    if (lotes.error) return databaseFailure("caravanas section lotes", lotes.error);
    const ids = (lotes.data || []).map((row) => row.id).filter(isUuid);
    conditions.push(ids.length > 0 ? `or(section_id.eq.${sectionId},cattle_id.in.(${ids.join(",")}))` : `section_id.eq.${sectionId}`);
  }
  const q = sanitizeCaravanaQuery(params.get("q"));
  if (q) {
    const digits = caravanaSearchDigits(q);
    const textFilters = [`breed.ilike.*${q}*`, `visual_tag.ilike.*${q}*`, `notes.ilike.*${q}*`];
    if (digits.length >= 3) textFilters.unshift(`tag_number.like.*${digits}*`);
    conditions.push(`or(${textFilters.join(",")})`);
  }
  const logic = conditions.length > 0 ? `and(${conditions.join(",")})` : null;
  const listQuery = db.from("animal_tags").select(CARAVANA_SELECT, { count: "exact" }).eq("farm_id", result.farmId);
  const listResult = await withTimeout(
    (logic ? listQuery.or(logic) : listQuery).order("tag_number").range((page - 1) * pageSize, page * pageSize - 1),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!listResult) return caravanasTimeout("leer las caravanas");
  if (listResult.error) {
    if (isCaravanasSchemaMissing(listResult.error)) return caravanasMigrationRequired();
    // A page past the end (rows were deleted meanwhile): report the filtered total so the page can step back.
    if (listResult.error.code === "PGRST103") {
      const countQuery = db.from("animal_tags").select("id", { count: "exact", head: true }).eq("farm_id", result.farmId);
      const countResult = await withTimeout(logic ? countQuery.or(logic) : countQuery, SUPABASE_READ_TIMEOUT_MS, null);
      return NextResponse.json({ items: [], total: countResult && !countResult.error ? countResult.count ?? 0 : 0, page, pageSize });
    }
    return databaseFailure("caravanas GET", listResult.error);
  }
  return NextResponse.json({ items: listResult.data || [], total: listResult.count ?? 0, page, pageSize });
}

export async function POST(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;
  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (idempotencyKey === false) return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });

  const validated = validateImportPayloadRow(body);
  if (!validated.ok) return NextResponse.json({ error: `Caravana inválida: ${validated.reason}.` }, { status: 400 });
  const cattleId = body.cattleId == null || body.cattleId === "" ? null : body.cattleId;
  const sectionId = cattleId ? null : body.sectionId == null || body.sectionId === "" ? null : body.sectionId;
  if ((cattleId !== null && !isUuid(cattleId)) || (sectionId !== null && !isUuid(sectionId))) {
    return NextResponse.json({ error: "Lote o potrero inválido." }, { status: 400 });
  }
  const relationCheck = await validateFarmRelations(result.farmId, [
    { table: "cattle", id: cattleId },
    { table: "sections", id: sectionId },
  ]);
  if (!relationCheck.ok) return farmRelationError(relationCheck);

  const db = getSupabaseAdmin();
  if (idempotencyKey) {
    const existing = await withTimeout(
      db.from("animal_tags").select(CARAVANA_SELECT).eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!existing) return caravanasTimeout("verificar el reintento");
    if (existing.error) {
      if (isCaravanasSchemaMissing(existing.error)) return caravanasMigrationRequired();
      return databaseFailure("caravanas idempotency lookup", existing.error);
    }
    if (existing.data) return NextResponse.json(existing.data);
  }

  const insert = await withTimeout(
    db.from("animal_tags").insert({
      farm_id: result.farmId,
      ...validated.row,
      status: validated.row.status || "activo",
      cattle_id: cattleId,
      section_id: sectionId,
      source: "manual",
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    }).select(CARAVANA_SELECT).single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!insert) return caravanasTimeout("registrar la caravana");
  if (insert.error) {
    if (isCaravanasSchemaMissing(insert.error)) return caravanasMigrationRequired();
    if (insert.error.code === "23505") {
      if (idempotencyKey) {
        const replay = await withTimeout(
          db.from("animal_tags").select(CARAVANA_SELECT).eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
          SUPABASE_READ_TIMEOUT_MS,
          null,
        );
        if (replay && !replay.error && replay.data) return NextResponse.json(replay.data);
      }
      return tagConflict();
    }
    if (insert.error.code === "23503") return NextResponse.json({ error: "Referencia no válida para este campo." }, { status: 400 });
    if (insert.error.code === "40P01") return lockConflict();
    return databaseFailure("caravanas POST", insert.error);
  }
  return NextResponse.json(insert.data);
}

function parseIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_BULK_IDS) return null;
  if (!value.every(isUuid)) return null;
  return [...new Set(value as string[])];
}

/**
 * Bulk change of the selected caravanas: lote/potrero assignment and/or
 * status. With exactly one id it also edits the animal's own fields.
 *   cattleId: uuid → into that lote (its potrero is the lote's); null → out of any lote.
 *   sectionId (only without a lote): uuid → that potrero; null → no potrero.
 */
export async function PATCH(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;
  const parsed = await parseJsonBody(req, 64_000);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const ids = parseIds(body.ids);
  if (!ids) return NextResponse.json({ error: `Elegí entre 1 y ${MAX_BULK_IDS} caravanas.` }, { status: 400 });

  const update: Record<string, unknown> = {};
  if ("cattleId" in body || "sectionId" in body) {
    const cattleId = body.cattleId == null || body.cattleId === "" ? null : body.cattleId;
    const sectionId = cattleId ? null : body.sectionId == null || body.sectionId === "" ? null : body.sectionId;
    if ((cattleId !== null && !isUuid(cattleId)) || (sectionId !== null && !isUuid(sectionId))) {
      return NextResponse.json({ error: "Lote o potrero inválido." }, { status: 400 });
    }
    const relationCheck = await validateFarmRelations(result.farmId, [
      { table: "cattle", id: cattleId },
      { table: "sections", id: sectionId },
    ]);
    if (!relationCheck.ok) return farmRelationError(relationCheck);
    update.cattle_id = cattleId;
    update.section_id = sectionId;
  }
  if ("status" in body) {
    if (!isCaravanaStatus(body.status)) return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
    update.status = body.status;
  }
  const fieldKeys = ["sex", "breed", "category", "birthDate", "notes", "visualTag"].filter((key) => key in body);
  if (fieldKeys.length > 0) {
    if (ids.length !== 1) return NextResponse.json({ error: "Los datos del animal se editan de a una caravana." }, { status: 400 });
    if ("sex" in body) {
      if (body.sex != null && body.sex !== "" && !isCaravanaSex(body.sex)) return NextResponse.json({ error: "Sexo inválido." }, { status: 400 });
      update.sex = body.sex || null;
    }
    if ("category" in body) {
      if (body.category != null && body.category !== "" && !isCaravanaCategory(body.category)) return NextResponse.json({ error: "Categoría inválida." }, { status: 400 });
      update.category = body.category || null;
    }
    // Reuse the import validation for the free-text and date fields.
    const fieldCheck = validateImportPayloadRow({
      tagNumber: "858000000000000",
      birthDate: body.birthDate,
      breed: body.breed,
      notes: body.notes,
      visualTag: body.visualTag,
    });
    if (!fieldCheck.ok) return NextResponse.json({ error: `Dato inválido: ${fieldCheck.reason}.` }, { status: 400 });
    if ("birthDate" in body) update.birth_date = fieldCheck.row.birth_date;
    if ("breed" in body) update.breed = fieldCheck.row.breed;
    if ("notes" in body) update.notes = fieldCheck.row.notes;
    if ("visualTag" in body) update.visual_tag = fieldCheck.row.visual_tag;
  }
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "No hay cambios para guardar." }, { status: 400 });

  const db = getSupabaseAdmin();
  const updateResult = await withTimeout(
    db.from("animal_tags").update(update).eq("farm_id", result.farmId).in("id", ids).select("id"),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!updateResult) return caravanasTimeout("actualizar las caravanas");
  if (updateResult.error) {
    if (isCaravanasSchemaMissing(updateResult.error)) return caravanasMigrationRequired();
    if (updateResult.error.code === "23503") return NextResponse.json({ error: "Referencia no válida para este campo." }, { status: 400 });
    if (updateResult.error.code === "40P01") return lockConflict();
    return databaseFailure("caravanas PATCH", updateResult.error);
  }
  const updated = updateResult.data?.length || 0;
  if (updated === 0) return NextResponse.json({ error: "No se encontraron las caravanas." }, { status: 404 });
  return NextResponse.json({ updated });
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;
  const parsed = await parseJsonBody(req, 64_000);
  if ("error" in parsed) return parsed.error;
  const ids = parseIds(parsed.data.ids);
  if (!ids) return NextResponse.json({ error: `Elegí entre 1 y ${MAX_BULK_IDS} caravanas.` }, { status: 400 });
  const db = getSupabaseAdmin();
  const deleteResult = await withTimeout(
    db.from("animal_tags").delete().eq("farm_id", result.farmId).in("id", ids).select("id"),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!deleteResult) return caravanasTimeout("eliminar las caravanas");
  if (deleteResult.error) {
    if (isCaravanasSchemaMissing(deleteResult.error)) return caravanasMigrationRequired();
    if (deleteResult.error.code === "40P01") return lockConflict();
    return databaseFailure("caravanas DELETE", deleteResult.error);
  }
  const deleted = deleteResult.data?.length || 0;
  if (deleted === 0) return NextResponse.json({ error: "No se encontraron las caravanas." }, { status: 404 });
  return NextResponse.json({ deleted });
}
