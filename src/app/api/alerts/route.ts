import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { buildAlerts } from "@/lib/alerts";

// Aggregates actionable alerts (vaccinations due, low stock, pending health,
// upcoming harvests) from existing data. No new tables.
export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const farmId = result.farmId;

  const [vacc, inv, health, crops] = await Promise.all([
    db.from("vaccinations").select("id, vaccine_name, next_due, sections(name)").eq("farm_id", farmId).not("next_due", "is", null),
    db.from("inventory_items").select("id, name, current_stock, min_stock, unit").eq("farm_id", farmId).not("min_stock", "is", null),
    db.from("health_events").select("id, type, description, resolved").eq("farm_id", farmId).eq("resolved", false),
    db.from("crops").select("id, crop_type, status, expected_harvest, actual_harvest, sections(name)").eq("farm_id", farmId).not("expected_harvest", "is", null).is("actual_harvest", null),
  ]);

  if ([vacc, inv, health, crops].some((query) => query.error)) {
    return NextResponse.json({ error: "No se pudieron cargar las alertas." }, { status: 503 });
  }

  const alerts = buildAlerts(
    {
      vaccinations: (vacc.data as never[]) || [],
      inventory: (inv.data as never[]) || [],
      health: (health.data as never[]) || [],
      crops: (crops.data as never[]) || [],
    },
    Date.now()
  );

  return NextResponse.json({ alerts, count: alerts.length });
}
