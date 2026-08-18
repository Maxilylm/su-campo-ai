import { NextResponse } from "next/server";
import { coreEnvPresence } from "@/lib/env";
import { createSingleFlight } from "@/lib/single-flight";
import { withTimeout } from "@/lib/timeout";
import { classifyAuthProbe, classifySchemaProbe, classifyTasksProbe, coreServicesReady, healthCacheHeaders, HEALTH_CHECKED_AT_HEADER, missingSchemaMigrations, normalizeSupabaseProbeError, normalizeSchemaProbeReason, schemaFeatureAvailable, schemaProbeIssues, type AuthProbeReason, type SchemaProbeIssue, type SchemaProbeResult, type SupabaseErrorLike } from "@/lib/service-status";

const SUPABASE_PING_TIMEOUT_MS = 3000;
const SUPABASE_SCHEMA_PROBE_TIMEOUT_MS = 6000;
const SUPABASE_SCHEMA_TASK_TIMEOUT_MS = 1200;
const SUPABASE_SCHEMA_PROBE_CONCURRENCY = 8;
const PROBE_FARM_ID = "00000000-0000-0000-0000-000000000000";
const PROBE_CATTLE_ID = "00000000-0000-0000-0000-000000000001";
const PROBE_SECTION_ID = "00000000-0000-0000-0000-000000000002";
type SupabaseProbeClient = {
  from: (table: string) => {
    select: (columns: string, options?: { head?: boolean }) => {
      limit: (count: number) => PromiseLike<{ error: SupabaseErrorLike | null }>;
    };
  };
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ error: { code?: string; message?: string } | null }>;
};
type SchemaProbeTask = {
  migration: string;
  critical?: boolean;
  run: () => PromiseLike<SupabaseErrorLike | null | undefined>;
};
type SupabasePingResult = { type: "ok" | "query_error" | "timeout" };
type SupabaseQueryProbe = { error: SupabaseErrorLike | null; timedOut: boolean };
type HealthProbeResult = { body: Record<string, unknown>; ok: boolean; checkedAt: string };

export const dynamic = "force-dynamic";

const runHealthProbeOnce = createSingleFlight<HealthProbeResult>();

function missingFunctionProbe(error: { code?: string; message?: string } | null) {
  if (!error) return null;
  if (error.code === "PGRST202" || error.code === "PGRST203" || error.code === "42883" || /could not find (?:function|procedure)/i.test(error.message || "")) {
    return { code: "PGRST202", message: "required function is missing" };
  }
  // The probe intentionally calls each function with invalid input. Any
  // validation error proves the function exists and is therefore healthy.
  return null;
}

function probeTableColumn(
  db: SupabaseProbeClient,
  table: string,
  column: string,
  fallbackMessage: string,
): PromiseLike<SupabaseErrorLike | null> {
  try {
    return Promise.resolve(db.from(table).select(column, { head: true }).limit(1))
      .then(({ error }) => error || null)
      .catch((error) => normalizeSupabaseProbeError(error, fallbackMessage));
  } catch (error) {
    return Promise.resolve(normalizeSupabaseProbeError(error, fallbackMessage));
  }
}

async function probeFunction(
  db: SupabaseProbeClient,
  name: string,
  args: Record<string, unknown>,
) {
  try {
    const { error } = await withTimeout(
      db.rpc(name, args),
      SUPABASE_SCHEMA_TASK_TIMEOUT_MS,
      { error: { code: "TIMEOUT", message: `${name} probe timed out` } },
    );
    if (error?.code === "TIMEOUT") return error;
    return missingFunctionProbe(error);
  } catch (error) {
    return normalizeSupabaseProbeError(error, `${name} probe failed`);
  }
}

/** Keep optional schema diagnostics from opening one connection per probe. */
async function runSchemaProbeTasks(
  tasks: readonly SchemaProbeTask[],
  concurrency: number,
  budgetMs: number,
): Promise<SchemaProbeResult[]> {
  const results = new Array<SchemaProbeResult>(tasks.length);
  let nextIndex = 0;
  const deadline = Date.now() + Math.max(1, budgetMs);
  const timeoutResult = (migration: string, critical = false): SchemaProbeResult => ({
    migration,
    ...(critical ? { critical } : {}),
    error: { code: "TIMEOUT", message: `${migration} probe timed out` },
  });

  async function worker() {
    while (true) {
      const index = nextIndex++;
      if (index >= tasks.length) return;
      const task = tasks[index];
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        results[index] = timeoutResult(task.migration, task.critical);
        continue;
      }
      try {
        const error = await withTimeout(
          task.run(),
          Math.min(SUPABASE_SCHEMA_TASK_TIMEOUT_MS, remaining),
          { code: "TIMEOUT", message: `${task.migration} probe timed out` },
        );
        results[index] = { migration: task.migration, ...(task.critical ? { critical: true } : {}), error };
      } catch (error) {
        results[index] = { migration: task.migration, ...(task.critical ? { critical: true } : {}), error: normalizeSupabaseProbeError(error, `${task.migration} probe failed`) };
      }
    }
  }

  const workerCount = Math.max(1, Math.min(Math.floor(concurrency) || 1, tasks.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return tasks.map((task, index) => results[index] || timeoutResult(task.migration, task.critical));
}

/** Run core schema checks independently so optional diagnostics cannot consume
 * the budget before the readiness decision is known. */
async function runSchemaProbeTasksInLanes(tasks: readonly SchemaProbeTask[]): Promise<SchemaProbeResult[]> {
  const criticalTasks = tasks.filter((task) => task.critical);
  const optionalTasks = tasks.filter((task) => !task.critical);
  const [criticalProbes, optionalProbes] = await Promise.all([
    runSchemaProbeTasks(criticalTasks, Math.min(4, criticalTasks.length || 1), 4500),
    runSchemaProbeTasks(optionalTasks, SUPABASE_SCHEMA_PROBE_CONCURRENCY, 4500),
  ]);
  return [...criticalProbes, ...optionalProbes];
}

function skippedQueryProbe(pingType: Exclude<SupabasePingResult["type"], "ok">): SupabaseQueryProbe {
  if (pingType === "timeout") return { error: null, timedOut: true };
  return { error: { code: "QUERY_ERROR", message: "Supabase ping failed" }, timedOut: false };
}

// Unauthenticated liveness/readiness probe. Reports whether the core
// integrations are configured and whether Supabase answers a cheap ping.
// Never throws — always returns JSON so uptime checks get a clean signal.
async function runHealthProbe(): Promise<HealthProbeResult> {
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
  let schemaIssues: SchemaProbeIssue[] = [];
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
      const pingPromise = withTimeout<SupabasePingResult>(
        Promise.resolve(db.from("farms").select("id", { head: true }).limit(1))
          .then(({ error }) => (error ? { type: "query_error" as const } : { type: "ok" as const }))
          .catch(() => ({ type: "query_error" as const })),
        SUPABASE_PING_TIMEOUT_MS,
        { type: "timeout" as const },
      );
      const [ping, tasksProbe, schemaProbe, authProbe, chatRetryProbe, sampleDataProbe] = await Promise.all([
        pingPromise,
        pingPromise.then((pingResult) => {
          if (pingResult.type !== "ok") return skippedQueryProbe(pingResult.type);
          return withTimeout<SupabaseQueryProbe>(
            Promise.resolve(db.from("tasks").select("id", { head: true }).limit(1))
              .then(({ error }) => ({ error: error || null, timedOut: false as const }))
              .catch((error) => ({ error: normalizeSupabaseProbeError(error, "tasks query failed"), timedOut: false as const })),
            SUPABASE_PING_TIMEOUT_MS,
            { error: null, timedOut: true as const },
          );
        }),
        pingPromise.then((pingResult) => {
          if (pingResult.type !== "ok") {
            const skipped = skippedQueryProbe(pingResult.type);
            return { probes: [{ migration: "", error: skipped.error }], timedOut: skipped.timedOut };
          }
          return withTimeout<{ probes: SchemaProbeResult[]; timedOut: boolean }>(
            runSchemaProbeTasksInLanes([
            { migration: "supabase/016_cattle_ear_tags.sql", critical: true, run: () => probeTableColumn(db, "cattle", "ear_tag", "cattle schema query failed") },
            { migration: "supabase/013_inventory_currency.sql", critical: true, run: () => probeTableColumn(db, "inventory_items", "currency", "inventory item schema query failed") },
            { migration: "supabase/013_inventory_currency.sql", critical: true, run: () => probeTableColumn(db, "inventory_movements", "currency", "inventory movement schema query failed") },
            { migration: "supabase/015_financial_inventory_links.sql", critical: true, run: () => probeTableColumn(db, "financial_transactions", "inventory_movement_id", "financial schema query failed") },
            { migration: "supabase/017_idempotency.sql", run: () => probeTableColumn(db, "inventory_movements", "idempotency_key", "inventory idempotency schema query failed") },
            { migration: "supabase/017_idempotency.sql", run: () => probeTableColumn(db, "weight_records", "idempotency_key", "weight idempotency schema query failed") },
            { migration: "supabase/019_padron_idempotency.sql", run: () => probeTableColumn(db, "padrones", "idempotency_key", "padron idempotency schema query failed") },
            { migration: "supabase/020_import_idempotency.sql", run: () => probeTableColumn(db, "cattle", "import_batch_key", "cattle import idempotency schema query failed") },
            { migration: "supabase/020_import_idempotency.sql", run: () => probeTableColumn(db, "inventory_items", "import_batch_key", "inventory import idempotency schema query failed") },
            { migration: "supabase/020_import_idempotency.sql", run: () => probeTableColumn(db, "financial_transactions", "import_batch_key", "financial import idempotency schema query failed") },
            // Tasks are optional: an absent tasks table is handled by the
            // dedicated tasks probe, but an existing table without its retry
            // key should be reported as a pending migration.
            { migration: "supabase/022_task_idempotency.sql", run: () => probeTableColumn(db, "tasks", "idempotency_key", "tasks idempotency schema query failed").then((error) => error?.code === "PGRST205" ? null : error) },
            { migration: "supabase/023_financial_idempotency.sql", run: () => probeTableColumn(db, "financial_transactions", "idempotency_key", "financial idempotency schema query failed").then((error) => error?.code === "PGRST205" ? { code: "PGRST205", message: "financial transactions table missing" } : error) },
            { migration: "supabase/024_operational_idempotency.sql", run: () => probeTableColumn(db, "crops", "idempotency_key", "crops idempotency schema query failed") },
            { migration: "supabase/024_operational_idempotency.sql", run: () => probeTableColumn(db, "crop_applications", "idempotency_key", "crop applications idempotency schema query failed") },
            { migration: "supabase/024_operational_idempotency.sql", run: () => probeTableColumn(db, "vaccinations", "idempotency_key", "vaccinations idempotency schema query failed") },
            { migration: "supabase/024_operational_idempotency.sql", run: () => probeTableColumn(db, "health_events", "idempotency_key", "health events idempotency schema query failed") },
            { migration: "supabase/025_map_feature_idempotency.sql", run: () => probeTableColumn(db, "map_features", "idempotency_key", "map features idempotency schema query failed") },
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
            { migration: "supabase/029_hacienda_idempotency.sql", run: () => probeTableColumn(db, "sections", "idempotency_key", "sections idempotency schema query failed") },
            { migration: "supabase/029_hacienda_idempotency.sql", run: () => probeTableColumn(db, "cattle", "idempotency_key", "cattle idempotency schema query failed") },
            { migration: "supabase/030_inventory_item_idempotency.sql", run: () => probeTableColumn(db, "inventory_items", "idempotency_key", "inventory item idempotency schema query failed") },
            { migration: "supabase/031_farm_memberships.sql", run: () => probeTableColumn(db, "farm_members", "role", "farm membership schema query failed") },
            { migration: "supabase/031_farm_memberships.sql", run: () => probeTableColumn(db, "farm_invites", "token_hash", "farm invite schema query failed") },
            ]).then((probes) => ({ probes, timedOut: false })),
            SUPABASE_SCHEMA_PROBE_TIMEOUT_MS,
            { probes: [] as SchemaProbeResult[], timedOut: true as const },
          );
        }),
        pingPromise.then((pingResult) => {
          if (pingResult.type !== "ok") return { type: pingResult.type };
          return withTimeout<{ type: AuthProbeReason }>(
            Promise.resolve(db.auth.getUser())
              .then(({ error }) => ({ type: classifyAuthProbe(error || null) }))
              .catch(() => ({ type: "query_error" as const })),
            SUPABASE_PING_TIMEOUT_MS,
            { type: "timeout" as const },
          );
        }),
        pingPromise.then((pingResult) => {
          if (pingResult.type !== "ok") return skippedQueryProbe(pingResult.type);
          return withTimeout<SupabaseQueryProbe>(
            Promise.resolve(db.from("chat_requests").select("request_id", { head: true }).limit(1))
              .then(({ error }) => ({ error: error || null, timedOut: false as const }))
              .catch((error) => ({ error: normalizeSupabaseProbeError(error, "chat retry schema query failed"), timedOut: false as const })),
            SUPABASE_PING_TIMEOUT_MS,
            { error: null, timedOut: true as const },
          );
        }),
        pingPromise.then((pingResult) => {
          if (pingResult.type !== "ok") return skippedQueryProbe(pingResult.type);
          return withTimeout<SupabaseQueryProbe>(
            Promise.resolve(db.from("sample_data_requests").select("request_id", { head: true }).limit(1))
              .then(({ error }) => ({ error: error || null, timedOut: false as const }))
              .catch((error) => ({ error: normalizeSupabaseProbeError(error, "sample data schema query failed"), timedOut: false as const })),
            SUPABASE_PING_TIMEOUT_MS,
            { error: null, timedOut: true as const },
          );
        }),
      ]);
      supabaseReason = ping.type;
      supabase = ping.type === "ok";
      authReason = authProbe.type;
      auth = authProbe.type === "ok";
      tasksReason = classifyTasksProbe(tasksProbe.error, tasksProbe.timedOut);
      const criticalSchemaProbes = schemaProbe.probes.some((probe) => probe.critical)
        ? schemaProbe.probes.filter((probe) => probe.critical)
        : schemaProbe.probes;
      const criticalSchemaTimedOut = (schemaProbe.timedOut && criticalSchemaProbes.length === 0)
        || criticalSchemaProbes.some((probe) => probe.error?.code === "TIMEOUT");
      schemaReason = classifySchemaProbe(criticalSchemaProbes.map(({ error }) => error), criticalSchemaTimedOut);
      missingMigrations = missingSchemaMigrations(schemaProbe.probes);
      schemaIssues = schemaProbeIssues(schemaProbe.probes);
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
    schemaIssues = [];
  }

  schemaReason = normalizeSchemaProbeReason(schemaReason, missingMigrations);
  const ok = coreServicesReady(supabase, auth, groq, schemaReason, missingMigrations, supabaseReason, authReason);
  return {
    body: {
      ok,
      supabase,
      auth,
      groq,
      groqReason,
      supabaseReason,
      authReason,
      features: {
        tasks: { available: tasksReason === "ok", reason: tasksReason },
        schema: { available: schemaFeatureAvailable(schemaReason, missingMigrations), reason: schemaReason, missingMigrations, issues: schemaIssues },
        chatRetries: { available: chatRetriesReason === "ok", reason: chatRetriesReason },
        sampleData: { available: sampleDataReason === "ok", reason: sampleDataReason },
      },
    },
    ok,
    checkedAt: new Date().toISOString(),
  };
}

export async function GET() {
  const result = await runHealthProbeOnce(runHealthProbe);
  return NextResponse.json(result.body, {
    status: result.ok ? 200 : 503,
    headers: {
      // The probe is intentionally public and contains no farm data. Cache
      // healthy results briefly, but never let an edge-cached 503 make a
      // recovered Supabase instance look unhealthy.
      ...healthCacheHeaders(result.ok),
      "X-Robots-Tag": "noindex, nofollow",
      [HEALTH_CHECKED_AT_HEADER]: result.checkedAt,
    },
  });
}
