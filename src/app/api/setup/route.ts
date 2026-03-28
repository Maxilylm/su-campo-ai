import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase";

export async function POST(req: NextRequest) {
  try {
    const { name, phone } = await req.json();

    if (!phone) {
      return NextResponse.json(
        { error: "Phone number required" },
        { status: 400 }
      );
    }

    const db = getSupabaseAdmin();

    // Check if farm already exists for this phone
    const { data: existing } = await db
      .from("farms")
      .select("*")
      .eq("owner_phone", phone)
      .single();

    if (existing) {
      return NextResponse.json(existing);
    }

    // Create new farm
    const { data: farm, error } = await db
      .from("farms")
      .insert({
        name: name || "Mi Campo",
        owner_phone: phone,
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
