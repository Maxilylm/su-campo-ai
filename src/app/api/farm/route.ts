import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAuthState } from "@/lib/auth";
import { parseJsonBody } from "@/lib/request";
import { databaseFailure } from "@/lib/api-error";

// GET: return the authenticated user's farm (or null)
export async function GET() {
  const auth = await getAuthState();
  const user = auth.user;
  if (!user) {
    return NextResponse.json({ error: auth.unavailable ? "Authentication service unavailable" : "Unauthorized" }, { status: auth.unavailable ? 503 : 401 });
  }

  const db = getSupabaseAdmin();
  const { data: farm, error } = await db
    .from("farms")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    return NextResponse.json({ error: "No se pudo cargar el campo." }, { status: 503 });
  }

  return NextResponse.json({ farm: farm || null, user: { id: user.id, email: user.email } });
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
  const { name, totalHectares, location, operationType } = parsed.data;

  const hectares = totalHectares == null || totalHectares === "" ? null : Number(totalHectares);
  if (name != null && (typeof name !== "string" || name.trim().length > 200)) return NextResponse.json({ error: "name inválido" }, { status: 400 });
  if (hectares !== null && (!Number.isFinite(hectares) || hectares < 0)) return NextResponse.json({ error: "totalHectares inválido" }, { status: 400 });
  if (operationType != null && !["livestock", "crops", "mixed"].includes(String(operationType))) return NextResponse.json({ error: "operationType inválido" }, { status: 400 });

  const db = getSupabaseAdmin();

  // Check if user already has a farm
  const { data: existing, error: existingError } = await db
    .from("farms")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (existingError && existingError.code !== "PGRST116") {
    return databaseFailure("farm lookup", existingError);
  }

  if (existing) {
    return NextResponse.json({ farm: existing });
  }

  const { data: farm, error } = await db
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
    .single();

  if (error) {
    return databaseFailure("farm POST", error);
  }

  return NextResponse.json({ farm });
}
