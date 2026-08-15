import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { parseLocalizedNumber } from "@/lib/number";
import { parseIdempotencyKey } from "@/lib/idempotency";
import { isCompleteImportBatch } from "@/lib/import-idempotency";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";

const MAX_IMPORT_ROWS = 200;
const IMPORT_WRITE_TIMEOUT_MS = 20_000;
export const maxDuration = 30;
const CATEGORIES = new Set(["alimento", "semilla", "fertilizante", "agroquímico", "medicamento", "combustible", "otro"]);
const UNITS = new Set(["kg", "L", "dosis", "unidad"]);
const CURRENCIES = new Set(["USD", "UYU", "ARS"]);

function importIdempotencyMigrationRequired() {
  return NextResponse.json({
    error: "Aplicá la migración 020 para habilitar reintentos seguros de importaciones.",
    code: "import_idempotency_migration_required",
    migration: "supabase/020_import_idempotency.sql",
  }, { status: 503 });
}

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
  if (!Array.isArray(rows) || rows.length === 0) return NextResponse.json({ error: "El archivo no contiene filas para importar." }, { status: 400 });
  if (rows.length > MAX_IMPORT_ROWS) return NextResponse.json({ error: `La importación admite hasta ${MAX_IMPORT_ROWS} filas por vez.` }, { status: 413 });
  const importBatchKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (importBatchKey === false) return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });

  const errors: string[] = [];
  const inserts: Record<string, unknown>[] = [];
  rows.forEach((row, index) => {
    const line = index + 2;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      errors.push(`Fila ${line}: formato inválido.`);
      return;
    }
    const data = row as Record<string, unknown>;
    const name = text(data.name, 200);
    const category = text(data.category) || "otro";
    const unit = text(data.unit) || "unidad";
    const currency = text(data.currency) || "USD";
    const currentStock = data.currentStock == null || data.currentStock === "" ? 0 : parseLocalizedNumber(data.currentStock);
    const minStock = data.minStock == null || data.minStock === "" ? null : parseLocalizedNumber(data.minStock);
    const costPerUnit = data.costPerUnit == null || data.costPerUnit === "" ? null : parseLocalizedNumber(data.costPerUnit);

    if (!name) errors.push(`Fila ${line}: falta el nombre.`);
    if (!CATEGORIES.has(category)) errors.push(`Fila ${line}: categoría inválida.`);
    if (!UNITS.has(unit)) errors.push(`Fila ${line}: unidad inválida.`);
    if (!CURRENCIES.has(currency)) errors.push(`Fila ${line}: moneda inválida.`);
    if (!Number.isFinite(currentStock) || currentStock < 0) errors.push(`Fila ${line}: stock actual inválido.`);
    if (minStock !== null && (!Number.isFinite(minStock) || minStock < 0)) errors.push(`Fila ${line}: stock mínimo inválido.`);
    if (costPerUnit !== null && (!Number.isFinite(costPerUnit) || costPerUnit < 0)) errors.push(`Fila ${line}: costo unitario inválido.`);

    inserts.push({
      farm_id: result.farmId,
      name,
      category,
      unit,
      current_stock: currentStock,
      min_stock: minStock,
      cost_per_unit: costPerUnit,
      currency,
      notes: text(data.notes, 2000),
      ...(importBatchKey ? { import_batch_key: importBatchKey, import_row_index: index } : {}),
    });
  });

  if (errors.length > 0) return NextResponse.json({ error: "Hay filas que necesitan corrección.", rowErrors: errors.slice(0, 20) }, { status: 400 });

  const db = getSupabaseAdmin();
  if (importBatchKey) {
    const batchResult = await withTimeout(
      db.from("inventory_items").select("import_row_index").eq("farm_id", result.farmId).eq("import_batch_key", importBatchKey).limit(MAX_IMPORT_ROWS),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!batchResult) return NextResponse.json({ error: "Supabase tardó demasiado al verificar la importación. Intentá nuevamente." }, { status: 504 });
    if (batchResult.error?.code === "PGRST204") return importIdempotencyMigrationRequired();
    if (batchResult.error) return databaseFailure("inventory import batch lookup", batchResult.error);
    if (isCompleteImportBatch(batchResult.data || [], inserts.length)) {
      return NextResponse.json({ imported: inserts.length, replayed: true });
    }
    if ((batchResult.data || []).length > 0) {
      return NextResponse.json({ error: "La clave de reintento ya pertenece a otra importación.", code: "import_idempotency_key_reused" }, { status: 409 });
    }
  }
  let insertResult = await withTimeout(
    db.from("inventory_items").insert(inserts).select("id"),
    IMPORT_WRITE_TIMEOUT_MS,
    null,
  );
  if (!insertResult) {
    return NextResponse.json({ error: "Supabase tardó demasiado al guardar la importación. Revisá antes de reintentar.", code: "import_write_timeout" }, { status: 504 });
  }
  if (insertResult.error?.code === "PGRST204") {
    insertResult = await withTimeout(
      db.from("inventory_items").insert(inserts.map((insert) => {
        const { currency, ...legacy } = insert;
        void currency;
        return legacy;
      })).select("id"),
      IMPORT_WRITE_TIMEOUT_MS,
      null,
    );
    if (!insertResult) {
      return NextResponse.json({ error: "Supabase tardó demasiado al guardar la importación. Revisá antes de reintentar.", code: "import_write_timeout" }, { status: 504 });
    }
  }
  if (insertResult.error) {
    if (insertResult.error.code === "PGRST204" && importBatchKey) return importIdempotencyMigrationRequired();
    if (insertResult.error.code === "23505" && importBatchKey) {
      const replayResult = await withTimeout(
        db.from("inventory_items").select("import_row_index").eq("farm_id", result.farmId).eq("import_batch_key", importBatchKey).limit(MAX_IMPORT_ROWS),
        SUPABASE_READ_TIMEOUT_MS,
        null,
      );
      if (replayResult && !replayResult.error && isCompleteImportBatch(replayResult.data || [], inserts.length)) {
        return NextResponse.json({ imported: inserts.length, replayed: true });
      }
      if (replayResult && !replayResult.error && (replayResult.data || []).length > 0) {
        return NextResponse.json({ error: "La clave de reintento ya pertenece a otra importación.", code: "import_idempotency_key_reused" }, { status: 409 });
      }
    }
    return databaseFailure("inventory import", insertResult.error);
  }
  return NextResponse.json({ imported: insertResult.data?.length || 0 });
}
