import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { splitPage } from "@/lib/pagination";
import { parseIdempotencyKey } from "@/lib/idempotency";

const MAX_INVENTORY_ITEMS = 1000;

function inventoryWriteTimeout(action: string) {
  return NextResponse.json(
    { error: `Supabase tardó demasiado al ${action}. Intentá nuevamente.`, code: "inventory_write_timeout" },
    { status: 504 },
  );
}

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const queryResult = await withTimeout(db
    .from("inventory_items")
    .select("*", { count: "exact" })
    .eq("farm_id", result.farmId)
    .order("category")
    .order("name")
    .limit(MAX_INVENTORY_ITEMS), SUPABASE_READ_TIMEOUT_MS, null);
  if (!queryResult) return NextResponse.json({ error: "Inventario tardó demasiado. Intentá nuevamente." }, { status: 504 });
  const { data, count, error } = queryResult;

  if (error) return databaseFailure("inventory GET", error);
  const page = splitPage(data || [], MAX_INVENTORY_ITEMS);
  const response = NextResponse.json(page.items);
  response.headers.set("X-CampoAI-Inventory-Limit", String(MAX_INVENTORY_ITEMS));
  if (page.hasMore || (count ?? 0) > MAX_INVENTORY_ITEMS) {
    response.headers.set("X-CampoAI-Inventory-Truncated", "true");
  }
  return response;
}

export async function POST(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (idempotencyKey === false) return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });
  const categories = new Set(["alimento", "semilla", "fertilizante", "agroquímico", "medicamento", "combustible", "otro"]);
  const units = new Set(["kg", "L", "dosis", "unidad"]);
  const currencies = new Set(["USD", "UYU", "ARS"]);
  const currentStock = body.currentStock == null || body.currentStock === "" ? 0 : Number(body.currentStock);
  const minStock = body.minStock == null || body.minStock === "" ? null : Number(body.minStock);
  const costPerUnit = body.costPerUnit == null || body.costPerUnit === "" ? null : Number(body.costPerUnit);
  if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (!categories.has(String(body.category)) || !units.has(String(body.unit))) return NextResponse.json({ error: "category or unit inválido" }, { status: 400 });
  if (body.currency != null && !currencies.has(String(body.currency))) return NextResponse.json({ error: "currency inválida" }, { status: 400 });
  if (!Number.isFinite(currentStock) || currentStock < 0 || (minStock !== null && (!Number.isFinite(minStock) || minStock < 0)) || (costPerUnit !== null && (!Number.isFinite(costPerUnit) || costPerUnit < 0))) return NextResponse.json({ error: "numeric inventory value inválido" }, { status: 400 });
  const db = getSupabaseAdmin();
  let idempotencyColumnAvailable = Boolean(idempotencyKey);
  if (idempotencyKey) {
    const existingLookup = await withTimeout(
      db.from("inventory_items").select("*").eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!existingLookup) return inventoryWriteTimeout("verificar el reintento del insumo");
    if (existingLookup.error && !["PGRST204", "PGRST205"].includes(existingLookup.error.code || "")) {
      return databaseFailure("inventory idempotency lookup", existingLookup.error);
    }
    idempotencyColumnAvailable = !existingLookup.error;
    if (existingLookup.data) return NextResponse.json(existingLookup.data);
  }
  const insertPayload = {
      farm_id: result.farmId,
      name: body.name,
      category: body.category,
      unit: body.unit,
      current_stock: currentStock,
      min_stock: minStock,
      cost_per_unit: costPerUnit,
      currency: body.currency || "USD",
      notes: body.notes || null,
      ...(idempotencyKey && idempotencyColumnAvailable ? { idempotency_key: idempotencyKey } : {}),
  };
  let insertResult = await withTimeout(
    db.from("inventory_items").insert(insertPayload).select().single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!insertResult) return inventoryWriteTimeout("crear el insumo");
  if (insertResult.error?.code === "PGRST204") {
    const { currency: _currency, ...legacyPayload } = insertPayload;
    void _currency;
    insertResult = await withTimeout(
      db.from("inventory_items").insert(legacyPayload).select().single(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!insertResult) return inventoryWriteTimeout("crear el insumo");
  }
  if (insertResult.error?.code === "PGRST204" && idempotencyKey && idempotencyColumnAvailable) {
    const { idempotency_key: _idempotencyKey, ...legacyWithoutIdempotency } = insertPayload;
    void _idempotencyKey;
    insertResult = await withTimeout(
      db.from("inventory_items").insert(legacyWithoutIdempotency).select().single(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!insertResult) return inventoryWriteTimeout("crear el insumo");
  }
  const { data, error } = insertResult;

  if (error?.code === "23505" && idempotencyKey && idempotencyColumnAvailable) {
    const replay = await withTimeout(
      db.from("inventory_items").select("*").eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!replay) return inventoryWriteTimeout("resolver el reintento del insumo");
    if (replay.error) return databaseFailure("inventory idempotency replay", replay.error);
    if (replay.data) return NextResponse.json(replay.data);
  }
  if (error) return databaseFailure("inventory POST", error);
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const minStock = body.minStock == null || body.minStock === "" ? null : Number(body.minStock);
  if (typeof body.name !== "string" || !body.name.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (body.currency != null && !["USD", "UYU", "ARS"].includes(String(body.currency))) return NextResponse.json({ error: "currency inválida" }, { status: 400 });
  if (body.category != null && !["alimento", "semilla", "fertilizante", "agroquímico", "medicamento", "combustible", "otro"].includes(String(body.category))) return NextResponse.json({ error: "category inválida" }, { status: 400 });
  if (body.unit != null && !["kg", "L", "dosis", "unidad"].includes(String(body.unit))) return NextResponse.json({ error: "unit inválida" }, { status: 400 });
  if (minStock !== null && (!Number.isFinite(minStock) || minStock < 0)) return NextResponse.json({ error: "minStock inválido" }, { status: 400 });
  const db = getSupabaseAdmin();
  const updatePayload = {
      name: body.name,
      category: body.category,
      unit: body.unit,
      min_stock: minStock,
      ...(body.currency ? { currency: body.currency } : {}),
      notes: body.notes,
  };
  let updateResult = await withTimeout(
    db.from("inventory_items").update(updatePayload).eq("id", body.id).eq("farm_id", result.farmId).select().single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!updateResult) return inventoryWriteTimeout("actualizar el insumo");
  if (updateResult.error?.code === "PGRST204") {
    const { currency: _currency, ...legacyPayload } = updatePayload;
    void _currency;
    updateResult = await withTimeout(
      db.from("inventory_items").update(legacyPayload).eq("id", body.id).eq("farm_id", result.farmId).select().single(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!updateResult) return inventoryWriteTimeout("actualizar el insumo");
  }
  const { data, error } = updateResult;

  if (error) return databaseFailure("inventory PUT", error);
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const { id } = parsed.data;
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const db = getSupabaseAdmin();
  const movementLookup = await withTimeout(
    db
      .from("inventory_movements")
      .select("id")
      .eq("item_id", id)
      .eq("farm_id", result.farmId)
      .limit(1)
      .maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!movementLookup) {
    return NextResponse.json({ error: "Supabase tardó demasiado al revisar el historial del insumo. Intentá nuevamente.", code: "inventory_history_lookup_timeout" }, { status: 504 });
  }
  const { data: existingMovement, error: movementLookupError } = movementLookup;
  if (movementLookupError) return databaseFailure("inventory DELETE history lookup", movementLookupError);
  if (existingMovement) {
    return NextResponse.json({
      error: "No se puede eliminar un insumo que ya tiene movimientos. Conservá el historial o dejá de usarlo.",
      code: "inventory_item_has_history",
    }, { status: 409 });
  }
  const deleteResult = await withTimeout(
    db
      .from("inventory_items")
      .delete()
      .eq("id", id)
      .eq("farm_id", result.farmId)
      .select("id")
      .maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!deleteResult) return inventoryWriteTimeout("eliminar el insumo");
  const { data: deleted, error } = deleteResult;

  if (error) return databaseFailure("inventory DELETE", error);
  if (!deleted) return NextResponse.json({ error: "Item no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
