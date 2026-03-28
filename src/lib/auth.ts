import { getSupabaseServer } from "./supabase-server";
import { getSupabaseAdmin } from "./supabase";

// Get the authenticated user's farm ID from their session
// Returns null if not authenticated or no farm found
export async function getAuthFarmId(): Promise<string | null> {
  const supabase = await getSupabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
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
