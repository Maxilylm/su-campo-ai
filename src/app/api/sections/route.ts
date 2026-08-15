import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { withTimeout } from "@/lib/timeout";
import { splitPage } from "@/lib/pagination";
import { parseIdempotencyKey } from "@/lib/idempotency";

const SECTIONS_QUERY_TIMEOUT_MS = 7000;
const MAX_SECTIONS = 500;
const MAX_CATTLE = 2000;

function sectionIdempotencyMigrationRequired() {
  return NextResponse.json({
    error: "Aplicá la migración 029 para habilitar reintentos seguros de secciones y hacienda.",
    code: "hacienda_idempotency_migration_required",
    migration: "supabase/029_hacienda_idempotency.sql",
  }, { status: 503 });
}

function sectionWriteTimeout(action: string) {
  return NextResponse.json(
    { error: `Supabase tardó demasiado al ${action}. Intentá nuevamente.`, code: "section_write_timeout" },
    { status: 504 },
  );
}

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const queryResults = await withTimeout(
    Promise.all([
      db
        .from("sections")
        .select("*, padrones(id, padron_code, department_name)", { count: "exact" })
        .eq("farm_id", result.farmId)
        .order("name")
        .limit(MAX_SECTIONS + 1),
      db
        .from("cattle")
        .select("id, section_id, category, count, breed, health_status, notes, weight_kg, vaccination_status, reproductive_status, ear_tag, tag_range, origin")
        .eq("farm_id", result.farmId)
        .not("section_id", "is", null)
        .order("category")
        .limit(MAX_CATTLE + 1),
    ]),
    SECTIONS_QUERY_TIMEOUT_MS,
    null,
  );

  if (!queryResults) {
    return NextResponse.json({ error: "La carga de secciones tardó demasiado. Intentá nuevamente." }, { status: 504 });
  }

  const [sections, cattle] = queryResults;
  if (sections.error) return databaseFailure("sections GET", sections.error);
  if (cattle.error) return databaseFailure("sections cattle lookup", cattle.error);

  const sectionPage = splitPage(sections.data || [], MAX_SECTIONS);
  const sectionsTruncated = sectionPage.hasMore || (sections.count ?? 0) > MAX_SECTIONS;
  const cattleRows = cattle.data || [];
  const cattleTruncated = cattleRows.length > MAX_CATTLE;
  const cattleBySection = new Map<string, typeof cattle.data>();
  for (const row of cattleRows.slice(0, MAX_CATTLE)) {
    if (!row.section_id) continue;
    cattleBySection.set(row.section_id, [...(cattleBySection.get(row.section_id) || []), row]);
  }
  const data = sectionPage.items.map((section) => ({
    ...section,
    cattle: cattleBySection.get(section.id) || [],
  }));

  const response = NextResponse.json(data);
  response.headers.set("X-CampoAI-Sections-Limit", String(MAX_SECTIONS));
  if (sectionsTruncated) response.headers.set("X-CampoAI-Sections-Truncated", "true");
  response.headers.set("X-CampoAI-Cattle-Limit", String(MAX_CATTLE));
  if (cattleTruncated) response.headers.set("X-CampoAI-Cattle-Truncated", "true");
  return response;
}

export async function POST(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (idempotencyKey === false) return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sizeHectares = body.sizeHectares == null || body.sizeHectares === "" ? null : Number(body.sizeHectares);
  const capacity = body.capacity == null || body.capacity === "" ? null : Number(body.capacity);
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (sizeHectares !== null && (!Number.isFinite(sizeHectares) || sizeHectares < 0)) return NextResponse.json({ error: "sizeHectares inválido" }, { status: 400 });
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 0)) return NextResponse.json({ error: "capacity inválida" }, { status: 400 });
  const db = getSupabaseAdmin();
  if (idempotencyKey) {
    const existingLookup = await withTimeout(
      db.from("sections").select("*").eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      SECTIONS_QUERY_TIMEOUT_MS,
      null,
    );
    if (!existingLookup) return NextResponse.json({ error: "Secciones tardó demasiado al verificar el reintento.", code: "section_idempotency_lookup_timeout" }, { status: 504 });
    if (["PGRST204", "PGRST205"].includes(existingLookup.error?.code || "")) return sectionIdempotencyMigrationRequired();
    if (existingLookup.error) return databaseFailure("sections idempotency lookup", existingLookup.error);
    if (existingLookup.data) return NextResponse.json(existingLookup.data);
  }
  const insertResult = await withTimeout(db
    .from("sections")
    .insert({
      farm_id: result.farmId,
      name,
      size_hectares: sizeHectares,
      capacity,
      color: body.color || "#22c55e",
      water_status: body.waterStatus || "bueno",
      pasture_status: body.pastureStatus || "bueno",
      notes: body.notes || null,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    })
    .select()
    .single(), SECTIONS_QUERY_TIMEOUT_MS, null);
  if (!insertResult) return sectionWriteTimeout("crear la sección");
  const { data, error } = insertResult;

  if (error?.code === "PGRST204" && idempotencyKey) return sectionIdempotencyMigrationRequired();
  if (error?.code === "23505" && idempotencyKey) {
    const replay = await withTimeout(
      db.from("sections").select("*").eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      SECTIONS_QUERY_TIMEOUT_MS,
      null,
    );
    if (!replay) return NextResponse.json({ error: "Secciones tardó demasiado al resolver el reintento.", code: "section_idempotency_lookup_timeout" }, { status: 504 });
    if (replay.error) return databaseFailure("sections idempotency replay", replay.error);
    if (replay.data) return NextResponse.json(replay.data);
  }
  if (error) return databaseFailure("sections POST", error);
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sizeHectares = body.sizeHectares == null || body.sizeHectares === "" ? null : Number(body.sizeHectares);
  const capacity = body.capacity == null || body.capacity === "" ? null : Number(body.capacity);
  if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
  if (sizeHectares !== null && (!Number.isFinite(sizeHectares) || sizeHectares < 0)) return NextResponse.json({ error: "sizeHectares inválido" }, { status: 400 });
  if (capacity !== null && (!Number.isInteger(capacity) || capacity < 0)) return NextResponse.json({ error: "capacity inválida" }, { status: 400 });
  const db = getSupabaseAdmin();
  const updateResult = await withTimeout(db
    .from("sections")
    .update({
      name,
      size_hectares: sizeHectares,
      capacity,
      color: body.color,
      water_status: body.waterStatus,
      pasture_status: body.pastureStatus,
      notes: body.notes,
    })
    .eq("id", body.id)
    .eq("farm_id", result.farmId)
    .select()
    .single(), SECTIONS_QUERY_TIMEOUT_MS, null);
  if (!updateResult) return sectionWriteTimeout("actualizar la sección");
  const { data, error } = updateResult;

  if (error) return databaseFailure("sections PUT", error);
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const { id } = parsed.data;
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const db = getSupabaseAdmin();
  const deleteResult = await withTimeout(db
    .from("sections")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId)
    .select("id")
    .maybeSingle(), SECTIONS_QUERY_TIMEOUT_MS, null);
  if (!deleteResult) return sectionWriteTimeout("eliminar la sección");
  const { data: deleted, error } = deleteResult;

  if (error) return databaseFailure("sections DELETE", error);
  if (!deleted) return NextResponse.json({ error: "Sección no encontrada" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
