import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAuthState, getFarmAccessForUser } from "@/lib/auth";
import { canWriteFarm } from "@/lib/farm-access";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";
import { withTimeout } from "@/lib/timeout";
import { validateFarmProfileInput } from "@/lib/farm-input";

const FARM_QUERY_TIMEOUT_MS = 5000;
const FARM_ACTIVITY_TIMEOUT_MS = 2000;

function farmTimeoutResponse() {
  return NextResponse.json({ error: "La conexión con la base de datos tardó demasiado. Intentá nuevamente." }, { status: 504 });
}

function boundedFarmQuery<T>(operation: PromiseLike<T>, timeoutMs = FARM_QUERY_TIMEOUT_MS): Promise<T | null> {
  return withTimeout(operation, timeoutMs, null);
}

// GET: return the authenticated user's farm (or null)
export async function GET() {
  const auth = await getAuthState();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: auth.unavailable ? "Authentication service unavailable" : "Unauthorized" }, { status: auth.unavailable ? 503 : 401 });
  }

  const accessResult = await getFarmAccessForUser(user.id);
  if (accessResult.error) return NextResponse.json({ error: "No se pudo cargar el campo." }, { status: 503 });
  if (!accessResult.access) return NextResponse.json({ farm: null, user: { id: user.id, email: user.email, accessRole: null } });

  const db = getSupabaseAdmin();
  const farmResult = await boundedFarmQuery(db.from("farms").select("*").eq("id", accessResult.access.farmId).single());
  if (!farmResult) return farmTimeoutResponse();
  const { data: farm, error } = farmResult;

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: "No se pudo cargar el campo." }, { status: 503 });
  }

  return NextResponse.json({ farm: farm || null, user: { id: user.id, email: user.email, accessRole: accessResult.access.role } });
}

// POST: create a farm for the authenticated user
export async function POST(req: NextRequest) {
  const auth = await getAuthState();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: auth.unavailable ? "Authentication service unavailable" : "Unauthorized" }, { status: auth.unavailable ? 503 : 401 });
  }

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const validated = validateFarmProfileInput(parsed.data, "create");
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  const { name, totalHectares: hectares, location, operationType } = validated.value;

  const db = getSupabaseAdmin();

  // Check if user already owns or belongs to a farm.
  const existingAccess = await getFarmAccessForUser(user.id);
  if (existingAccess.error) return NextResponse.json({ error: "No se pudo verificar el campo actual." }, { status: 503 });
  const existingResult = existingAccess.access
    ? await boundedFarmQuery(db.from("farms").select("*").eq("id", existingAccess.access.farmId).single())
    : { data: null, error: null };
  if (!existingResult) return farmTimeoutResponse();
  const { data: existing, error: existingError } = existingResult;

  if (existingError && existingError.code !== "PGRST116") {
    return databaseFailure("farm lookup", existingError);
  }

  if (existing) {
    return NextResponse.json({ farm: existing, user: { id: user.id, email: user.email, accessRole: existingAccess.access?.role || "owner" } });
  }

  const farmResult = await boundedFarmQuery(db
    .from("farms")
    .insert({
      name: name || "Mi Campo",
      user_id: user.id,
      owner_phone: user.phone || `web-${user.id}`,
      total_hectares: hectares,
      location: location || null,
      operation_type: operationType || "livestock",
    })
    .select()
    .single());
  if (!farmResult) return farmTimeoutResponse();
  const { data: farm, error } = farmResult;

  if (error) {
    return databaseFailure("farm POST", error);
  }

  const membershipResult = await boundedFarmQuery(db.from("farm_members").insert({
    farm_id: farm.id,
    user_id: user.id,
    email: user.email || null,
    role: "owner",
  }), FARM_ACTIVITY_TIMEOUT_MS);
  if (!membershipResult || (membershipResult.error && membershipResult.error.code !== "PGRST205")) {
    console.warn("farm POST membership setup:", membershipResult?.error?.message || "migration 031 not applied");
  }

  const activityResult = await boundedFarmQuery(db.from("activities").insert({
    farm_id: farm.id,
    type: "setup",
    description: "Creó el campo " + farm.name,
    message_type: "text",
    reported_by: user.email || user.id,
    metadata: { source: "farm_profile", action: "created" },
  }), FARM_ACTIVITY_TIMEOUT_MS);
  if (!activityResult || activityResult.error) console.warn("farm POST activity log:", activityResult?.error?.message || "timed out");

  return NextResponse.json({ farm });
}

// PUT: update the authenticated user's farm profile.
export async function PUT(req: NextRequest) {
  const auth = await getAuthState();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: auth.unavailable ? "Authentication service unavailable" : "Unauthorized" }, { status: auth.unavailable ? 503 : 401 });
  }

  const parsed = await parseJsonBody(req);
  if ("error" in parsed) return parsed.error;
  const validated = validateFarmProfileInput(parsed.data, "update");
  if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });
  const body = validated.value;
  const update: Record<string, string | number | null> = {};

  if (Object.prototype.hasOwnProperty.call(body, "name")) update.name = body.name ?? null;
  if (Object.prototype.hasOwnProperty.call(body, "totalHectares")) update.total_hectares = body.totalHectares ?? null;
  if (Object.prototype.hasOwnProperty.call(body, "location")) update.location = body.location ?? null;
  if (Object.prototype.hasOwnProperty.call(body, "operationType")) update.operation_type = body.operationType ?? null;

  const accessResult = await getFarmAccessForUser(user.id);
  if (accessResult.error) return NextResponse.json({ error: "No se pudo verificar el campo." }, { status: 503 });
  if (!accessResult.access) return NextResponse.json({ error: "No hay un campo configurado." }, { status: 404 });
  if (!canWriteFarm(accessResult.access.role)) return NextResponse.json({ error: "Tu acceso es de solo lectura para este campo.", code: "farm_read_only" }, { status: 403 });

  const db = getSupabaseAdmin();
  const existingResult = await boundedFarmQuery(db.from("farms").select("id").eq("id", accessResult.access.farmId).single());
  if (!existingResult) return farmTimeoutResponse();
  const { data: existing, error: existingError } = existingResult;

  if (existingError && existingError.code !== "PGRST116") return databaseFailure("farm update lookup", existingError);
  if (!existing) return NextResponse.json({ error: "No hay un campo configurado." }, { status: 404 });
  if (Object.keys(update).length === 0) return NextResponse.json({ error: "No hay cambios para guardar." }, { status: 400 });

  const farmResult = await boundedFarmQuery(db
    .from("farms")
    .update(update)
    .eq("id", existing.id)
    .select()
    .single());
  if (!farmResult) return farmTimeoutResponse();
  const { data: farm, error } = farmResult;

  if (error) return databaseFailure("farm PUT", error);

  const activityResult = await boundedFarmQuery(db.from("activities").insert({
    farm_id: farm.id,
    type: "setup",
    description: "Actualizó los datos generales del campo",
    message_type: "text",
    reported_by: user.email || user.id,
    metadata: { source: "farm_profile", action: "updated", fields: Object.keys(update) },
  }), FARM_ACTIVITY_TIMEOUT_MS);
  if (!activityResult || activityResult.error) console.warn("farm PUT activity log:", activityResult?.error?.message || "timed out");

  return NextResponse.json({ farm });
}
