import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { buildAgenda, type AgendaInputs } from "@/lib/agenda";

const MAX_HORIZON_DAYS = 180;

export async function GET(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const raw = Number(req.nextUrl.searchParams.get("days"));
  const horizonDays = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_HORIZON_DAYS) : 60;

  const db = getSupabaseAdmin();
  const [vacc, crops] = await Promise.all([
    db
      .from("vaccinations")
      .select("id, vaccine_name, next_due, head_count, sections(name)")
      .eq("farm_id", result.farmId)
      .not("next_due", "is", null),
    db
      .from("crops")
      .select("id, crop_type, status, expected_harvest, actual_harvest, sections(name)")
      .eq("farm_id", result.farmId)
      .not("expected_harvest", "is", null)
      .is("actual_harvest", null),
  ]);

  if (vacc.error || crops.error) {
    return NextResponse.json({ error: "No se pudo cargar la agenda." }, { status: 503 });
  }

  const items = buildAgenda(
    {
      vaccinations: (vacc.data as unknown as AgendaInputs["vaccinations"]) || [],
      crops: (crops.data as unknown as AgendaInputs["crops"]) || [],
    },
    Date.now(),
    horizonDays
  );

  return NextResponse.json({ items, horizonDays });
}
