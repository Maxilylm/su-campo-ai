import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { requireFarm } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";

const MAX_MAP_FEATURES = 1000;

export async function GET() {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("map_features")
    .select("*")
    .eq("farm_id", result.farmId)
    .order("created_at")
    .limit(MAX_MAP_FEATURES);

  if (error) return databaseFailure("map features GET", error);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const result = await requireFarm();
  if ("error" in result) return result.error;

  const parsed = await parseJsonBody(req, 320_000);
  if ("error" in parsed) return parsed.error;
  const body = parsed.data;
  const featureTypes = new Set(["road", "portera", "aguada", "alambrado", "manga", "custom"]);
  if (typeof body.type !== "string" || !featureTypes.has(body.type)) return NextResponse.json({ error: "type inválido" }, { status: 400 });
  if (!body.geometry || typeof body.geometry !== "object" || Array.isArray(body.geometry) || typeof (body.geometry as { type?: unknown }).type !== "string" || !("coordinates" in body.geometry)) return NextResponse.json({ error: "geometry GeoJSON inválida" }, { status: 400 });
  if (JSON.stringify(body.geometry).length > 200_000 || (body.properties && JSON.stringify(body.properties).length > 50_000)) return NextResponse.json({ error: "map feature demasiado grande" }, { status: 413 });
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("map_features")
    .insert({
      farm_id: result.farmId,
      type: body.type,
      name: body.name || null,
      geometry: body.geometry,
      properties: body.properties || {},
    })
    .select()
    .single();

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
