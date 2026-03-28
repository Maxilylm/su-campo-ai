import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("activities")
    .select("*")
    .eq("farm_id", result.farmId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
