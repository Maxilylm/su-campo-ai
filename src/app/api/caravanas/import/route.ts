import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { farmRelationError, requireFarm, validateFarmRelations } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { parseIdempotencyKey } from "@/lib/idempotency";
import { checkRateLimit } from "@/lib/rate-limit";
import { withTimeout } from "@/lib/timeout";
import { isUuid } from "@/lib/uuid";
import { MAX_CARAVANA_IMPORT_ROWS, validateImportPayloadRow, type ValidatedImportRow } from "@/lib/caravanas";
import { caravanasMigrationRequired, isCaravanasSchemaMissing } from "@/lib/caravanas-server";

const IMPORT_WRITE_TIMEOUT_MS = 25_000;
export const maxDuration = 30;
const IMPORT_RATE_LIMIT = { capacity: 5, refillPerSec: 1 / 60 };
// ~5000 rows × ~250 bytes of JSON each, with room for notes.
const MAX_BODY_BYTES = 2_500_000;

/**
 * Bulk upsert of caravanas from a SNIG/DICOSE export (parsed in the browser).
 * Every row is re-validated here; the whole batch is written by
 * import_animal_tags() in one transaction. The Idempotency-Key is required:
 * a retry of the same file returns { replayed: true } without writing again.
 */
export async function POST(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const limit = await checkRateLimit(`import:${result.farmId}`, IMPORT_RATE_LIMIT);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Demasiadas importaciones seguidas. Esperá un momento e intentá de nuevo." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSec) } },
    );
  }

  const importBatchKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (!importBatchKey) return NextResponse.json({ error: "Falta una Idempotency-Key válida para importar." }, { status: 400 });

  const parsed = await parseJsonBody(req, MAX_BODY_BYTES);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const rows = body.rows;
  if (!Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json({ error: "El archivo no contiene caravanas para importar." }, { status: 400 });
  }
  if (rows.length > MAX_CARAVANA_IMPORT_ROWS) {
    return NextResponse.json({ error: `La importación admite hasta ${MAX_CARAVANA_IMPORT_ROWS} caravanas por vez.` }, { status: 413 });
  }
  const source = body.source === "excel" ? "excel" : "snig_import";
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

  const errors: string[] = [];
  const valid: ValidatedImportRow[] = [];
  const seen = new Map<string, number>();
  rows.forEach((row, index) => {
    const line = typeof row?.line === "number" && Number.isInteger(row.line) ? row.line : index + 2;
    const checked = validateImportPayloadRow(row);
    if (!checked.ok) {
      errors.push(`Fila ${line}: ${checked.reason}.`);
      return;
    }
    const previous = seen.get(checked.row.tag_number);
    if (previous) {
      errors.push(`Fila ${line}: la caravana también aparece en la fila ${previous}.`);
      return;
    }
    seen.set(checked.row.tag_number, line);
    valid.push(checked.row);
  });
  if (errors.length > 0) {
    return NextResponse.json({ error: "Hay filas que necesitan corrección.", rowErrors: errors.slice(0, 20) }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const rpcResult = await withTimeout(
    db.rpc("import_animal_tags", {
      p_farm_id: result.farmId,
      p_rows: valid,
      p_batch_key: importBatchKey,
      p_source: source,
      p_cattle_id: cattleId,
      p_section_id: sectionId,
    }),
    IMPORT_WRITE_TIMEOUT_MS,
    null,
  );
  if (!rpcResult) {
    return NextResponse.json({
      error: "Supabase tardó demasiado al guardar la importación. Reintentá con el mismo archivo: no se duplica.",
      code: "import_write_timeout",
    }, { status: 504 });
  }
  if (rpcResult.error) {
    if (isCaravanasSchemaMissing(rpcResult.error)) return caravanasMigrationRequired();
    if (rpcResult.error.code === "23503") return NextResponse.json({ error: "Referencia no válida para este campo." }, { status: 400 });
    if (rpcResult.error.code === "40P01") {
      return NextResponse.json({ error: "Otra operación modificó estas caravanas al mismo tiempo. Reintentá.", code: "import_conflict" }, { status: 409 });
    }
    return databaseFailure("caravanas import", rpcResult.error);
  }
  const data = (rpcResult.data || {}) as { inserted?: number; updated?: number; replayed?: boolean };
  return NextResponse.json({
    inserted: Number(data.inserted) || 0,
    updated: Number(data.updated) || 0,
    replayed: data.replayed === true,
    total: valid.length,
  });
}
