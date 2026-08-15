import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAuthState } from "@/lib/auth";
import { buildSampleData } from "@/lib/sample-data";
import { databaseFailure } from "@/lib/api-error";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { parseIdempotencyKey } from "@/lib/idempotency";
import { isActiveSampleDataRequest } from "@/lib/sample-data-retry";

const DAY = 86_400_000;
export const maxDuration = 30;
const SAMPLE_WRITE_TIMEOUT_MS = 6_000;
const iso = (daysOffset: number) => new Date(Date.now() + daysOffset * DAY).toISOString();
const isoDate = (daysOffset: number) => iso(daysOffset).slice(0, 10);

function boundedSampleWrite<T>(operation: PromiseLike<T>): Promise<T | null> {
  return withTimeout(operation, SAMPLE_WRITE_TIMEOUT_MS, null);
}

function isMissingTasksTable(error: { code?: string; message?: string } | null | undefined) {
  return error?.code === "42P01" || error?.code === "PGRST205" || error?.message?.toLowerCase().includes("tasks");
}

// Seeds a realistic demo farm for the current user. Creates the farm if none
// exists; refuses if the user's farm already has sections (avoid duplicating data).
export async function POST(req: NextRequest) {
  const auth = await getAuthState();
  if (!auth.user) {
    return NextResponse.json(
      { error: auth.unavailable ? "Authentication service unavailable" : "Unauthorized" },
      { status: auth.unavailable ? 503 : 401 }
    );
  }
  const user = auth.user;

  const db = getSupabaseAdmin();
  const parsedRequestId = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (parsedRequestId === false) return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });
  const requestId = parsedRequestId || `sample-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  let requestTracked = false;
  const requestLookup = await withTimeout(
    db.from("sample_data_requests")
      .select("status, response, updated_at")
      .eq("user_id", user.id)
      .eq("request_id", requestId)
      .maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  const missingRequestTable = requestLookup?.error && ["42P01", "PGRST205"].includes(requestLookup.error.code || "");
  const missingRequestColumn = requestLookup?.error?.code === "PGRST204";
  if (!requestLookup) return NextResponse.json({ error: "Supabase tardó demasiado al verificar la carga de ejemplo. Intentá nuevamente." }, { status: 504 });
  if (requestLookup.error && !missingRequestTable && !missingRequestColumn) return databaseFailure("sample data request lookup", requestLookup.error);

  const requestTrackingAvailable = !requestLookup.error;
  if (requestTrackingAvailable && requestLookup.data?.status === "completed" && requestLookup.data.response && typeof requestLookup.data.response === "object") {
    return NextResponse.json({ ...(requestLookup.data.response as Record<string, unknown>), replayed: true });
  }
  if (requestTrackingAvailable && isActiveSampleDataRequest(requestLookup.data)) {
    return NextResponse.json({ error: "La carga de ejemplo ya está en proceso. Esperá un momento antes de reintentar.", code: "sample_data_in_progress" }, { status: 409 });
  }
  if (requestTrackingAvailable && requestLookup.data?.status === "processing") {
    await boundedSampleWrite(db.from("sample_data_requests")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("request_id", requestId)
      .eq("status", "processing"));
  }
  if (requestTrackingAvailable) {
    const claim = await boundedSampleWrite(db.from("sample_data_requests").insert({ user_id: user.id, request_id: requestId }));
    if (!claim) return NextResponse.json({ error: "Supabase tardó demasiado al reservar la carga de ejemplo. Intentá nuevamente." }, { status: 504 });
    if (claim.error?.code === "23505") {
      const activeRequest = await withTimeout(db.from("sample_data_requests")
        .select("status, updated_at")
        .eq("user_id", user.id)
        .eq("status", "processing")
        .maybeSingle(), SUPABASE_READ_TIMEOUT_MS, null);
      if (isActiveSampleDataRequest(activeRequest?.data)) {
        return NextResponse.json({ error: "La carga de ejemplo ya está en proceso. Esperá un momento antes de reintentar.", code: "sample_data_in_progress" }, { status: 409 });
      }
      return databaseFailure("sample data request claim", claim.error);
    }
    if (claim.error) return databaseFailure("sample data request claim", claim.error);
    requestTracked = true;
  }
  const markRequestFailed = async () => {
    if (!requestTracked) return;
    await boundedSampleWrite(db.from("sample_data_requests")
      .update({ status: "failed", updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("request_id", requestId)
      .eq("status", "processing"));
  };
  const sample = buildSampleData();
  let createdFarm = false;

  // Find or create the user's farm.
  const existingResult = await withTimeout(
    db.from("farms").select("id").eq("user_id", user.id).single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!existingResult) {
    await markRequestFailed();
    return NextResponse.json({ error: "Supabase tardó demasiado al verificar tu campo. Intentá nuevamente." }, { status: 504 });
  }
  const { data: existing, error: existingError } = existingResult;
  if (existingError && existingError.code !== "PGRST116") {
    await markRequestFailed();
    return databaseFailure("sample farm lookup", existingError);
  }
  let farmId = existing?.id as string | undefined;

  if (farmId) {
    const sectionsResult = await withTimeout(
      db.from("sections").select("id", { count: "exact", head: true }).eq("farm_id", farmId),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!sectionsResult) {
      await markRequestFailed();
      return NextResponse.json({ error: "Supabase tardó demasiado al revisar los datos existentes. Intentá nuevamente." }, { status: 504 });
    }
    const { count, error: sectionsError } = sectionsResult;
    if (sectionsError) {
      await markRequestFailed();
      return databaseFailure("sample sections lookup", sectionsError);
    }
    if ((count ?? 0) > 0) {
      await markRequestFailed();
      return NextResponse.json({ error: "Tu campo ya tiene datos. Borralos antes de cargar el ejemplo." }, { status: 409 });
    }
  } else {
    const farmResult = await boundedSampleWrite(db.from("farms").insert({
      name: sample.farm.name,
      user_id: user.id,
      owner_phone: user.phone || `web-${user.id}`,
      total_hectares: sample.farm.total_hectares,
      location: sample.farm.location,
      operation_type: sample.farm.operation_type,
    }).select("id").single());
    if (!farmResult) {
      await markRequestFailed();
      return NextResponse.json({ error: "Supabase tardó demasiado al crear el campo de ejemplo. Intentá nuevamente." }, { status: 504 });
    }
    const { data: farm, error } = farmResult;
    if (error || !farm) {
      await markRequestFailed();
      return error ? databaseFailure("sample farm creation", error) : NextResponse.json({ error: "No se pudo crear el campo" }, { status: 500 });
    }
    farmId = farm.id;
    createdFarm = true;
  }

  // Sections → map key to real id.
  const sectionsResult = await boundedSampleWrite(db.from("sections").insert(
    sample.sections.map((s) => ({
      farm_id: farmId, name: s.name, size_hectares: s.size_hectares,
      water_status: s.water_status, pasture_status: s.pasture_status,
    }))
  ).select("id, name"));
  if (!sectionsResult) {
    await markRequestFailed();
    return NextResponse.json({ error: "Supabase tardó demasiado al crear las secciones de ejemplo. Intentá nuevamente." }, { status: 504 });
  }
  const { data: insertedSections, error: secErr } = sectionsResult;
  if (secErr) {
    if (createdFarm) await boundedSampleWrite(db.from("farms").delete().eq("id", farmId));
    await markRequestFailed();
    return NextResponse.json({ error: "No se pudieron crear las secciones de ejemplo." }, { status: 500 });
  }

  const idByName = new Map((insertedSections || []).map((s) => [s.name, s.id]));
  const sectionId = (key: string) => idByName.get(sample.sections.find((s) => s.key === key)!.name) ?? null;

  const seedResults = await Promise.all([
    boundedSampleWrite(db.from("cattle").insert(sample.cattle.map((c) => ({
      farm_id: farmId, section_id: sectionId(c.sectionKey),
      category: c.category, breed: c.breed, count: c.count,
      weight_kg: c.weight_kg, vaccination_status: c.vaccination_status,
    }))).select("id")),
    boundedSampleWrite(db.from("crops").insert(sample.crops.map((c) => ({
      farm_id: farmId, section_id: sectionId(c.sectionKey),
      crop_type: c.crop_type, variety: c.variety, planted_hectares: c.planted_hectares,
      status: c.status, expected_harvest: isoDate(c.expectedHarvestInDays),
    }))).select("id")),
    boundedSampleWrite(db.from("inventory_items").insert(sample.inventory.map((i) => ({
      farm_id: farmId, name: i.name, category: i.category, unit: i.unit,
      current_stock: i.current_stock, min_stock: i.min_stock, cost_per_unit: i.cost_per_unit,
    }))).select("id")),
    boundedSampleWrite(db.from("vaccinations").insert(sample.vaccinations.map((v) => ({
      farm_id: farmId, vaccine_name: v.vaccine_name, head_count: v.head_count,
      date_applied: iso(-v.appliedDaysAgo), next_due: iso(v.nextDueInDays),
    }))).select("id")),
    boundedSampleWrite(db.from("health_events").insert(sample.health_events.map((h) => ({
      farm_id: farmId, type: h.type, description: h.description,
      head_count: h.head_count, resolved: h.resolved, date_occurred: iso(0),
    }))).select("id")),
    boundedSampleWrite(db.from("financial_transactions").insert(sample.transactions.map((t) => ({
      farm_id: farmId, type: t.type, category: t.category, amount: t.amount,
      currency: t.currency, date: isoDate(-t.daysAgo), description: t.description,
    }))).select("id")),
    boundedSampleWrite(db.from("tasks").insert(sample.tasks.map((t) => ({
      farm_id: farmId, section_id: t.sectionKey ? sectionId(t.sectionKey) : null,
      title: t.title, description: t.description, due_date: isoDate(t.dueInDays),
      priority: t.priority, status: "pending",
    }))).select("id")),
  ]);

  const seedTimedOut = seedResults.some((result) => !result);
  const requiredSeedError = seedResults.slice(0, 6).find((result) => result?.error)?.error;
  const taskSeedError = seedResults[6]?.error;
  if (seedTimedOut) {
    const [cattleSeed, cropsSeed, inventorySeed, vaccinationSeed, healthSeed, financialSeed, taskSeed] = seedResults;
    await Promise.all([
      taskSeed?.data?.length ? boundedSampleWrite(db.from("tasks").delete().in("id", taskSeed.data.map((row) => row.id))) : Promise.resolve(),
      financialSeed?.data?.length ? boundedSampleWrite(db.from("financial_transactions").delete().in("id", financialSeed.data.map((row) => row.id))) : Promise.resolve(),
      healthSeed?.data?.length ? boundedSampleWrite(db.from("health_events").delete().in("id", healthSeed.data.map((row) => row.id))) : Promise.resolve(),
      vaccinationSeed?.data?.length ? boundedSampleWrite(db.from("vaccinations").delete().in("id", vaccinationSeed.data.map((row) => row.id))) : Promise.resolve(),
      cropsSeed?.data?.length ? boundedSampleWrite(db.from("crops").delete().in("id", cropsSeed.data.map((row) => row.id))) : Promise.resolve(),
      cattleSeed?.data?.length ? boundedSampleWrite(db.from("cattle").delete().in("id", cattleSeed.data.map((row) => row.id))) : Promise.resolve(),
      inventorySeed?.data?.length ? boundedSampleWrite(db.from("inventory_items").delete().in("id", inventorySeed.data.map((row) => row.id))) : Promise.resolve(),
      insertedSections?.length ? boundedSampleWrite(db.from("sections").delete().in("id", insertedSections.map((row) => row.id))) : Promise.resolve(),
    ]);
    if (createdFarm) await boundedSampleWrite(db.from("farms").delete().eq("id", farmId));
    await markRequestFailed();
    return NextResponse.json({ error: "Supabase tardó demasiado al cargar los datos de ejemplo. Intentá nuevamente." }, { status: 504 });
  }
  const seedError = requiredSeedError || (taskSeedError && !isMissingTasksTable(taskSeedError) ? taskSeedError : undefined);
  if (seedError) {
    const [cattleSeed, cropsSeed, inventorySeed, vaccinationSeed, healthSeed, financialSeed, taskSeed] = seedResults;
    await Promise.all([
      taskSeed?.data?.length ? boundedSampleWrite(db.from("tasks").delete().in("id", taskSeed.data.map((row) => row.id))) : Promise.resolve(),
      financialSeed?.data?.length ? boundedSampleWrite(db.from("financial_transactions").delete().in("id", financialSeed.data.map((row) => row.id))) : Promise.resolve(),
      healthSeed?.data?.length ? boundedSampleWrite(db.from("health_events").delete().in("id", healthSeed.data.map((row) => row.id))) : Promise.resolve(),
      vaccinationSeed?.data?.length ? boundedSampleWrite(db.from("vaccinations").delete().in("id", vaccinationSeed.data.map((row) => row.id))) : Promise.resolve(),
      cropsSeed?.data?.length ? boundedSampleWrite(db.from("crops").delete().in("id", cropsSeed.data.map((row) => row.id))) : Promise.resolve(),
      cattleSeed?.data?.length ? boundedSampleWrite(db.from("cattle").delete().in("id", cattleSeed.data.map((row) => row.id))) : Promise.resolve(),
      inventorySeed?.data?.length ? boundedSampleWrite(db.from("inventory_items").delete().in("id", inventorySeed.data.map((row) => row.id))) : Promise.resolve(),
      insertedSections?.length ? boundedSampleWrite(db.from("sections").delete().in("id", insertedSections.map((row) => row.id))) : Promise.resolve(),
    ]);
    if (createdFarm) await boundedSampleWrite(db.from("farms").delete().eq("id", farmId));
    await markRequestFailed();
    return NextResponse.json(
      { error: "No se pudieron cargar todos los datos de ejemplo." },
      { status: 500 }
    );
  }

  const activityResult = await boundedSampleWrite(db.from("activities").insert({
    farm_id: farmId,
    type: "setup",
    description: "Cargó datos de ejemplo para explorar CampoAI",
    message_type: "text",
    reported_by: user.email || user.id,
    metadata: { source: "sample_data", tasks: !taskSeedError },
  }));
  if (activityResult?.error) console.warn("sample data activity log:", activityResult.error.message);

  const response = { ok: true, farmId, features: { tasks: !taskSeedError } };
  if (requestTracked) {
    const completion = await boundedSampleWrite(db.from("sample_data_requests")
      .update({ status: "completed", response, updated_at: new Date().toISOString() })
      .eq("user_id", user.id)
      .eq("request_id", requestId)
      .eq("status", "processing"));
    if (completion?.error) console.warn("sample data request completion:", completion.error.message);
  }
  return NextResponse.json(response);
}
