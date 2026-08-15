import { NextResponse } from "next/server";
import { coreEnvPresence } from "@/lib/env";
import { classifyAuthProbe, classifySchemaProbe, classifyTasksProbe, HEALTH_CHECKED_AT_HEADER, isMissingSchemaElement } from "@/lib/service-status";

const SUPABASE_PING_TIMEOUT_MS = 3000;

export const dynamic = "force-dynamic";

// Unauthenticated liveness/readiness probe. Reports whether the core
// integrations are configured and whether Supabase answers a cheap ping.
// Never throws — always returns JSON so uptime checks get a clean signal.
export async function GET() {
  const presence = coreEnvPresence();
  const groq = presence.GROQ_API_KEY;
  const groqReason = groq ? "ok" : "missing_env";

  let supabase = false;
  let auth = false;
  let supabaseReason: "ok" | "missing_env" | "query_error" | "timeout" = "missing_env";
  let authReason: "ok" | "missing_env" | "query_error" | "timeout" = "missing_env";
  let tasksReason = classifyTasksProbe(null, false, false);
  let schemaReason = classifySchemaProbe([], false, false);
  let missingMigrations: string[] = [];
  try {
    if (
      presence.NEXT_PUBLIC_SUPABASE_URL &&
      presence.SUPABASE_SERVICE_ROLE_KEY
    ) {
      supabaseReason = "query_error";
      // Lazy import so a missing env var can't crash this endpoint at module load.
      const { getSupabaseAdmin } = await import("@/lib/supabase");
      const db = getSupabaseAdmin();
      // Bounded HEAD queries — one confirms the DB is reachable, the others
      // expose common schema drift before it surfaces as a generic 500. Avoid
      // count: "exact" here: counting a whole table turns a liveness probe
      // into a potentially expensive query and can create false timeouts.
      const [ping, tasksProbe, schemaProbe, authProbe] = await Promise.all([
        Promise.race([
        Promise.resolve(db.from("farms").select("id", { head: true }).limit(1))
          .then(({ error }) => (error ? { type: "query_error" as const } : { type: "ok" as const }))
          .catch(() => ({ type: "query_error" as const })),
        new Promise<{ type: "timeout" }>((resolve) =>
          setTimeout(() => resolve({ type: "timeout" }), SUPABASE_PING_TIMEOUT_MS)
        ),
        ]),
        Promise.race([
          Promise.resolve(db.from("tasks").select("id", { head: true }).limit(1))
            .then(({ error }) => ({ error: error || null, timedOut: false }))
            .catch(() => ({ error: { message: "tasks query failed" }, timedOut: false })),
          new Promise<{ error: null; timedOut: true }>((resolve) =>
            setTimeout(() => resolve({ error: null, timedOut: true }), SUPABASE_PING_TIMEOUT_MS)
          ),
        ]),
        Promise.race([
          Promise.all([
            Promise.resolve(db.from("cattle").select("ear_tag", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "cattle schema query failed" })),
            Promise.resolve(db.from("inventory_items").select("currency", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "inventory item schema query failed" })),
            Promise.resolve(db.from("inventory_movements").select("currency", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "inventory movement schema query failed" })),
            Promise.resolve(db.from("financial_transactions").select("inventory_movement_id", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "financial schema query failed" })),
          ]).then((errors) => ({ errors, timedOut: false })),
          new Promise<{ errors: Array<{ code: string; message: string }>; timedOut: true }>((resolve) =>
            setTimeout(() => resolve({ errors: [], timedOut: true }), SUPABASE_PING_TIMEOUT_MS)
          ),
        ]),
        Promise.race([
          Promise.resolve(db.auth.getUser())
            .then(({ error }) => ({ type: classifyAuthProbe(error || null) }))
            .catch(() => ({ type: "query_error" as const })),
          new Promise<{ type: "timeout" }>((resolve) =>
            setTimeout(() => resolve({ type: "timeout" }), SUPABASE_PING_TIMEOUT_MS)
          ),
        ]),
      ]);
      supabaseReason = ping.type;
      supabase = ping.type === "ok";
      authReason = authProbe.type;
      auth = authProbe.type === "ok";
      tasksReason = classifyTasksProbe(tasksProbe.error, tasksProbe.timedOut);
      schemaReason = classifySchemaProbe(schemaProbe.errors, schemaProbe.timedOut);
      const migrationNames = [
        "supabase/003_expanded.sql",
        "supabase/010_integrity.sql",
        "supabase/013_inventory_currency.sql",
        "supabase/007_expansion.sql",
      ];
      missingMigrations = schemaProbe.errors
        .map((error, index) => isMissingSchemaElement(error) ? migrationNames[index] : null)
        .filter((migration): migration is string => Boolean(migration));
    }
  } catch {
    supabase = false;
    auth = false;
    supabaseReason = "query_error";
    authReason = "query_error";
    tasksReason = "query_error";
    schemaReason = "query_error";
    missingMigrations = [];
  }

  const ok = supabase && auth && groq;
  return NextResponse.json(
    {
      ok,
      supabase,
      auth,
      groq,
      groqReason,
      supabaseReason,
      authReason,
      features: {
        tasks: { available: tasksReason === "ok", reason: tasksReason },
        schema: { available: schemaReason === "ok", reason: schemaReason, missingMigrations },
      },
    },
    {
      status: ok ? 200 : 503,
      headers: {
        // The probe is intentionally public and contains no farm data. A short
        // edge cache prevents a burst of login pages or uptime checks from
        // multiplying the four Supabase/Auth probes, while keeping recovery
        // visible quickly.
        "Cache-Control": "public, max-age=15, s-maxage=30, stale-while-revalidate=60",
        "CDN-Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        "X-Robots-Tag": "noindex, nofollow",
        [HEALTH_CHECKED_AT_HEADER]: new Date().toISOString(),
      },
    }
  );
}
