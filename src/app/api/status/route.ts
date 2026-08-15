import { NextResponse } from "next/server";
import { coreEnvPresence } from "@/lib/env";
import { withTimeout } from "@/lib/timeout";
import { classifyAuthProbe, classifySchemaProbe, classifyTasksProbe, coreServicesReady, healthCacheHeaders, HEALTH_CHECKED_AT_HEADER, missingSchemaMigrations, normalizeSchemaProbeReason, schemaFeatureAvailable, type AuthProbeReason, type SchemaProbeResult, type SupabaseErrorLike } from "@/lib/service-status";

const SUPABASE_PING_TIMEOUT_MS = 3000;
const PROBE_FARM_ID = "00000000-0000-0000-0000-000000000000";
const PROBE_CATTLE_ID = "00000000-0000-0000-0000-000000000001";
const PROBE_SECTION_ID = "00000000-0000-0000-0000-000000000002";
type SupabaseProbeClient = {
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error: { code?: string; message?: string } | null }>;
};
type SchemaProbeTask = {
  migration: string;
  run: () => PromiseLike<SupabaseErrorLike | null | undefined>;
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
    const { error } = await withTimeout(
      db.rpc(name, args),
      SUPABASE_PING_TIMEOUT_MS,
      { error: { code: "TIMEOUT", message: `${name} probe timed out` } },
    );
    if (error?.code === "TIMEOUT") return error;
    return missingFunctionProbe(error);
  } catch {
    return { code: "QUERY_ERROR", message: `${name} probe failed` };
  }
}

/** Keep optional schema diagnostics from opening one connection per probe. */
async function runSchemaProbeTasks(tasks: readonly SchemaProbeTask[], concurrency: number): Promise<SchemaProbeResult[]> {
  const results = new Array<SchemaProbeResult>(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= tasks.length) return;
      const task = tasks[index];
      results[index] = { migration: task.migration, error: await task.run() };
    }
  }

  const workerCount = Math.max(1, Math.min(Math.floor(concurrency) || 1, tasks.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
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
  let chatRetriesReason = classifySchemaProbe([], false, false);
  let sampleDataReason = classifySchemaProbe([], false, false);
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
      const pingPromise = withTimeout<{ type: "ok" | "query_error" | "timeout" }>(
        Promise.resolve(db.from("farms").select("id", { head: true }).limit(1))
          .then(({ error }) => (error ? { type: "query_error" as const } : { type: "ok" as const }))
          .catch(() => ({ type: "query_error" as const })),
        SUPABASE_PING_TIMEOUT_MS,
        { type: "timeout" as const },
      );
      const [ping, tasksProbe, schemaProbe, authProbe, chatRetryProbe, sampleDataProbe] = await Promise.all([
        pingPromise,
        withTimeout<{ error: SupabaseErrorLike | null; timedOut: boolean }>(
          Promise.resolve(db.from("tasks").select("id", { head: true }).limit(1))
            .then(({ error }) => ({ error: error || null, timedOut: false as const }))
            .catch(() => ({ error: { message: "tasks query failed" }, timedOut: false as const })),
          SUPABASE_PING_TIMEOUT_MS,
          { error: null, timedOut: true as const },
        ),
        pingPromise.then((pingResult) => {
          if (pingResult.type !== "ok") return { probes: [] as SchemaProbeResult[], timedOut: false };
          return withTimeout<{ probes: SchemaProbeResult[]; timedOut: boolean }>(
            runSchemaProbeTasks([
            { migration: "supabase/016_cattle_ear_tags.sql", run: () => Promise.resolve(db.from("cattle").select("ear_tag", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "cattle schema query failed" })) },
            { migration: "supabase/013_inventory_currency.sql", run: () => Promise.resolve(db.from("inventory_items").select("currency", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "inventory item schema query failed" })) },
            { migration: "supabase/013_inventory_currency.sql", run: () => Promise.resolve(db.from("inventory_movements").select("currency", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "inventory movement schema query failed" })) },
            { migration: "supabase/015_financial_inventory_links.sql", run: () => Promise.resolve(db.from("financial_transactions").select("inventory_movement_id", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "financial schema query failed" })) },
            { migration: "supabase/017_idempotency.sql", run: () => Promise.resolve(db.from("inventory_movements").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "inventory idempotency schema query failed" })) },
            { migration: "supabase/017_idempotency.sql", run: () => Promise.resolve(db.from("weight_records").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "weight idempotency schema query failed" })) },
            { migration: "supabase/019_padron_idempotency.sql", run: () => Promise.resolve(db.from("padrones").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "padron idempotency schema query failed" })) },
            { migration: "supabase/020_import_idempotency.sql", run: () => Promise.resolve(db.from("cattle").select("import_batch_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "cattle import idempotency schema query failed" })) },
            { migration: "supabase/020_import_idempotency.sql", run: () => Promise.resolve(db.from("inventory_items").select("import_batch_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "inventory import idempotency schema query failed" })) },
            { migration: "supabase/020_import_idempotency.sql", run: () => Promise.resolve(db.from("financial_transactions").select("import_batch_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "financial import idempotency schema query failed" })) },
            // Tasks are optional: an absent tasks table is handled by the
            // dedicated tasks probe, but an existing table without its retry
            // key should be reported as a pending migration.
            { migration: "supabase/022_task_idempotency.sql", run: () => Promise.resolve(db.from("tasks").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error?.code === "PGRST205" ? null : error || null).catch(() => ({ code: "QUERY_ERROR", message: "tasks idempotency schema query failed" })) },
            { migration: "supabase/023_financial_idempotency.sql", run: () => Promise.resolve(db.from("financial_transactions").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error?.code === "PGRST205" ? { code: "QUERY_ERROR", message: "financial transactions table missing" } : error || null).catch(() => ({ code: "QUERY_ERROR", message: "financial idempotency schema query failed" })) },
            { migration: "supabase/024_operational_idempotency.sql", run: () => Promise.resolve(db.from("crops").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "crops idempotency schema query failed" })) },
            { migration: "supabase/024_operational_idempotency.sql", run: () => Promise.resolve(db.from("crop_applications").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "crop applications idempotency schema query failed" })) },
            { migration: "supabase/024_operational_idempotency.sql", run: () => Promise.resolve(db.from("vaccinations").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "vaccinations idempotency schema query failed" })) },
            { migration: "supabase/024_operational_idempotency.sql", run: () => Promise.resolve(db.from("health_events").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "health events idempotency schema query failed" })) },
            { migration: "supabase/025_map_feature_idempotency.sql", run: () => Promise.resolve(db.from("map_features").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "map features idempotency schema query failed" })) },
            { migration: "supabase/019_padron_idempotency.sql", run: () => probeFunction(db, "create_padron_with_section", {
              p_farm_id: PROBE_FARM_ID,
              p_padron_code: "",
              p_padron_number: 0,
              p_geometry: { type: "Point", coordinates: [0, 0] },
              p_idempotency_key: null,
            }) },
            { migration: "supabase/018_padron_transaction.sql", run: () => probeFunction(db, "create_padron_with_section", {
              p_farm_id: PROBE_FARM_ID,
              p_padron_code: "",
              p_padron_number: 0,
              p_geometry: { type: "Point", coordinates: [0, 0] },
            }) },
            { migration: "supabase/021_cattle_move_transaction.sql", run: () => probeFunction(db, "move_cattle", {
              p_farm_id: PROBE_FARM_ID,
              p_source_cattle_id: PROBE_CATTLE_ID,
              p_destination_section_id: PROBE_SECTION_ID,
              p_move_count: 0,
            }) },
            { migration: "supabase/029_hacienda_idempotency.sql", run: () => Promise.resolve(db.from("sections").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "sections idempotency schema query failed" })) },
            { migration: "supabase/029_hacienda_idempotency.sql", run: () => Promise.resolve(db.from("cattle").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "cattle idempotency schema query failed" })) },
            { migration: "supabase/030_inventory_item_idempotency.sql", run: () => Promise.resolve(db.from("inventory_items").select("idempotency_key", { head: true }).limit(1)).then(({ error }) => error || null).catch(() => ({ code: "QUERY_ERROR", message: "inventory item idempotency schema query failed" })) },
            ], 6).then((probes) => ({ probes, timedOut: false })),
            SUPABASE_PING_TIMEOUT_MS,
            { probes: [] as SchemaProbeResult[], timedOut: true as const },
          );
        }),
        withTimeout<{ type: AuthProbeReason }>(
          Promise.resolve(db.auth.getUser())
            .then(({ error }) => ({ type: classifyAuthProbe(error || null) }))
            .catch(() => ({ type: "query_error" as const })),
          SUPABASE_PING_TIMEOUT_MS,
          { type: "timeout" as const },
        ),
        withTimeout<{ error: SupabaseErrorLike | null; timedOut: boolean }>(
          Promise.resolve(db.from("chat_requests").select("request_id", { head: true }).limit(1))
            .then(({ error }) => ({ error: error || null, timedOut: false as const }))
            .catch(() => ({ error: { code: "QUERY_ERROR", message: "chat retry schema query failed" }, timedOut: false as const })),
          SUPABASE_PING_TIMEOUT_MS,
          { error: null, timedOut: true as const },
        ),
        withTimeout<{ error: SupabaseErrorLike | null; timedOut: boolean }>(
          Promise.resolve(db.from("sample_data_requests").select("request_id", { head: true }).limit(1))
            .then(({ error }) => ({ error: error || null, timedOut: false as const }))
            .catch(() => ({ error: { code: "QUERY_ERROR", message: "sample data schema query failed" }, timedOut: false as const })),
          SUPABASE_PING_TIMEOUT_MS,
          { error: null, timedOut: true as const },
        ),
      ]);
      supabaseReason = ping.type;
      supabase = ping.type === "ok";
      authReason = authProbe.type;
      auth = authProbe.type === "ok";
      tasksReason = classifyTasksProbe(tasksProbe.error, tasksProbe.timedOut);
      schemaReason = classifySchemaProbe(schemaProbe.probes.map(({ error }) => error), schemaProbe.timedOut);
      missingMigrations = missingSchemaMigrations(schemaProbe.probes);
      chatRetriesReason = classifySchemaProbe(
        chatRetryProbe.error ? [chatRetryProbe.error] : [],
        chatRetryProbe.timedOut,
      );
      sampleDataReason = classifySchemaProbe(
        sampleDataProbe.error ? [sampleDataProbe.error] : [],
        sampleDataProbe.timedOut,
      );
    }
  } catch {
    supabase = false;
    auth = false;
    supabaseReason = "query_error";
    authReason = "query_error";
    tasksReason = "query_error";
    schemaReason = "query_error";
    chatRetriesReason = "query_error";
    sampleDataReason = "query_error";
    missingMigrations = [];
  }

  schemaReason = normalizeSchemaProbeReason(schemaReason, missingMigrations);
  const ok = coreServicesReady(supabase, auth, groq, schemaReason, missingMigrations);
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
        schema: { available: schemaFeatureAvailable(schemaReason, missingMigrations), reason: schemaReason, missingMigrations },
        chatRetries: { available: chatRetriesReason === "ok", reason: chatRetriesReason },
        sampleData: { available: sampleDataReason === "ok", reason: sampleDataReason },
      },
    },
    {
      status: ok ? 200 : 503,
      headers: {
        // The probe is intentionally public and contains no farm data. Cache
        // healthy results briefly, but never let an edge-cached 503 make a
        // recovered Supabase instance look unhealthy.
        ...healthCacheHeaders(ok),
        "X-Robots-Tag": "noindex, nofollow",
        [HEALTH_CHECKED_AT_HEADER]: new Date().toISOString(),
      },
    }
  );
}
