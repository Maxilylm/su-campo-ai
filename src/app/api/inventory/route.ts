import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";

const MAX_INVENTORY_ITEMS = 1000;

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const queryResult = await withTimeout(db
    .from("inventory_items")
    .select("*")
    .eq("farm_id", result.farmId)
    .order("category")
    .order("name")
    .limit(MAX_INVENTORY_ITEMS), SUPABASE_READ_TIMEOUT_MS, null);
  if (!queryResult) return NextResponse.json({ error: "Inventario tardó demasiado. Intentá nuevamente." }, { status: 504 });
  const { data, error } = queryResult;

  if (error) return databaseFailure("inventory GET", error);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
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
  };
  let insertResult = await db.from("inventory_items").insert(insertPayload).select().single();
  if (insertResult.error?.code === "PGRST204") {
    const { currency: _currency, ...legacyPayload } = insertPayload;
    void _currency;
    insertResult = await db.from("inventory_items").insert(legacyPayload).select().single();
  }
  const { data, error } = insertResult;

  if (error) return databaseFailure("inventory POST", error);
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
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
  let updateResult = await db.from("inventory_items").update(updatePayload).eq("id", body.id).eq("farm_id", result.farmId).select().single();
  if (updateResult.error?.code === "PGRST204") {
    const { currency: _currency, ...legacyPayload } = updatePayload;
    void _currency;
    updateResult = await db.from("inventory_items").update(legacyPayload).eq("id", body.id).eq("farm_id", result.farmId).select().single();
  }
  const { data, error } = updateResult;

  if (error) return databaseFailure("inventory PUT", error);
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
  const { data: existingMovement, error: movementLookupError } = await db
    .from("inventory_movements")
    .select("id")
    .eq("item_id", id)
    .eq("farm_id", result.farmId)
    .limit(1)
    .maybeSingle();
  if (movementLookupError) return databaseFailure("inventory DELETE history lookup", movementLookupError);
  if (existingMovement) {
    return NextResponse.json({
      error: "No se puede eliminar un insumo que ya tiene movimientos. Conservá el historial o dejá de usarlo.",
      code: "inventory_item_has_history",
    }, { status: 409 });
  }
  const { data: deleted, error } = await db
    .from("inventory_items")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId)
    .select("id")
    .maybeSingle();

  if (error) return databaseFailure("inventory DELETE", error);
  if (!deleted) return NextResponse.json({ error: "Item no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
