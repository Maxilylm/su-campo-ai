import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { databaseFailure } from "@/lib/api-error";
import { parsePagination, splitPage } from "@/lib/pagination";
import { withTimeout } from "@/lib/timeout";

const ACTIVITIES_QUERY_TIMEOUT_MS = 7000;

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const { limit, offset } = parsePagination(req.nextUrl.searchParams);

  const db = getSupabaseAdmin();
  const queryResult = await withTimeout(
    db
      .from("activities")
      .select("*")
      .eq("farm_id", result.farmId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + limit),
    ACTIVITIES_QUERY_TIMEOUT_MS,
    null,
  );

  if (!queryResult) {
    return NextResponse.json({ error: "El registro tardó demasiado. Intentá nuevamente." }, { status: 504 });
  }

  const { data, error } = queryResult;

  if (error) return databaseFailure("activities GET", error);
  const page = splitPage(data || [], limit);
  return NextResponse.json(page.items, {
    headers: {
      "Cache-Control": "no-store",
      "X-Has-More": String(page.hasMore),
      "X-Next-Offset": String(offset + page.items.length),
    },
  });
}
