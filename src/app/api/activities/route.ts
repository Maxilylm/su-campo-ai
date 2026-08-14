import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { databaseFailure } from "@/lib/api-error";

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const requestedLimit = Number(req.nextUrl.searchParams.get("limit") || "50");
  const limit = Number.isFinite(requestedLimit)
    ? Math.min(200, Math.max(1, Math.floor(requestedLimit)))
    : 50;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("activities")
    .select("*")
    .eq("farm_id", result.farmId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) return databaseFailure("activities GET", error);
  return NextResponse.json(data);
}
