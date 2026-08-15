import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { farmRelationError, farmSectionError, requireFarm, validateFarmRelations, validateFarmSectionConsistency } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { isValidDateOnly } from "@/lib/date";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { parseIdempotencyKey } from "@/lib/idempotency";
import { splitPage } from "@/lib/pagination";

const MAX_MOVEMENT_RESPONSE = 100;

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const itemId = req.nextUrl.searchParams.get("itemId");

  let query = db
    .from("inventory_movements")
    .select("*, inventory_items(name, unit), sections(name), crops(crop_type), cattle(category, breed, count)", { count: "exact" })
    .eq("farm_id", result.farmId)
    .order("created_at", { ascending: false })
    .limit(MAX_MOVEMENT_RESPONSE + 1);

  if (req.nextUrl.searchParams.has("itemId")) {
    if (!itemId?.trim()) return NextResponse.json({ error: "itemId inválido" }, { status: 400 });
    query = query.eq("item_id", itemId);
  }

  const queryResult = await withTimeout(query, SUPABASE_READ_TIMEOUT_MS, null);
  if (!queryResult) {
    return NextResponse.json({ error: "El historial de inventario tardó demasiado. Intentá nuevamente." }, { status: 504 });
  }
  const { data, count, error } = queryResult;

  if (error) return databaseFailure("inventory movements GET", error);
  const page = splitPage(data || [], MAX_MOVEMENT_RESPONSE);
  const normalized = page.items.map((row) => ({
    ...row,
    inventory_items: Array.isArray(row.inventory_items) ? (row.inventory_items[0] || null) : row.inventory_items,
    sections: Array.isArray(row.sections) ? (row.sections[0] || null) : row.sections,
    crops: Array.isArray(row.crops) ? (row.crops[0] || null) : row.crops,
    cattle: Array.isArray(row.cattle) ? (row.cattle[0] || null) : row.cattle,
  }));
  const response = NextResponse.json(normalized);
  response.headers.set("X-CampoAI-Movements-Limit", String(MAX_MOVEMENT_RESPONSE));
  if (page.hasMore || (count ?? 0) > MAX_MOVEMENT_RESPONSE) {
    response.headers.set("X-CampoAI-Movements-Truncated", "true");
  }
  return response;
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (idempotencyKey === false) {
    return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });
  }
  if (typeof body.itemId !== "string" || !body.itemId.trim()) {
    return NextResponse.json({ error: "itemId requerido" }, { status: 400 });
  }
  const db = getSupabaseAdmin();
  const movementTypes = new Set(["compra", "uso", "ajuste", "pérdida"]);
  const currencies = new Set(["USD", "UYU", "ARS"]);
  const quantity = Number(body.quantity);
  const unitCost = body.unitCost == null || body.unitCost === "" ? null : Number(body.unitCost);

  if (!movementTypes.has(body.type)) {
    return NextResponse.json({ error: "Tipo de movimiento inválido" }, { status: 400 });
  }
  if (!Number.isFinite(quantity) || quantity === 0) {
    return NextResponse.json({ error: "La cantidad debe ser un número distinto de cero" }, { status: 400 });
  }
  if (body.type === "compra" && quantity < 0) {
    return NextResponse.json({ error: "Una compra debe sumar stock" }, { status: 400 });
  }
  if ((body.type === "uso" || body.type === "pérdida") && quantity > 0) {
    return NextResponse.json({ error: "El uso o la pérdida deben descontar stock" }, { status: 400 });
  }
  if (unitCost !== null && (!Number.isFinite(unitCost) || unitCost < 0)) {
    return NextResponse.json({ error: "Costo unitario inválido" }, { status: 400 });
  }
  if (body.currency != null && !currencies.has(String(body.currency))) {
    return NextResponse.json({ error: "Moneda inválida" }, { status: 400 });
  }
  if (body.date && !isValidDateOnly(body.date)) {
    return NextResponse.json({ error: "Fecha inválida" }, { status: 400 });
  }

  if (idempotencyKey) {
    const existingLookup = await withTimeout(
      db
        .from("inventory_movements")
        .select("*, inventory_items(name, unit)")
        .eq("farm_id", result.farmId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!existingLookup) return NextResponse.json({ error: "Supabase tardó demasiado al verificar el reintento. Intentá nuevamente.", code: "inventory_idempotency_lookup_timeout" }, { status: 504 });
    const { data: existing, error: existingError } = existingLookup;
    // An older schema may not have the optional key column yet; the insert
    // below will return the actionable migration response in that case.
    if (existingError && !["PGRST204", "PGRST205"].includes(existingError.code || "")) {
      return databaseFailure("inventory movement idempotency lookup", existingError);
    }
    if (existing) return NextResponse.json(existing);
  }

  // The item must belong to the caller's farm for EVERY movement type — the
  // stock-update trigger fires on any insert, so an unchecked itemId would let
  // one farm mutate another farm's stock.
  const itemLookup = await withTimeout(
    db
      .from("inventory_items")
      .select("current_stock, name, currency")
      .eq("id", body.itemId)
      .eq("farm_id", result.farmId)
      .single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!itemLookup) return NextResponse.json({ error: "Supabase tardó demasiado al verificar el insumo. Intentá nuevamente." }, { status: 504 });
  const { data: item, error: itemError } = itemLookup;

  if (itemError && itemError.code !== "PGRST116") return databaseFailure("inventory movement item lookup", itemError);
  if (!item) {
    return NextResponse.json({ error: "Item no encontrado" }, { status: 404 });
  }

  // Every optional relation must also belong to this farm. The API uses the
  // service role, so the database cannot enforce this tenant boundary for us.
  const relationCheck = await validateFarmRelations(result.farmId, [
    { table: "sections", id: body.sectionId },
    { table: "crops", id: body.cropId },
    { table: "cattle", id: body.cattleId },
  ]);
  if (!relationCheck.ok) return farmRelationError(relationCheck);

  const sectionValidation = await validateFarmSectionConsistency(result.farmId, body.sectionId, [
    { table: "crops", id: body.cropId, label: "el cultivo" },
    { table: "cattle", id: body.cattleId, label: "la hacienda" },
  ]);
  if (!sectionValidation.ok) return farmSectionError(sectionValidation);

  // Validate stock for uso/pérdida
  if (body.type === "uso" || body.type === "pérdida") {
    if (Number(item.current_stock) + quantity < 0) {
      return NextResponse.json({ error: "Stock insuficiente" }, { status: 400 });
    }
  }
  const purchaseCurrency = body.currency || item.currency || "USD";

  // Insert movement
  if (body.type === "compra" && unitCost !== null && unitCost > 0) {
    const { data: movementId, error: rpcError } = await db.rpc("record_inventory_purchase", {
      p_farm_id: result.farmId,
      p_item_id: body.itemId,
      p_quantity: quantity,
      p_unit_cost: unitCost,
      p_section_id: body.sectionId || null,
      p_crop_id: body.cropId || null,
      p_cattle_id: body.cattleId || null,
      p_date: body.date || new Date().toISOString().split("T")[0],
      p_notes: body.notes || null,
      p_currency: purchaseCurrency,
      ...(idempotencyKey ? { p_idempotency_key: idempotencyKey } : {}),
    });

    // PGRST202 means this deployment has not applied 010_integrity.sql. Do
    // not fall back to separate movement/financial inserts: that path can
    // update stock and then fail before creating the accounting entry.
    if (!rpcError && movementId) {
      const movementLookup = await withTimeout(
        db
          .from("inventory_movements")
          .select("*, inventory_items(name, unit)")
          .eq("id", movementId)
          .eq("farm_id", result.farmId)
          .single(),
        SUPABASE_READ_TIMEOUT_MS,
        null,
      );
      if (!movementLookup) return NextResponse.json({ error: "Compra registrada, pero Supabase tardó al confirmar el movimiento. Revisá el historial antes de reintentar.", code: "purchase_confirmation_timeout" }, { status: 504 });
      const { data: movement, error: movementError } = movementLookup;
      if (movementError) return NextResponse.json({ error: "Compra registrada pero no se pudo leer el movimiento." }, { status: 503 });
      return NextResponse.json(movement);
    }
    if (!rpcError) {
      return NextResponse.json({ error: "La compra no se registró porque Supabase no devolvió un movimiento transaccional.", code: "purchase_transaction_unavailable" }, { status: 503 });
    }
    if (rpcError.code === "PGRST202") {
      if (idempotencyKey) {
        return NextResponse.json({
          error: "Aplicá supabase/017_idempotency.sql para habilitar reintentos seguros de compras.",
          code: "idempotency_migration_required",
        }, { status: 503 });
      }
      return NextResponse.json({
        error: "Aplicá supabase/010_integrity.sql para registrar compras con costo sin dejar stock y finanzas desincronizados.",
        code: "purchase_migration_required",
      }, { status: 503 });
    }
    console.error("Transactional inventory purchase failed:", rpcError.message);
    return NextResponse.json({ error: "No se pudo registrar la compra de forma segura." }, { status: 503 });
  }

  const movementPayload = {
      farm_id: result.farmId,
      item_id: body.itemId,
      type: body.type,
      quantity,
      unit_cost: unitCost,
      currency: purchaseCurrency,
      section_id: body.sectionId || null,
      crop_id: body.cropId || null,
      cattle_id: body.cattleId || null,
      date: body.date || new Date().toISOString().split("T")[0],
      notes: body.notes || null,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
  };
  let movementResult = await db
    .from("inventory_movements")
    .insert(movementPayload)
    .select("*, inventory_items(name, unit)")
    .single();
  if (movementResult.error?.code === "PGRST204") {
    if (idempotencyKey) {
      return NextResponse.json({
        error: "Aplicá supabase/017_idempotency.sql para habilitar reintentos seguros de movimientos.",
        code: "idempotency_migration_required",
      }, { status: 503 });
    }
    const { currency: _currency, ...legacyPayload } = movementPayload;
    void _currency;
    movementResult = await db
      .from("inventory_movements")
      .insert(legacyPayload)
      .select("*, inventory_items(name, unit)")
      .single();
  }
  const { data: movement, error } = movementResult;

  if (error?.code === "23505" && idempotencyKey) {
    const existingLookup = await withTimeout(
      db
        .from("inventory_movements")
        .select("*, inventory_items(name, unit)")
        .eq("farm_id", result.farmId)
        .eq("idempotency_key", idempotencyKey)
        .single(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!existingLookup) return NextResponse.json({ error: "Supabase tardó demasiado al resolver el reintento. Intentá nuevamente.", code: "inventory_idempotency_lookup_timeout" }, { status: 504 });
    const { data: existing, error: existingError } = existingLookup;
    if (existingError) return databaseFailure("inventory movement idempotency lookup", existingError);
    if (existing) return NextResponse.json(existing);
    return NextResponse.json({ error: "No se pudo resolver el reintento del movimiento." }, { status: 503 });
  }
  if (error) return databaseFailure("inventory movements POST", error);

  return NextResponse.json(movement);
}
