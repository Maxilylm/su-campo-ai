import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { parseIdempotencyKey } from "@/lib/idempotency";
import { normalizeWaterPoint, parseWaterPointInput, type WaterPointWrite } from "@/lib/water-points";

// Aguadas (migration 055). Every route resolves the farm from the session;
// section ids the client sends are checked against that farm.

const MAX_WATER_POINTS = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS = "id, name, kind, status, capacity_liters, location, section_ids, last_checked_at, notes, map_feature_id, created_at, updated_at";

type DbError = { code?: string; message?: string } | null;

function isMissingTable(error: DbError): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01"
    || /(?:relation|table).*water_points.*(?:does not exist|not found)/i.test(error?.message || "");
}

function migrationRequired() {
  return NextResponse.json({
    error: "Las aguadas necesitan la migración 055 de Supabase.",
    code: "water_points_migration_required",
    migration: "supabase/055_aguadas.sql",
  }, { status: 503 });
}

const timeout = (action: string) =>
  NextResponse.json({ error: `Supabase tardó demasiado al ${action}. Intentá nuevamente.`, code: "water_points_timeout" }, { status: 504 });

/** Every potrero id must belong to this farm. */
async function checkSections(farmId: string, ids: string[] | undefined): Promise<NextResponse | null> {
  if (!ids || ids.length === 0) return null;
  const db = getSupabaseAdmin();
  const lookup = await withTimeout(
    db.from("sections").select("id").eq("farm_id", farmId).in("id", ids),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!lookup) return timeout("verificar los potreros");
  if (lookup.error) return databaseFailure("water points sections lookup", lookup.error);
  if ((lookup.data ?? []).length !== ids.length) {
    return NextResponse.json({ error: "Alguno de los potreros elegidos no existe." }, { status: 400 });
  }
  return null;
}

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const query = await withTimeout(
    db.from("water_points").select(COLUMNS).eq("farm_id", result.farmId).order("created_at").limit(MAX_WATER_POINTS + 1),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!query) return NextResponse.json({ error: "Las aguadas tardaron demasiado. Intentá nuevamente." }, { status: 504 });
  // Before 055 the map keeps working with the legacy aguada markers.
  if (query.error && isMissingTable(query.error)) {
    return NextResponse.json({ items: [], truncated: false, migrationRequired: true, migration: "supabase/055_aguadas.sql" });
  }
  if (query.error) return databaseFailure("water points GET", query.error);
  const rows = query.data ?? [];
  return NextResponse.json({
    items: rows.slice(0, MAX_WATER_POINTS).map(normalizeWaterPoint).filter(Boolean),
    truncated: rows.length > MAX_WATER_POINTS,
    migrationRequired: false,
  });
}

export async function POST(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req, 32_000);
  if ("error" in parsed) return parsed.error;
  const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (idempotencyKey === false) return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });
  const input = parseWaterPointInput(parsed.data, { partial: false });
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  const sectionsError = await checkSections(result.farmId, input.value.section_ids);
  if (sectionsError) return sectionsError;

  const db = getSupabaseAdmin();
  if (idempotencyKey) {
    const existing = await withTimeout(
      db.from("water_points").select(COLUMNS).eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!existing) return timeout("verificar el reintento");
    if (existing.error && isMissingTable(existing.error)) return migrationRequired();
    if (existing.error) return databaseFailure("water points idempotency lookup", existing.error);
    if (existing.data) return NextResponse.json(normalizeWaterPoint(existing.data));
  }

  const insert = await withTimeout(
    db.from("water_points").insert({
      farm_id: result.farmId,
      ...input.value,
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    }).select(COLUMNS).single(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!insert) return timeout("guardar la aguada");
  if (insert.error && isMissingTable(insert.error)) return migrationRequired();
  if (insert.error?.code === "23505" && idempotencyKey) {
    const replay = await withTimeout(
      db.from("water_points").select(COLUMNS).eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!replay) return timeout("resolver el reintento");
    if (replay.error) return databaseFailure("water points idempotency replay", replay.error);
    if (replay.data) return NextResponse.json(normalizeWaterPoint(replay.data));
  }
  if (insert.error) return databaseFailure("water points POST", insert.error);
  return NextResponse.json(normalizeWaterPoint(insert.data));
}

export async function PATCH(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req, 32_000);
  if ("error" in parsed) return parsed.error;
  const { id } = parsed.data;
  if (typeof id !== "string" || !UUID.test(id)) return NextResponse.json({ error: "Aguada inválida." }, { status: 400 });
  const input = parseWaterPointInput(parsed.data, { partial: true });
  if (!input.ok) return NextResponse.json({ error: input.error }, { status: 400 });
  const sectionsError = await checkSections(result.farmId, input.value.section_ids);
  if (sectionsError) return sectionsError;

  const db = getSupabaseAdmin();
  const update = await withTimeout(
    db.from("water_points").update(input.value satisfies WaterPointWrite).eq("id", id).eq("farm_id", result.farmId).select(COLUMNS).maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!update) return timeout("actualizar la aguada");
  if (update.error && isMissingTable(update.error)) return migrationRequired();
  if (update.error) return databaseFailure("water points PATCH", update.error);
  if (!update.data) return NextResponse.json({ error: "La aguada no existe." }, { status: 404 });
  return NextResponse.json(normalizeWaterPoint(update.data));
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm({ write: true });
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const { id } = parsed.data;
  if (typeof id !== "string" || !UUID.test(id)) return NextResponse.json({ error: "Aguada inválida." }, { status: 400 });

  const db = getSupabaseAdmin();
  const removed = await withTimeout(
    db.from("water_points").delete().eq("id", id).eq("farm_id", result.farmId).select("id, map_feature_id").maybeSingle(),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!removed) return timeout("eliminar la aguada");
  if (removed.error && isMissingTable(removed.error)) return migrationRequired();
  if (removed.error) return databaseFailure("water points DELETE", removed.error);
  if (!removed.data) return NextResponse.json({ error: "La aguada no existe." }, { status: 404 });
  // The legacy marker it was backfilled from is the same aguada: remove it
  // too, or it would reappear as a decorative point. Best effort.
  const featureId = (removed.data as { map_feature_id?: string | null }).map_feature_id;
  if (featureId) {
    const feature = await withTimeout(
      db.from("map_features").delete().eq("id", featureId).eq("farm_id", result.farmId).eq("type", "aguada"),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!feature || feature.error) console.error("water points DELETE: linked map feature not removed", featureId);
  }
  return NextResponse.json({ ok: true });
}
