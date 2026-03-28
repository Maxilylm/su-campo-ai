import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { name, userId } = await req.json();

    if (!userId) {
      return NextResponse.json(
        { error: "userId required" },
        { status: 400 }
      );
    }

    const db = getSupabaseAdmin();

    // Check if user already has a farm
    const { data: existing } = await db
      .from("farms")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (existing) {
      return NextResponse.json(existing);
    }

    // Create new farm linked to user
    const { data: farm, error } = await db
      .from("farms")
      .insert({
        name: name || "Mi Campo",
        user_id: userId,
        owner_phone: "",
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json(farm);
  } catch (error) {
    console.error("Setup error:", error);
    return NextResponse.json(
      { error: "Setup failed" },
      { status: 500 }
    );
  }
}
