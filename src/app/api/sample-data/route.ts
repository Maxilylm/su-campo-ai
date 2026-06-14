import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAuthUser } from "@/lib/auth";
import { buildSampleData } from "@/lib/sample-data";

const DAY = 86_400_000;
const iso = (daysOffset: number) => new Date(Date.now() + daysOffset * DAY).toISOString();
const isoDate = (daysOffset: number) => iso(daysOffset).slice(0, 10);

// Seeds a realistic demo farm for the current user. Creates the farm if none
// exists; refuses if the user's farm already has sections (avoid duplicating data).
export async function POST() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const db = getSupabaseAdmin();
  const sample = buildSampleData();

  // Find or create the user's farm.
  const { data: existing } = await db.from("farms").select("id").eq("user_id", user.id).single();
  let farmId = existing?.id as string | undefined;

  if (farmId) {
    const { count } = await db.from("sections").select("id", { count: "exact", head: true }).eq("farm_id", farmId);
    if ((count ?? 0) > 0) {
      return NextResponse.json({ error: "Tu campo ya tiene datos. Borralos antes de cargar el ejemplo." }, { status: 409 });
    }
  } else {
    const { data: farm, error } = await db.from("farms").insert({
      name: sample.farm.name,
      user_id: user.id,
      owner_phone: user.phone || `web-${user.id}`,
      total_hectares: sample.farm.total_hectares,
      location: sample.farm.location,
      operation_type: sample.farm.operation_type,
    }).select("id").single();
    if (error || !farm) return NextResponse.json({ error: error?.message || "No se pudo crear el campo" }, { status: 500 });
    farmId = farm.id;
  }

  // Sections → map key to real id.
  const { data: insertedSections, error: secErr } = await db.from("sections").insert(
    sample.sections.map((s) => ({
      farm_id: farmId, name: s.name, size_hectares: s.size_hectares,
      water_status: s.water_status, pasture_status: s.pasture_status,
    }))
  ).select("id, name");
  if (secErr) return NextResponse.json({ error: secErr.message }, { status: 500 });

  const idByName = new Map((insertedSections || []).map((s) => [s.name, s.id]));
  const sectionId = (key: string) => idByName.get(sample.sections.find((s) => s.key === key)!.name) ?? null;

  await Promise.all([
    db.from("cattle").insert(sample.cattle.map((c) => ({
      farm_id: farmId, section_id: sectionId(c.sectionKey),
      category: c.category, breed: c.breed, count: c.count,
      weight_kg: c.weight_kg, vaccination_status: c.vaccination_status,
    }))),
    db.from("crops").insert(sample.crops.map((c) => ({
      farm_id: farmId, section_id: sectionId(c.sectionKey),
      crop_type: c.crop_type, variety: c.variety, planted_hectares: c.planted_hectares,
      status: c.status, expected_harvest: isoDate(c.expectedHarvestInDays),
    }))),
    db.from("inventory_items").insert(sample.inventory.map((i) => ({
      farm_id: farmId, name: i.name, category: i.category, unit: i.unit,
      current_stock: i.current_stock, min_stock: i.min_stock, cost_per_unit: i.cost_per_unit,
    }))),
    db.from("vaccinations").insert(sample.vaccinations.map((v) => ({
      farm_id: farmId, vaccine_name: v.vaccine_name, head_count: v.head_count,
      date_applied: iso(-v.appliedDaysAgo), next_due: iso(v.nextDueInDays),
    }))),
    db.from("health_events").insert(sample.health_events.map((h) => ({
      farm_id: farmId, type: h.type, description: h.description,
      head_count: h.head_count, resolved: h.resolved, date_occurred: iso(0),
    }))),
    db.from("financial_transactions").insert(sample.transactions.map((t) => ({
      farm_id: farmId, type: t.type, category: t.category, amount: t.amount,
      currency: t.currency, date: isoDate(-t.daysAgo), description: t.description,
    }))),
  ]);

  return NextResponse.json({ ok: true, farmId });
}
