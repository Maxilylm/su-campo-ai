import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("inventory_items")
    .select("*")
    .eq("farm_id", result.farmId)
    .order("category")
    .order("name");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("inventory_items")
    .insert({
      farm_id: result.farmId,
      name: body.name,
      category: body.category,
      unit: body.unit,
      current_stock: body.currentStock ?? 0,
      min_stock: body.minStock ?? null,
      cost_per_unit: body.costPerUnit ?? null,
      notes: body.notes || null,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("inventory_items")
    .update({
      name: body.name,
      category: body.category,
      unit: body.unit,
      min_stock: body.minStock,
      notes: body.notes,
    })
    .eq("id", body.id)
    .eq("farm_id", result.farmId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const { id } = await req.json();
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("inventory_items")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
