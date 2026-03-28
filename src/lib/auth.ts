import { getSupabaseServer } from "./supabase-server";
import { getSupabaseAdmin } from "./supabase";

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
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

// Helper: require farm or return 401/404 response
export async function requireFarm(): Promise<{ farmId: string } | { error: Response }> {
  const user = await getAuthUser();
  if (!user) {
    const { NextResponse } = await import("next/server");
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const db = getSupabaseAdmin();
  const { data: farm } = await db
    .from("farms")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (!farm) {
    const { NextResponse } = await import("next/server");
    return { error: NextResponse.json({ error: "No farm found. Create one first." }, { status: 404 }) };
  }

  return { farmId: farm.id };
}
