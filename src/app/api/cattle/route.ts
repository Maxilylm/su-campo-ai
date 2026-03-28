import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function GET(req: NextRequest) {
  const farmId = req.nextUrl.searchParams.get("farmId");
  if (!farmId) {
    return NextResponse.json({ error: "farmId required" }, { status: 400 });
  }

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("cattle")
    .select("*, sections(name)")
    .eq("farm_id", farmId)
    .order("category");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data);
}
