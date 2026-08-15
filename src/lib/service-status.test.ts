import { describe, expect, it } from "vitest";
import { classifyAuthProbe, classifySchemaProbe, classifyTasksProbe, coreServicesReady, isMissingSchemaElement, isMissingTasksTable, missingSchemaMigrations, readHealthCheckedAt, serviceProbe, serviceProbeDetail, serviceProbeLabel, serviceStatusLabel } from "./service-status";

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
    expect(classifySchemaProbe([{ code: "PGRST204" }])).toBe("migration_required");
    expect(classifySchemaProbe([{ code: "08006" }])).toBe("query_error");
    expect(classifySchemaProbe([null, null])).toBe("ok");
    expect(classifySchemaProbe([], true)).toBe("timeout");
  });

  it("maps ordered retry-schema probes to the right migrations", () => {
    const probes = Array.from({ length: 15 }, () => null as { code?: string } | null);
    probes[10] = { code: "PGRST204" };
    probes[11] = { code: "PGRST204" };
    expect(missingSchemaMigrations(probes)).toEqual([
      "supabase/022_task_idempotency.sql",
      "supabase/023_financial_idempotency.sql",
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
    expect(serviceStatusLabel("degraded", "unknown")).toBe("Conexión con servicios interrumpida");
  });

  it("does not report readiness when the required schema is incomplete", () => {
    expect(coreServicesReady(true, true, true, "ok")).toBe(true);
    expect(coreServicesReady(true, true, true, "migration_required")).toBe(false);
    expect(coreServicesReady(true, true, true, "timeout")).toBe(false);
  });

  it("maps the detailed in-app diagnostics to each integration", () => {
    const healthy = { supabase: true, auth: true, groq: true, features: { tasks: { available: true }, schema: { available: true } } };
    expect(serviceProbe(healthy, "supabase", true)).toBe("healthy");
    expect(serviceProbe(healthy, "auth", true)).toBe("healthy");
    expect(serviceProbe(healthy, "tasks", false)).toBe("offline");
    expect(serviceProbe({ supabase: true, groq: false, groqReason: "missing_env" }, "groq", true)).toBe("missing");
    expect(serviceProbe({ supabase: true, auth: false, authReason: "query_error" }, "auth", true)).toBe("unavailable");
    expect(serviceProbe({ supabase: true, features: { tasks: { reason: "migration_required" } } }, "tasks", true)).toBe("missing");
    expect(serviceProbe({ supabase: true, features: { schema: { reason: "migration_required" } } }, "schema", true)).toBe("missing");
    expect(serviceProbeLabel("missing", "tasks")).toBe("Requiere migración");
    expect(serviceProbeLabel("missing", "schema")).toBe("Requiere migración");
    expect(serviceProbeDetail("missing", "tasks")).toContain("014_tasks.sql");
    expect(serviceProbeDetail("missing", "schema")).toContain("migraciones");
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
});
