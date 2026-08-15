import { NextResponse } from "next/server";
import { coreEnvPresence } from "@/lib/env";
import { classifyAuthProbe, classifySchemaProbe, classifyTasksProbe, coreServicesReady, HEALTH_CHECKED_AT_HEADER, missingSchemaMigrations } from "@/lib/service-status";

const SUPABASE_PING_TIMEOUT_MS = 3000;
const PROBE_FARM_ID = "00000000-0000-0000-0000-000000000000";
const PROBE_CATTLE_ID = "00000000-0000-0000-0000-000000000001";
const PROBE_SECTION_ID = "00000000-0000-0000-0000-000000000002";
type SupabaseProbeClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error: { code?: string; message?: string } | null }>;
};

export const dynamic = "force-dynamic";

function missingFunctionProbe(error: { code?: string; message?: string } | null) {
  if (!error) return null;
  if (error.code === "PGRST202" || /could not find function/i.test(error.message || "")) {
    return { code: "PGRST202", message: "required function is missing" };
  }
  // The probe intentionally calls each function with invalid input. Any
  // validation error proves the function exists and is therefore healthy.
  return null;
}

async function probeFunction(
  db: SupabaseProbeClient,
  name: string,
  args: Record<string, unknown>,
) {
  try {
    const { error } = await db.rpc(name, args);
    return missingFunctionProbe(error);
  } catch {
    return { code: "QUERY_ERROR", message: `${name} probe failed` };
  }
}

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
            Promise.resolve(db.from("inventory_movements").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "inventory idempotency schema query failed" })),
            Promise.resolve(db.from("weight_records").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "weight idempotency schema query failed" })),
            Promise.resolve(db.from("padrones").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "padron idempotency schema query failed" })),
            Promise.resolve(db.from("cattle").select("import_batch_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "cattle import idempotency schema query failed" })),
            Promise.resolve(db.from("inventory_items").select("import_batch_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "inventory import idempotency schema query failed" })),
            Promise.resolve(db.from("financial_transactions").select("import_batch_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "financial import idempotency schema query failed" })),
            // Tasks are optional: an absent tasks table is handled by the
            // dedicated tasks probe, but an existing table without its retry
            // key should be reported as a pending migration.
            Promise.resolve(db.from("tasks").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error?.code === "PGRST205" ? null : error || null).catch(() => ({ code: "QUERY_ERROR", message: "tasks idempotency schema query failed" })),
            Promise.resolve(db.from("financial_transactions").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error?.code === "PGRST205" ? { code: "QUERY_ERROR", message: "financial transactions table missing" } : error || null).catch(() => ({ code: "QUERY_ERROR", message: "financial idempotency schema query failed" })),
            Promise.resolve(db.from("crops").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "crops idempotency schema query failed" })),
            Promise.resolve(db.from("crop_applications").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "crop applications idempotency schema query failed" })),
            Promise.resolve(db.from("vaccinations").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "vaccinations idempotency schema query failed" })),
            Promise.resolve(db.from("health_events").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "health events idempotency schema query failed" })),
            probeFunction(db, "create_padron_with_section", {
              p_farm_id: PROBE_FARM_ID,
              p_padron_code: "",
              p_padron_number: 0,
              p_geometry: { type: "Point", coordinates: [0, 0] },
              p_idempotency_key: null,
            }),
            probeFunction(db, "create_padron_with_section", {
              p_farm_id: PROBE_FARM_ID,
              p_padron_code: "",
              p_padron_number: 0,
              p_geometry: { type: "Point", coordinates: [0, 0] },
            }),
            probeFunction(db, "move_cattle", {
              p_farm_id: PROBE_FARM_ID,
              p_source_cattle_id: PROBE_CATTLE_ID,
              p_destination_section_id: PROBE_SECTION_ID,
              p_move_count: 0,
            }),
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
      missingMigrations = missingSchemaMigrations(schemaProbe.errors);
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

  const ok = coreServicesReady(supabase, auth, groq, schemaReason);
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
