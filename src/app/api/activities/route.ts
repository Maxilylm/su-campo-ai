import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { databaseFailure } from "@/lib/api-error";
import { parsePagination, splitPage } from "@/lib/pagination";
import { withTimeout } from "@/lib/timeout";
import { isUuid } from "@/lib/uuid";

const ACTIVITIES_QUERY_TIMEOUT_MS = 7000;

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const { limit, offset } = parsePagination(req.nextUrl.searchParams);
  // Optional: the audit rows of one record (a task's "Historial").
  const recordId = req.nextUrl.searchParams.get("recordId");
  const recordTable = req.nextUrl.searchParams.get("recordTable");
  if (recordId != null && !isUuid(recordId)) return NextResponse.json({ error: "recordId inválido" }, { status: 400 });
  if (recordTable != null && !/^[a-z_]{1,64}$/.test(recordTable)) return NextResponse.json({ error: "recordTable inválida" }, { status: 400 });

  const db = getSupabaseAdmin();
  let query = db
    .from("activities")
    .select("*")
    .eq("farm_id", result.farmId);
  if (recordId) query = query.eq("metadata->>record_id", recordId);
  if (recordTable) query = query.eq("metadata->>table", recordTable);
  const queryResult = await withTimeout(
    query
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
