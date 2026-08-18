import { describe, expect, it } from "vitest";
import { classifyAuthProbe, classifySchemaProbe, classifyTasksProbe, coreServicesReady, healthCacheHeaders, isCompatibilitySchemaDrift, isMissingSchemaElement, isMissingTasksTable, missingSchemaMigrations, normalizeSupabaseProbeError, normalizeSchemaProbeReason, readHealthCheckedAt, schemaFeatureAvailable, schemaProbeIssues, serviceProbe, serviceProbeDetail, serviceProbeLabel, serviceStatusLabel } from "./service-status";

describe("service status probes", () => {
  it("recognizes the missing optional tasks table", () => {
    expect(isMissingTasksTable({ code: "PGRST205", message: "Could not find the table tasks" })).toBe(true);
    expect(classifyTasksProbe({ message: 'relation "public.tasks" does not exist' })).toBe("migration_required");
  });

  it("distinguishes healthy, timeout, query error and missing environment", () => {
    expect(classifyTasksProbe(null)).toBe("ok");
    expect(classifyTasksProbe(null, true)).toBe("timeout");
    expect(classifyTasksProbe({ code: "42501" })).toBe("query_error");
    expect(classifyTasksProbe(null, false, false)).toBe("missing_env");
  });

  it("treats an expected missing session as a healthy Auth endpoint", () => {
    expect(classifyAuthProbe({ name: "AuthSessionMissingError", message: "Auth session missing" })).toBe("ok");
    expect(classifyAuthProbe({ status: 401, message: "Invalid JWT" })).toBe("ok");
    expect(classifyAuthProbe(null, true)).toBe("timeout");
    expect(classifyAuthProbe({ status: 503 })).toBe("query_error");
    expect(classifyAuthProbe(null, false, false)).toBe("missing_env");
  });

  it("recognizes missing columns separately from a database failure", () => {
    expect(isMissingSchemaElement({ code: "PGRST204", message: "column ear_tag not found" })).toBe(true);
    expect(isMissingSchemaElement({ code: "PGRST202", message: "Could not find function public.move_cattle" })).toBe(true);
    expect(isMissingSchemaElement({ code: "42883", message: "function public.move_cattle does not exist" })).toBe(true);
    expect(isMissingSchemaElement({ code: "42704", message: "type public.geometry does not exist" })).toBe(true);
    expect(classifySchemaProbe([{ code: "PGRST204" }])).toBe("migration_required");
    expect(classifySchemaProbe([{ code: "42883" }])).toBe("migration_required");
    expect(classifySchemaProbe([{ code: "08006" }])).toBe("query_error");
    expect(classifySchemaProbe([{ code: "TIMEOUT" }])).toBe("timeout");
    expect(classifySchemaProbe([null, null])).toBe("ok");
    expect(classifySchemaProbe([], true)).toBe("timeout");
  });

  it("preserves safe provider codes when a health probe rejects", () => {
    expect(normalizeSupabaseProbeError({ code: "PGRST205", message: "table is missing", status: 404 }, "fallback"))
      .toMatchObject({ code: "PGRST205", message: "table is missing", status: 404 });
    expect(normalizeSupabaseProbeError(new Error("connection failed"), "fallback"))
      .toMatchObject({ code: "QUERY_ERROR", message: "connection failed" });
    expect(normalizeSupabaseProbeError("unknown", "fallback"))
      .toEqual({ code: "QUERY_ERROR", message: "fallback" });
  });

  it("maps named schema probes to the right migrations", () => {
    const probes = [
      { migration: "supabase/023_financial_idempotency.sql", error: { code: "PGRST204" } },
      { migration: "supabase/022_task_idempotency.sql", error: { code: "PGRST204" } },
      { migration: "supabase/029_hacienda_idempotency.sql", error: null },
    ];
    expect(missingSchemaMigrations(probes)).toEqual([
      "supabase/022_task_idempotency.sql",
      "supabase/023_financial_idempotency.sql",
    ]);
    probes.push({ migration: "supabase/024_operational_idempotency.sql", error: { code: "PGRST204" } });
    expect(missingSchemaMigrations(probes)).toEqual([
      "supabase/022_task_idempotency.sql",
      "supabase/023_financial_idempotency.sql",
      "supabase/024_operational_idempotency.sql",
    ]);
    probes.push({ migration: "supabase/025_map_feature_idempotency.sql", error: { code: "PGRST204" } });
    expect(missingSchemaMigrations(probes)).toContain("supabase/025_map_feature_idempotency.sql");
    probes[2].error = { code: "PGRST204" };
    expect(missingSchemaMigrations(probes)).toContain("supabase/029_hacienda_idempotency.sql");
  });

  it("exposes safe schema probe metadata without provider messages", () => {
    expect(schemaProbeIssues([
      { migration: "supabase/024_operational_idempotency.sql", error: { code: "42501", message: "private database detail" } },
      { migration: "supabase/024_operational_idempotency.sql", error: { code: "42501", message: "same issue" } },
      { migration: "supabase/023_financial_idempotency.sql", error: { code: "TIMEOUT", message: "probe timed out" } },
      { migration: "supabase/025_map_feature_idempotency.sql", error: { code: "PGRST204", message: "column missing" } },
      { migration: "supabase/026_chat_request_idempotency.sql", error: { code: "bad code; do not expose" } },
    ])).toEqual([
      { migration: "supabase/024_operational_idempotency.sql", code: "42501" },
      { migration: "supabase/026_chat_request_idempotency.sql", code: "QUERY_ERROR" },
    ]);
  });

  it("turns service failures into actionable login copy", () => {
    expect(serviceStatusLabel("checking")).toBe("Verificando servicios…");
    expect(serviceStatusLabel("healthy")).toBe("Servicios disponibles");
    expect(serviceStatusLabel("degraded", "timeout")).toBe("Supabase está tardando en responder");
    expect(serviceStatusLabel("degraded", "query_error")).toBe("Supabase no responde en este momento");
    expect(serviceStatusLabel("degraded", "ok", "ok", "timeout")).toContain("autenticación");
    expect(serviceStatusLabel("degraded", "missing_env")).toBe("Supabase no está configurado");
    expect(serviceStatusLabel("degraded", "ok", "missing_env")).toBe("La IA no está configurada");
    expect(serviceStatusLabel("degraded", "ok", "ok", "ok", "migration_required")).toBe("Supabase necesita una migración");
    expect(serviceStatusLabel("degraded", "ok", "ok", "ok", "query_error")).toBe("No se pudo verificar el esquema de Supabase");
    expect(serviceStatusLabel("degraded", "unknown")).toBe("Conexión con servicios interrumpida");
  });

  it("only tolerates schema migrations with a compatibility fallback", () => {
    const compatible = [
      "supabase/018_padron_transaction.sql",
      "supabase/019_padron_idempotency.sql",
      "supabase/021_cattle_move_transaction.sql",
    ];
    expect(isCompatibilitySchemaDrift(compatible)).toBe(true);
    expect(isCompatibilitySchemaDrift(["supabase/022_task_idempotency.sql"])).toBe(false);
    expect(isCompatibilitySchemaDrift(["supabase/030_inventory_item_idempotency.sql"])).toBe(true);
    expect(isCompatibilitySchemaDrift([])).toBe(false);
    expect(coreServicesReady(true, true, true, "ok")).toBe(true);
    expect(coreServicesReady(true, true, true, "migration_required", compatible)).toBe(true);
    expect(coreServicesReady(true, true, true, "migration_required", ["supabase/022_task_idempotency.sql"])).toBe(false);
    expect(coreServicesReady(true, true, true, "migration_required", ["supabase/030_inventory_item_idempotency.sql"])).toBe(true);
    expect(coreServicesReady(true, true, true, "migration_required")).toBe(false);
    expect(coreServicesReady(true, true, true, "timeout")).toBe(true);
  });

  it("keeps compatibility schema drift available while exposing the migration gap", () => {
    const compatible = ["supabase/018_padron_transaction.sql", "supabase/019_padron_idempotency.sql", "supabase/021_cattle_move_transaction.sql"];
    expect(schemaFeatureAvailable("migration_required", compatible)).toBe(true);
    expect(schemaFeatureAvailable("migration_required", ["supabase/022_task_idempotency.sql"])).toBe(false);
    expect(schemaFeatureAvailable("query_error", compatible)).toBe(false);
  });

  it("normalizes PostgREST drift errors when only fallback migrations are missing", () => {
    const compatible = [
      "supabase/018_padron_transaction.sql",
      "supabase/019_padron_idempotency.sql",
      "supabase/021_cattle_move_transaction.sql",
    ];
    expect(normalizeSchemaProbeReason("query_error", compatible)).toBe("migration_required");
    expect(normalizeSchemaProbeReason("migration_required", compatible)).toBe("migration_required");
    expect(normalizeSchemaProbeReason("query_error", ["supabase/022_task_idempotency.sql"])).toBe("query_error");
  });

  it("maps the detailed in-app diagnostics to each integration", () => {
    const healthy = { supabase: true, auth: true, groq: true, features: { tasks: { available: true }, schema: { available: true } } };
    expect(serviceProbe(healthy, "supabase", true)).toBe("healthy");
    expect(serviceProbe(healthy, "auth", true)).toBe("healthy");
    expect(serviceProbe(healthy, "tasks", false)).toBe("offline");
    expect(serviceProbe(healthy, "chatRetries", true)).toBe("healthy");
    expect(serviceProbe(healthy, "sampleData", true)).toBe("healthy");
    expect(serviceProbe({ supabase: true, groq: false, groqReason: "missing_env" }, "groq", true)).toBe("missing");
    expect(serviceProbe({ supabase: true, auth: false, authReason: "query_error" }, "auth", true)).toBe("unavailable");
    expect(serviceProbe({ supabase: true, features: { tasks: { reason: "migration_required" } } }, "tasks", true)).toBe("missing");
    expect(serviceProbe({ supabase: true, features: { schema: { reason: "migration_required" } } }, "schema", true)).toBe("missing");
    expect(serviceProbe({ supabase: true, features: { schema: { reason: "migration_required", missingMigrations: [
      "supabase/018_padron_transaction.sql",
      "supabase/019_padron_idempotency.sql",
      "supabase/021_cattle_move_transaction.sql",
    ] } } }, "schema", true)).toBe("healthy");
    expect(serviceProbe({ supabase: true, features: { chatRetries: { reason: "migration_required" } } }, "chatRetries", true)).toBe("missing");
    expect(serviceProbe({ supabase: true, features: { sampleData: { reason: "migration_required" } } }, "sampleData", true)).toBe("missing");
    expect(serviceProbeLabel("missing", "tasks")).toBe("Requiere migración");
    expect(serviceProbeLabel("missing", "schema")).toBe("Requiere migración");
    expect(serviceProbeLabel("missing", "chatRetries")).toBe("Requiere migración");
    expect(serviceProbeLabel("missing", "sampleData")).toBe("Requiere migración");
    expect(serviceProbeDetail("missing", "tasks")).toContain("014_tasks.sql");
    expect(serviceProbeDetail("missing", "schema")).toContain("migraciones");
    expect(serviceProbeDetail("missing", "chatRetries")).toContain("026_chat_request_idempotency.sql");
    expect(serviceProbeDetail("missing", "sampleData")).toContain("028_sample_data_idempotency.sql");
  });

  it("uses the server probe timestamp and safely falls back for bad headers", () => {
    const response = new Response(null, {
      headers: { "X-CampoAI-Health-Checked-At": "2026-08-15T06:37:37.614Z" },
    });
    expect(readHealthCheckedAt(response, "fallback")).toBe("2026-08-15T06:37:37.614Z");

    const invalidResponse = new Response(null, {
      headers: { "X-CampoAI-Health-Checked-At": "not-a-date" },
    });
    expect(readHealthCheckedAt(invalidResponse, "fallback")).toBe("fallback");
  });

  it("does not cache an unhealthy health check", () => {
    expect(healthCacheHeaders(true)["Cache-Control"]).toContain("s-maxage=30");
    expect(healthCacheHeaders(false)).toEqual({
      "Cache-Control": "no-store, max-age=0",
      "CDN-Cache-Control": "no-store",
    });
  });
});
