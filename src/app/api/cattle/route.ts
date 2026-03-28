import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAuthFarmId } from "@/lib/auth";

export async function GET() {
  const farmId = await getAuthFarmId();
  if (!farmId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
