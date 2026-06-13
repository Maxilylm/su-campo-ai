import { NextResponse } from "next/server";
import { coreEnvPresence } from "@/lib/env";

// Unauthenticated liveness/readiness probe. Reports whether the core
// integrations are configured and whether Supabase answers a cheap ping.
// Never throws — always returns JSON so uptime checks get a clean signal.
export async function GET() {
  const presence = coreEnvPresence();
  const groq = presence.GROQ_API_KEY;

  let supabase = false;
  try {
    if (
      presence.NEXT_PUBLIC_SUPABASE_URL &&
      presence.SUPABASE_SERVICE_ROLE_KEY
    ) {
      // Lazy import so a missing env var can't crash this endpoint at module load.
      const { getSupabaseAdmin } = await import("@/lib/supabase");
      const db = getSupabaseAdmin();
      // Cheap HEAD count against a known table — confirms the DB is reachable.
      const { error } = await db
        .from("farms")
        .select("id", { count: "exact", head: true });
      supabase = !error;
    }
  } catch {
    supabase = false;
  }

  const ok = supabase && groq;
  return NextResponse.json(
    { ok, supabase, groq },
    { status: ok ? 200 : 503 }
  );
}
