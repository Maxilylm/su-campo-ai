import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("map_features")
    .select("*")
    .eq("farm_id", result.farmId)
    .order("created_at");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("map_features")
    .insert({
      farm_id: result.farmId,
      type: body.type,
      name: body.name || null,
      geometry: body.geometry,
      properties: body.properties || {},
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
    .from("map_features")
    .update({ name: body.name, properties: body.properties })
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
    .from("map_features")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
