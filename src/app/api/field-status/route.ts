import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { loadFieldStatus } from "@/lib/field-status-server";

// What is in each potrero right now: heads by category, stocking, active
// crops, the grazing/rest clock and suggested rotation moves.
export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const status = await loadFieldStatus(getSupabaseAdmin(), result.farmId);
  if (!status.ok) {
    return status.reason === "timeout"
      ? NextResponse.json({ error: "El estado de los potreros tardó demasiado. Intentá nuevamente." }, { status: 504 })
      : NextResponse.json({ error: "No se pudo cargar el estado de los potreros." }, { status: 503 });
  }
  return NextResponse.json({ sections: status.sections, totals: status.totals, rotation: status.rotation });
}
