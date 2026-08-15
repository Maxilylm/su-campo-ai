import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { SUPABASE_READ_TIMEOUT_MS, withTimeout } from "@/lib/timeout";
import { splitPage } from "@/lib/pagination";
import { parseIdempotencyKey } from "@/lib/idempotency";

const MAX_MAP_FEATURES = 1000;

function mapFeatureIdempotencyMigrationRequired() {
  return NextResponse.json({
    error: "Aplicá la migración 025 para habilitar reintentos seguros de infraestructura del mapa.",
    code: "map_feature_idempotency_migration_required",
    migration: "supabase/025_map_feature_idempotency.sql",
  }, { status: 503 });
}

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const queryResult = await withTimeout(
    db
      .from("map_features")
      .select("*", { count: "exact" })
      .eq("farm_id", result.farmId)
      .order("created_at")
      .limit(MAX_MAP_FEATURES + 1),
    SUPABASE_READ_TIMEOUT_MS,
    null,
  );
  if (!queryResult) return NextResponse.json({ error: "Los elementos del mapa tardaron demasiado. Intentá nuevamente." }, { status: 504 });
  const { data, count, error } = queryResult;

  if (error) return databaseFailure("map features GET", error);
  const page = splitPage(data || [], MAX_MAP_FEATURES);
  const response = NextResponse.json(page.items);
  response.headers.set("X-CampoAI-Map-Features-Limit", String(MAX_MAP_FEATURES));
  if (page.hasMore || (count ?? 0) > MAX_MAP_FEATURES) response.headers.set("X-CampoAI-Map-Features-Truncated", "true");
  return response;
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req, 320_000);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const idempotencyKey = parseIdempotencyKey(req.headers.get("idempotency-key"));
  if (idempotencyKey === false) return NextResponse.json({ error: "Idempotency-Key inválida" }, { status: 400 });
  const featureTypes = new Set(["road", "portera", "aguada", "alambrado", "manga", "custom"]);
  if (typeof body.type !== "string" || !featureTypes.has(body.type)) return NextResponse.json({ error: "type inválido" }, { status: 400 });
  if (!body.geometry || typeof body.geometry !== "object" || Array.isArray(body.geometry) || typeof (body.geometry as { type?: unknown }).type !== "string" || !("coordinates" in body.geometry)) return NextResponse.json({ error: "geometry GeoJSON inválida" }, { status: 400 });
  if (JSON.stringify(body.geometry).length > 200_000 || (body.properties && JSON.stringify(body.properties).length > 50_000)) return NextResponse.json({ error: "map feature demasiado grande" }, { status: 413 });
  const db = getSupabaseAdmin();
  if (idempotencyKey) {
    const existingLookup = await withTimeout(
      db.from("map_features").select("*").eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!existingLookup) return NextResponse.json({ error: "El mapa tardó demasiado al verificar el reintento." }, { status: 504 });
    if (existingLookup.error?.code === "PGRST204" || existingLookup.error?.code === "PGRST205") return mapFeatureIdempotencyMigrationRequired();
    if (existingLookup.error) return databaseFailure("map features idempotency lookup", existingLookup.error);
    if (existingLookup.data) return NextResponse.json(existingLookup.data);
  }
  const { data, error } = await db
    .from("map_features")
    .insert({
      farm_id: result.farmId,
      type: body.type,
      name: body.name || null,
      geometry: body.geometry,
      properties: body.properties || {},
      ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    })
    .select()
    .single();

  if (error?.code === "PGRST204" && idempotencyKey) return mapFeatureIdempotencyMigrationRequired();
  if (error?.code === "23505" && idempotencyKey) {
    const replay = await withTimeout(
      db.from("map_features").select("*").eq("farm_id", result.farmId).eq("idempotency_key", idempotencyKey).maybeSingle(),
      SUPABASE_READ_TIMEOUT_MS,
      null,
    );
    if (!replay) return NextResponse.json({ error: "El mapa tardó demasiado al resolver el reintento." }, { status: 504 });
    if (replay.error) return databaseFailure("map features idempotency replay", replay.error);
    if (replay.data) return NextResponse.json(replay.data);
  }
  if (error) return databaseFailure("map features POST", error);
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  if (typeof body.id !== "string" || !body.id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("map_features")
    .update({ name: body.name, properties: body.properties })
    .eq("id", body.id)
    .eq("farm_id", result.farmId)
    .select()
    .single();

  if (error) return databaseFailure("map features PUT", error);
  return NextResponse.json(data);
}

export async function DELETE(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const { id } = parsed.data;
  if (typeof id !== "string" || !id) return NextResponse.json({ error: "id requerido" }, { status: 400 });
  const db = getSupabaseAdmin();
  const { data: deleted, error } = await db
    .from("map_features")
    .delete()
    .eq("id", id)
    .eq("farm_id", result.farmId)
    .select("id")
    .maybeSingle();

  if (error) return databaseFailure("map features DELETE", error);
  if (!deleted) return NextResponse.json({ error: "Elemento del mapa no encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
