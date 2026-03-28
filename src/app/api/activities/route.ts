import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const farmId = req.nextUrl.searchParams.get("farmId");
  const limit = parseInt(req.nextUrl.searchParams.get("limit") || "50");
  if (!farmId) {
    return NextResponse.json({ error: "farmId required" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("activities")
    .select("*")
    .eq("farm_id", farmId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
