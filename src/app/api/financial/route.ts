import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

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
  return now.toISOString();
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
    .order("date", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();

  if (!body.amount || Number(body.amount) <= 0) {
    return NextResponse.json({ error: "Amount must be greater than 0" }, { status: 400 });
  }

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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const body = await req.json();
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

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const { id } = await req.json();
  const db = getSupabaseAdmin();
  const { error } = await db
    .from("financial_transactions")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
