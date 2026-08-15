import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAuthState } from "@/lib/auth";
import { buildSampleData } from "@/lib/sample-data";
import { databaseFailure } from "@/lib/api-error";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";

const DAY = 86_400_000;
export const maxDuration = 30;
const iso = (daysOffset: number) => new Date(Date.now() + daysOffset * DAY).toISOString();
const isoDate = (daysOffset: number) => iso(daysOffset).slice(0, 10);

function isMissingTasksTable(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.message?.toLowerCase().includes("tasks");
}

// Seeds a realistic demo farm for the current user. Creates the farm if none
// exists; refuses if the user's farm already has sections (avoid duplicating data).
export async function POST() {
  const auth = await getAuthState();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.unavailable ? "Authentication service unavailable" : "Unauthorized" },
      { status: auth.unavailable ? 503 : 401 }
    );
  }
  const user = auth.user;

  const db = getSupabaseAdmin();
  const sample = buildSampleData();
  let createdFarm = false;

  // Find or create the user's farm.
  const existingResult = await withTimeout(
    db.from("farms").select("id").eq("user_id", user.id).single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!existingResult) return NextResponse.json({ error: "Supabase tardó demasiado al verificar tu campo. Intentá nuevamente." }, { status: 504 });
  const { data: existing, error: existingError } = existingResult;
  if (existingError && existingError.code !== "PGRST116") return databaseFailure("sample farm lookup", existingError);
  let farmId = existing?.id as string | undefined;

  if (farmId) {
    const sectionsResult = await withTimeout(
      db.from("sections").select("id", { count: "exact", head: true }).eq("farm_id", farmId),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!sectionsResult) return NextResponse.json({ error: "Supabase tardó demasiado al revisar los datos existentes. Intentá nuevamente." }, { status: 504 });
    const { count, error: sectionsError } = sectionsResult;
    if (sectionsError) return databaseFailure("sample sections lookup", sectionsError);
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
    if (error || !farm) return error ? databaseFailure("sample farm creation", error) : NextResponse.json({ error: "No se pudo crear el campo" }, { status: 500 });
    farmId = farm.id;
    createdFarm = true;
  }

  // Sections → map key to real id.
  const { data: insertedSections, error: secErr } = await db.from("sections").insert(
    sample.sections.map((s) => ({
      farm_id: farmId, name: s.name, size_hectares: s.size_hectares,
      water_status: s.water_status, pasture_status: s.pasture_status,
    }))
  ).select("id, name");
  if (secErr) {
    if (createdFarm) await db.from("farms").delete().eq("id", farmId);
    return NextResponse.json({ error: "No se pudieron crear las secciones de ejemplo." }, { status: 500 });
  }

  const idByName = new Map((insertedSections || []).map((s) => [s.name, s.id]));
  const sectionId = (key: string) => idByName.get(sample.sections.find((s) => s.key === key)!.name) ?? null;

  const seedResults = await Promise.all([
    db.from("cattle").insert(sample.cattle.map((c) => ({
      farm_id: farmId, section_id: sectionId(c.sectionKey),
      category: c.category, breed: c.breed, count: c.count,
      weight_kg: c.weight_kg, vaccination_status: c.vaccination_status,
    }))).select("id"),
    db.from("crops").insert(sample.crops.map((c) => ({
      farm_id: farmId, section_id: sectionId(c.sectionKey),
      crop_type: c.crop_type, variety: c.variety, planted_hectares: c.planted_hectares,
      status: c.status, expected_harvest: isoDate(c.expectedHarvestInDays),
    }))).select("id"),
    db.from("inventory_items").insert(sample.inventory.map((i) => ({
      farm_id: farmId, name: i.name, category: i.category, unit: i.unit,
      current_stock: i.current_stock, min_stock: i.min_stock, cost_per_unit: i.cost_per_unit,
    }))).select("id"),
    db.from("vaccinations").insert(sample.vaccinations.map((v) => ({
      farm_id: farmId, vaccine_name: v.vaccine_name, head_count: v.head_count,
      date_applied: iso(-v.appliedDaysAgo), next_due: iso(v.nextDueInDays),
    }))).select("id"),
    db.from("health_events").insert(sample.health_events.map((h) => ({
      farm_id: farmId, type: h.type, description: h.description,
      head_count: h.head_count, resolved: h.resolved, date_occurred: iso(0),
    }))).select("id"),
    db.from("financial_transactions").insert(sample.transactions.map((t) => ({
      farm_id: farmId, type: t.type, category: t.category, amount: t.amount,
      currency: t.currency, date: isoDate(-t.daysAgo), description: t.description,
    }))).select("id"),
    db.from("tasks").insert(sample.tasks.map((t) => ({
      farm_id: farmId, section_id: t.sectionKey ? sectionId(t.sectionKey) : null,
      title: t.title, description: t.description, due_date: isoDate(t.dueInDays),
      priority: t.priority, status: "pending",
    }))).select("id"),
  ]);

  const requiredSeedError = seedResults.slice(0, 6).find((result) => result.error)?.error;
  const taskSeedError = seedResults[6]?.error;
  const seedError = requiredSeedError || (taskSeedError && !isMissingTasksTable(taskSeedError) ? taskSeedError : undefined);
  if (seedError) {
    const [cattleSeed, cropsSeed, inventorySeed, vaccinationSeed, healthSeed, financialSeed, taskSeed] = seedResults;
    await Promise.all([
      taskSeed.data?.length ? db.from("tasks").delete().in("id", taskSeed.data.map((row) => row.id)) : Promise.resolve(),
      financialSeed.data?.length ? db.from("financial_transactions").delete().in("id", financialSeed.data.map((row) => row.id)) : Promise.resolve(),
      healthSeed.data?.length ? db.from("health_events").delete().in("id", healthSeed.data.map((row) => row.id)) : Promise.resolve(),
      vaccinationSeed.data?.length ? db.from("vaccinations").delete().in("id", vaccinationSeed.data.map((row) => row.id)) : Promise.resolve(),
      cropsSeed.data?.length ? db.from("crops").delete().in("id", cropsSeed.data.map((row) => row.id)) : Promise.resolve(),
      cattleSeed.data?.length ? db.from("cattle").delete().in("id", cattleSeed.data.map((row) => row.id)) : Promise.resolve(),
      inventorySeed.data?.length ? db.from("inventory_items").delete().in("id", inventorySeed.data.map((row) => row.id)) : Promise.resolve(),
      insertedSections?.length ? db.from("sections").delete().in("id", insertedSections.map((row) => row.id)) : Promise.resolve(),
    ]);
    if (createdFarm) await db.from("farms").delete().eq("id", farmId);
    return NextResponse.json(
      { error: "No se pudieron cargar todos los datos de ejemplo." },
      { status: 500 }
    );
  }

  const { error: activityError } = await db.from("activities").insert({
    farm_id: farmId,
    type: "setup",
    description: "Cargó datos de ejemplo para explorar CampoAI",
    message_type: "text",
    reported_by: user.email || user.id,
    metadata: { source: "sample_data", tasks: !taskSeedError },
  });
  if (activityError) console.warn("sample data activity log:", activityError.message);

  return NextResponse.json({ ok: true, farmId, features: { tasks: !taskSeedError } });
}
