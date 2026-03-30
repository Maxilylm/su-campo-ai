import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const itemId = req.nextUrl.searchParams.get("itemId");

  let query = db
    .from("inventory_movements")
    .select("*, inventory_items(name, unit), sections(name)")
    .eq("farm_id", result.farmId)
    .order("created_at", { ascending: false })
    .limit(100);

  if (itemId) {
    query = query.eq("item_id", itemId);
  }

  const { data, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();

  // Validate stock for uso/pérdida
  if (body.type === "uso" || body.type === "pérdida") {
    const { data: item } = await db
      .from("inventory_items")
      .select("current_stock, name")
      .eq("id", body.itemId)
      .eq("farm_id", result.farmId)
      .single();

    if (!item) {
      return NextResponse.json({ error: "Item no encontrado" }, { status: 404 });
    }

    if (Number(item.current_stock) + Number(body.quantity) < 0) {
      return NextResponse.json({ error: "Stock insuficiente" }, { status: 400 });
    }
  }

  // Insert movement
  const { data: movement, error } = await db
    .from("inventory_movements")
    .insert({
      farm_id: result.farmId,
      item_id: body.itemId,
      type: body.type,
      quantity: body.quantity,
      unit_cost: body.unitCost ?? null,
      section_id: body.sectionId || null,
      crop_id: body.cropId || null,
      cattle_id: body.cattleId || null,
      date: body.date || new Date().toISOString().split("T")[0],
      notes: body.notes || null,
    })
    .select("*, inventory_items(name, unit)")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-create financial transaction for purchases
  if (body.type === "compra" && body.unitCost) {
    // Get item name for description
    const { data: item } = await db
      .from("inventory_items")
      .select("name")
      .eq("id", body.itemId)
      .single();

    const amount = Math.abs(Number(body.quantity) * Number(body.unitCost));

    await db.from("financial_transactions").insert({
      farm_id: result.farmId,
      type: "egreso",
      category: "compra_insumo",
      description: `Compra: ${item?.name || "insumo"}`,
      amount,
      date: body.date || new Date().toISOString().split("T")[0],
      section_id: body.sectionId || null,
      crop_id: body.cropId || null,
      cattle_id: body.cattleId || null,
      inventory_movement_id: movement!.id,
      notes: body.notes || null,
    });
  }

  return NextResponse.json(movement);
}
