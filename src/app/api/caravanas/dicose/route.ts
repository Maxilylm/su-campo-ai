import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { normalizeDicose } from "@/lib/caravanas";
import { caravanasMigrationRequired, caravanasTimeout, isCaravanasSchemaMissing } from "@/lib/caravanas-server";

/** The establishment's número DICOSE (farms.dicose_number, 054). */
export async function PUT(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;
  const parsed = await parseJsonBody(req, 4_000);
  if ("error" in parsed) return parsed.error;
  const dicose = normalizeDicose(parsed.data.dicoseNumber);
  if (!dicose.ok) return NextResponse.json({ error: dicose.reason }, { status: 400 });

  const db = getSupabaseAdmin();
  const updateResult = await withTimeout(
    db.from("farms").update({ dicose_number: dicose.value }).eq("id", result.farmId).select("dicose_number").maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!updateResult) return caravanasTimeout("guardar el número DICOSE");
  if (updateResult.error) {
    if (isCaravanasSchemaMissing(updateResult.error)) return caravanasMigrationRequired();
    return databaseFailure("caravanas DICOSE PUT", updateResult.error);
  }
  if (!updateResult.data) return NextResponse.json({ error: "Campo no encontrado" }, { status: 404 });
  return NextResponse.json({ dicoseNumber: dicose.value });
}
