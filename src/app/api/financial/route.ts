import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { farmRelationError, requireFarm, validateFarmRelations } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";

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

function invalidFinanceInput(body: Record<string, unknown>) {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) return "El importe debe ser un número mayor que cero.";
  if (!FINANCIAL_TYPES.has(String(body.type))) return "Tipo de movimiento inválido.";
  if (!FINANCIAL_CATEGORIES.has(String(body.category))) return "Categoría inválida.";
  if (!CURRENCIES.has(String(body.currency || "USD"))) return "Moneda inválida.";
  if (body.date && (typeof body.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(body.date))) return "Fecha inválida.";
  return null;
}

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const period = req.nextUrl.searchParams.get("period") || "30d";
  const dateFilter = getPeriodDate(period);

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("financial_transactions")
    .select("*, sections(name), crops(crop_type), cattle(category, breed)")
    .eq("farm_id", result.farmId)
    .gte("date", dateFilter)
    .order("date", { ascending: false })
    .limit(500);

  if (error) return databaseFailure("financial GET", error);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;

  const relationCheck = await validateFarmRelations(result.farmId, [
    { table: "sections", id: body.sectionId },
    { table: "crops", id: body.cropId },
    { table: "cattle", id: body.cattleId },
    { table: "inventory_movements", id: body.inventoryMovementId },
  ]);
  if (!relationCheck.ok) return farmRelationError(relationCheck);

  const inputError = invalidFinanceInput(body);
  if (inputError) return NextResponse.json({ error: inputError }, { status: 400 });

  const db = getSupabaseAdmin();
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
      notes: body.notes || null,
    })
    .select("*, sections(name)")
    .single();

  if (error) return databaseFailure("financial POST", error);
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const relationCheck = await validateFarmRelations(result.farmId, [
    { table: "sections", id: body.sectionId },
    { table: "crops", id: body.cropId },
    { table: "cattle", id: body.cattleId },
    { table: "inventory_movements", id: body.inventoryMovementId },
  ]);
  if (!relationCheck.ok) return farmRelationError(relationCheck);

  const inputError = invalidFinanceInput(body);
  if (inputError) return NextResponse.json({ error: inputError }, { status: 400 });

  const db = getSupabaseAdmin();
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
      notes: body.notes,
      updated_at: new Date().toISOString(),
    })
    .eq("id", body.id)
    .eq("farm_id", result.farmId)
    .select("*, sections(name)")
    .single();

  if (error) return databaseFailure("financial PUT", error);
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const { id } = parsed.data;
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("financial_transactions")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId);

  if (error) return databaseFailure("financial DELETE", error);
  return NextResponse.json({ ok: true });
}
