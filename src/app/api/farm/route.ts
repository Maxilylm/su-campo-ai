import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";
import { getAuthUser } from "@/lib/auth";

// GET: return the authenticated user's farm (or null)
export async function GET() {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getSupabaseAdmin();
  const { data: farm } = await db
    .from("farms")
    .select("*")
    .eq("user_id", user.id)
    .single();

  return NextResponse.json({ farm: farm || null, user: { id: user.id, email: user.email } });
}

// POST: create a farm for the authenticated user
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { name, totalHectares, location, operationType } = await req.json();

  const db = getSupabaseAdmin();

  // Check if user already has a farm
  const { data: existing } = await db
    .from("farms")
    .select("*")
    .eq("user_id", user.id)
    .single();

  if (existing) {
    return NextResponse.json({ farm: existing });
  }

  const { data: farm, error } = await db
    .from("farms")
    .insert({
      name: name || "Mi Campo",
      user_id: user.id,
      owner_phone: user.phone || `web-${user.id}`,
      total_hectares: totalHectares || null,
      location: location || null,
      operation_type: operationType || "livestock",
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ farm });
}
