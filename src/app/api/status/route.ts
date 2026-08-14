import { NextResponse } from "next/server";
import { coreEnvPresence } from "@/lib/env";

const SUPABASE_PING_TIMEOUT_MS = 3000;

export const dynamic = "force-dynamic";

// Unauthenticated liveness/readiness probe. Reports whether the core
// integrations are configured and whether Supabase answers a cheap ping.
// Never throws — always returns JSON so uptime checks get a clean signal.
export async function GET() {
  const presence = coreEnvPresence();
  const groq = presence.GROQ_API_KEY;

  let supabase = false;
  let supabaseReason: "ok" | "missing_env" | "query_error" | "timeout" = "missing_env";
  try {
    if (
      presence.NEXT_PUBLIC_SUPABASE_URL &&
      presence.SUPABASE_SERVICE_ROLE_KEY
    ) {
      supabaseReason = "query_error";
      // Lazy import so a missing env var can't crash this endpoint at module load.
      const { getSupabaseAdmin } = await import("@/lib/supabase");
      const db = getSupabaseAdmin();
      // Cheap HEAD count against a known table — confirms the DB is reachable.
      const ping = await Promise.race([
        Promise.resolve(db.from("farms").select("id", { count: "exact", head: true }))
          .then(({ error }) => (error ? { type: "query_error" as const } : { type: "ok" as const }))
          .catch(() => ({ type: "query_error" as const })),
        new Promise<{ type: "timeout" }>((resolve) =>
          setTimeout(() => resolve({ type: "timeout" }), SUPABASE_PING_TIMEOUT_MS)
        ),
      ]);
      supabaseReason = ping.type;
      supabase = ping.type === "ok";
    }
  } catch {
    supabase = false;
    supabaseReason = "query_error";
  }

  const ok = supabase && groq;
  return NextResponse.json(
    { ok, supabase, groq, supabaseReason },
    { status: ok ? 200 : 503 }
  );
}
