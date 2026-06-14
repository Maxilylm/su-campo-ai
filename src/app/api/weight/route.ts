import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

// GET ?cattleId= : weight history for a batch (ascending by date).
export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const cattleId = req.nextUrl.searchParams.get("cattleId");
  if (!cattleId) return NextResponse.json({ error: "cattleId required" }, { status: 400 });

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("weight_records")
    .select("id, date, weight_kg, notes")
    .eq("farm_id", result.farmId)
    .eq("cattle_id", cattleId)
    .order("date", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data || []);
}

// POST: add a weighing; keep the batch's current weight in sync with the latest.
export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
  if (!body.cattleId || body.weightKg == null) {
    return NextResponse.json({ error: "cattleId and weightKg required" }, { status: 400 });
  }
  const date = body.date || new Date().toISOString().slice(0, 10);
  const db = getSupabaseAdmin();

  const { data, error } = await db
    .from("weight_records")
    .insert({
      farm_id: result.farmId,
      cattle_id: body.cattleId,
      date,
      weight_kg: Number(body.weightKg),
      notes: body.notes || null,
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Sync the batch's current weight to the most recent weighing.
  const { data: latest } = await db
    .from("weight_records")
    .select("weight_kg")
    .eq("cattle_id", body.cattleId)
    .eq("farm_id", result.farmId)
    .order("date", { ascending: false })
    .limit(1)
    .single();
  if (latest) {
    await db.from("cattle").update({ weight_kg: latest.weight_kg }).eq("id", body.cattleId).eq("farm_id", result.farmId);
  }

  return NextResponse.json(data);
}
