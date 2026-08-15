import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { farmRelationError, farmSectionError, requireFarm, validateFarmRelations, validateFarmSectionConsistency } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { isValidDateOnly } from "@/lib/date";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { parseIdempotencyKey } from "@/lib/idempotency";

function getPeriodDate(period: string): string {
  const now = new Date();
  switch (period) {
    case "7d":
      now.setDate(now.getDate() - 7);
      break;
    case "90d":
      now.setDate(now.getDate() - 90);
      break;
    case "year":
      now.setFullYear(now.getFullYear() - 1);
      break;
    default: // 30d
      now.setDate(now.getDate() - 30);
  }
  // `date` is a SQL DATE column. Sending a timestamp here makes the boundary
  // depend on timezone casting and can silently omit the first day.
  return now.toISOString().slice(0, 10);
}

const FINANCIAL_TYPES = new Set(["ingreso", "egreso"]);
const FINANCIAL_CATEGORIES = new Set([
  "venta_ganado", "venta_cosecha", "compra_insumo", "servicio", "mano_obra",
  "transporte", "veterinario", "maquinaria", "otro",
]);
const CURRENCIES = new Set(["USD", "UYU", "ARS"]);
const FINANCIAL_SELECT = "*, sections(name)";

function financialIdempotencyMigrationRequired() {
  return NextResponse.json({
    error: "Aplicá la migración 023 para habilitar reintentos seguros de movimientos financieros.",
    code: "financial_idempotency_migration_required",
    migration: "supabase/023_financial_idempotency.sql",
  }, { status: 503 });
}

const linkedInventoryConflict = () => NextResponse.json({
  error: "Este movimiento de inventario ya tiene un asiento financiero asociado.",
  code: "inventory_movement_already_linked",
}, { status: 409 });

function isUniqueViolation(error: { code?: string } | null) {
  return error?.code === "23505";
}

function financialLookupTimeout(action: string) {
  return NextResponse.json(
    { error: `Supabase tardó demasiado al ${action}. Intentá nuevamente.`, code: "financial_lookup_timeout" },
    { status: 504 },
  );
}

function invalidFinanceInput(body: Record<string, unknown>) {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return "El importe debe ser un número mayor que cero.";
  if (!FINANCIAL_TYPES.has(String(body.type))) return "Tipo de movimiento inválido.";
  if (!FINANCIAL_CATEGORIES.has(String(body.category))) return "Categoría inválida.";
  if (!CURRENCIES.has(String(body.currency || "USD"))) return "Moneda inválida.";
  if (body.date && !isValidDateOnly(body.date)) return "Fecha inválida.";
  return null;
}

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const period = req.nextUrl.searchParams.get("period") || "30d";
  const transactionId = req.nextUrl.searchParams.get("transactionId");

  const db = getSupabaseAdmin();
  let query = db
    .from("financial_transactions")
    .select("*, sections(name), crops(crop_type), cattle(category, breed)")
    .eq("farm_id", result.farmId)
    .order("date", { ascending: false })
    .limit(500);
  if (transactionId) {
    query = query.eq("id", transactionId);
  } else {
    query = query.gte("date", getPeriodDate(period));
  }

  const queryResult = await withTimeout(query, SUPABASE_READ_TIMEOUT_MS, null);
  if (!queryResult) return NextResponse.json({ error: "Finanzas tardó demasiado. Intentá nuevamente." }, { status: 504 });
  const { data, error } = queryResult;

  if (error) return databaseFailure("financial GET", error);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (idempotencyKey === false) return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });

  const relationCheck = await validateFarmRelations(result.farmId, [
    { table: "sections", id: body.sectionId },
    { table: "crops", id: body.cropId },
    { table: "cattle", id: body.cattleId },
    { table: "inventory_movements", id: body.inventoryMovementId },
  ]);
  if (!relationCheck.ok) return farmRelationError(relationCheck);
  const sectionValidation = await validateFarmSectionConsistency(result.farmId, body.sectionId, [
    { table: "crops", id: body.cropId, label: "el cultivo" },
    { table: "cattle", id: body.cattleId, label: "la hacienda" },
  ]);
  if (!sectionValidation.ok) return farmSectionError(sectionValidation);

  const inputError = invalidFinanceInput(body);
  if (inputError) return NextResponse.json({ error: inputError }, { status: 400 });

  const db = getSupabaseAdmin();
  if (idempotencyKey) {
    const existingLookup = await withTimeout(
      db
        .from("financial_transactions")
        .select(FINANCIAL_SELECT)
        .eq("farm_id", result.farmId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!existingLookup) return financialLookupTimeout("verificar el reintento financiero");
    const { data: existing, error: existingError } = existingLookup;
    // Older databases may not have migration 023; the insert below returns a
    // precise migration response in that case.
    if (existingError && !["PGRST204", "PGRST205"].includes(existingError.code || "")) {
      return databaseFailure("financial idempotency lookup", existingError);
    }
    if (existing) return NextResponse.json(existing);
  }
  if (typeof body.inventoryMovementId === "string" && body.inventoryMovementId) {
    const linkLookup = await withTimeout(
      db
        .from("financial_transactions")
        .select("id")
        .eq("farm_id", result.farmId)
        .eq("inventory_movement_id", body.inventoryMovementId)
        .maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!linkLookup) return financialLookupTimeout("verificar el vínculo de inventario");
    const { data: existingLink, error: linkLookupError } = linkLookup;
    if (linkLookupError) return databaseFailure("financial POST link lookup", linkLookupError);
    if (existingLink) return linkedInventoryConflict();
  }
  const { data, error } = await db
    .from("financial_transactions")
    .insert({
      farm_id: result.farmId,
      type: body.type,
      category: body.category,
      description: body.description || null,
      amount: Number(body.amount),
      currency: body.currency || "USD",
      date: body.date || new Date().toISOString().split("T")[0],
      section_id: body.sectionId || null,
      crop_id: body.cropId || null,
      cattle_id: body.cattleId || null,
      inventory_movement_id: body.inventoryMovementId || null,
      notes: body.notes || null,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    })
    .select(FINANCIAL_SELECT)
    .single();

  if (error?.code === "PGRST204" && idempotencyKey) return financialIdempotencyMigrationRequired();
  if (error?.code === "23505" && idempotencyKey) {
    const replayLookup = await withTimeout(
      db
        .from("financial_transactions")
        .select(FINANCIAL_SELECT)
        .eq("farm_id", result.farmId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!replayLookup) return financialLookupTimeout("resolver el reintento financiero");
    if (replayLookup.error && replayLookup.error.code !== "PGRST116") return databaseFailure("financial idempotency replay", replayLookup.error);
    if (replayLookup.data) return NextResponse.json(replayLookup.data);
  }
  if (error) return isUniqueViolation(error) ? linkedInventoryConflict() : databaseFailure("financial POST", error);
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const db = getSupabaseAdmin();
  const linkedLookup = await withTimeout(
    db
      .from("financial_transactions")
      .select("inventory_movement_id")
      .eq("id", body.id)
      .eq("farm_id", result.farmId)
      .maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!linkedLookup) return financialLookupTimeout("verificar el asiento financiero");
  const { data: linkedTransaction, error: linkedLookupError } = linkedLookup;
  if (linkedLookupError) return databaseFailure("financial PUT link lookup", linkedLookupError);
  if (linkedTransaction?.inventory_movement_id) {
    return NextResponse.json({
      error: "Este asiento pertenece a una compra de inventario. Corregí la compra desde Inventario usando un ajuste.",
      code: "linked_inventory_transaction",
    }, { status: 409 });
  }
  const relationCheck = await validateFarmRelations(result.farmId, [
    { table: "sections", id: body.sectionId },
    { table: "crops", id: body.cropId },
    { table: "cattle", id: body.cattleId },
    { table: "inventory_movements", id: body.inventoryMovementId },
  ]);
  if (!relationCheck.ok) return farmRelationError(relationCheck);
  const sectionValidation = await validateFarmSectionConsistency(result.farmId, body.sectionId, [
    { table: "crops", id: body.cropId, label: "el cultivo" },
    { table: "cattle", id: body.cattleId, label: "la hacienda" },
  ]);
  if (!sectionValidation.ok) return farmSectionError(sectionValidation);

  const inputError = invalidFinanceInput(body);
  if (inputError) return NextResponse.json({ error: inputError }, { status: 400 });

  if (typeof body.inventoryMovementId === "string" && body.inventoryMovementId) {
    const linkLookup = await withTimeout(
      db
        .from("financial_transactions")
        .select("id")
        .eq("farm_id", result.farmId)
        .eq("inventory_movement_id", body.inventoryMovementId)
        .neq("id", body.id)
        .maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!linkLookup) return financialLookupTimeout("verificar el vínculo de inventario");
    const { data: existingLink, error: linkLookupError } = linkLookup;
    if (linkLookupError) return databaseFailure("financial PUT link lookup", linkLookupError);
    if (existingLink) return linkedInventoryConflict();
  }

  const { data, error } = await db
    .from("financial_transactions")
    .update({
      type: body.type,
      category: body.category,
      description: body.description,
      amount: body.amount,
      currency: body.currency,
      date: body.date,
      section_id: body.sectionId,
      crop_id: body.cropId,
      cattle_id: body.cattleId,
      inventory_movement_id: body.inventoryMovementId || null,
      notes: body.notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.id)
    .eq("farm_id", result.farmId)
    .select("*, sections(name)")
    .single();

  if (error) return isUniqueViolation(error) ? linkedInventoryConflict() : databaseFailure("financial PUT", error);
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const { id } = parsed.data;
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const db = getSupabaseAdmin();
  const linkedLookup = await withTimeout(
    db
      .from("financial_transactions")
      .select("inventory_movement_id")
      .eq("id", id)
      .eq("farm_id", result.farmId)
      .maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!linkedLookup) return financialLookupTimeout("verificar el asiento financiero");
  const { data: linkedTransaction, error: linkedLookupError } = linkedLookup;
  if (linkedLookupError) return databaseFailure("financial DELETE link lookup", linkedLookupError);
  if (linkedTransaction?.inventory_movement_id) {
    return NextResponse.json({
      error: "Este asiento pertenece a una compra de inventario y no se puede eliminar por separado.",
      code: "linked_inventory_transaction",
    }, { status: 409 });
  }
  const { data: deleted, error } = await db
    .from("financial_transactions")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId)
    .select("id")
    .maybeSingle();

  if (error) return databaseFailure("financial DELETE", error);
  if (!deleted) return NextResponse.json({ error: "Transacción no encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
