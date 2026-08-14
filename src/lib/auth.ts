import { getSupabaseServer } from "./supabase-server";
import { getSupabaseAdmin } from "./supabase";
import { NextResponse } from "next/server";

const AUTH_LOOKUP_TIMEOUT_MS = 3000;

type FarmRelationTable = "sections" | "crops" | "cattle" | "inventory_movements" | "inventory_items";

export type FarmRelationValidation =
  | { ok: true }
  | { ok: false; table: FarmRelationTable; unavailable: boolean };

/**
 * Service-role API routes must validate every foreign key themselves. RLS is
 * bypassed by design, so a valid UUID alone is never enough to prove that a
 * related record belongs to the current farm.
 */
export async function validateFarmRelations(
  farmId: string,
  relations: Array<{ table: FarmRelationTable; id: unknown }>
): Promise<FarmRelationValidation> {
  const db = getSupabaseAdmin();

  for (const relation of relations) {
    if (relation.id == null || relation.id === "") continue;
    if (typeof relation.id !== "string") {
      return { ok: false, table: relation.table, unavailable: false };
    }

    const { data, error } = await db
      .from(relation.table)
      .select("id")
      .eq("id", relation.id)
      .eq("farm_id", farmId)
      .maybeSingle();

    if (error) return { ok: false, table: relation.table, unavailable: true };
    if (!data) return { ok: false, table: relation.table, unavailable: false };
  }

  return { ok: true };
}

export function farmRelationError(validation: Exclude<FarmRelationValidation, { ok: true }>) {
  return NextResponse.json(
    { error: validation.unavailable ? "No se pudieron validar las referencias." : "Referencia no válida para este campo." },
    { status: validation.unavailable ? 503 : 400 }
  );
}

// Get the authenticated user's farm ID from their session
export async function getAuthFarmId(): Promise<string | null> {
  const user = await getAuthUser();
  if (!user) return null;

  const db = getSupabaseAdmin();
  const { data: farm } = await db
    .from("farms")
    .select("id")
    .eq("user_id", user.id)
    .single();

  return farm?.id ?? null;
}

// Get the authenticated user or return null
export async function getAuthUser() {
  const state = await getAuthState();
  return state.user;
}

/** Distinguishes an absent session from an unavailable Supabase Auth service. */
export async function getAuthState() {
  try {
    const supabase = await getSupabaseServer();
    const result = await Promise.race([
      Promise.resolve(supabase.auth.getUser())
        .then(({ data: { user }, error }) => ({
          user,
          unavailable: Boolean(error && error.name !== "AuthSessionMissingError" && error.status !== 401),
        }))
        .catch(() => ({ user: null, unavailable: true })),
      new Promise<{ user: null; unavailable: true }>((resolve) =>
        setTimeout(() => resolve({ user: null, unavailable: true }), AUTH_LOOKUP_TIMEOUT_MS)
      ),
    ]);
    return result;
  } catch {
    return { user: null, unavailable: true };
  }
}

// Helper: require farm or return 401/404 response
export async function requireFarm(): Promise<{ farmId: string } | { error: Response }> {
  const auth = await getAuthState();
  const user = auth.user;
  if (!user) {
    return {
      error: NextResponse.json(
        { error: auth.unavailable ? "Authentication service unavailable" : "Unauthorized" },
        { status: auth.unavailable ? 503 : 401 }
      ),
    };
  }

  const db = getSupabaseAdmin();
  const { data: farm, error } = await db
    .from("farms")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (error && error.code !== "PGRST116") {
    return { error: NextResponse.json({ error: "Database unavailable" }, { status: 503 }) };
  }
  if (!farm) {
    return { error: NextResponse.json({ error: "No farm found. Create one first." }, { status: 404 }) };
  }

  return { farmId: farm.id };
}
