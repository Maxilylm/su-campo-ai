import { describe, expect, it } from "vitest";
import { classifySchemaProbe, classifyTasksProbe, isMissingSchemaElement, isMissingTasksTable, serviceProbe, serviceProbeDetail, serviceProbeLabel, serviceStatusLabel } from "./service-status";

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

  it("recognizes missing columns separately from a database failure", () => {
    expect(isMissingSchemaElement({ code: "PGRST204", message: "column ear_tag not found" })).toBe(true);
    expect(classifySchemaProbe([{ code: "PGRST204" }])).toBe("migration_required");
    expect(classifySchemaProbe([{ code: "08006" }])).toBe("query_error");
    expect(classifySchemaProbe([null, null])).toBe("ok");
    expect(classifySchemaProbe([], true)).toBe("timeout");
  });

  it("turns service failures into actionable login copy", () => {
    expect(serviceStatusLabel("checking")).toBe("Verificando servicios…");
    expect(serviceStatusLabel("healthy")).toBe("Servicios disponibles");
    expect(serviceStatusLabel("degraded", "timeout")).toBe("Supabase está tardando en responder");
    expect(serviceStatusLabel("degraded", "query_error")).toBe("Supabase no responde en este momento");
    expect(serviceStatusLabel("degraded", "missing_env")).toBe("Supabase no está configurado");
    expect(serviceStatusLabel("degraded", "ok", "missing_env")).toBe("La IA no está configurada");
    expect(serviceStatusLabel("degraded", "unknown")).toBe("Conexión con servicios interrumpida");
  });

  it("maps the detailed in-app diagnostics to each integration", () => {
    const healthy = { supabase: true, groq: true, features: { tasks: { available: true }, schema: { available: true } } };
    expect(serviceProbe(healthy, "supabase", true)).toBe("healthy");
    expect(serviceProbe(healthy, "tasks", false)).toBe("offline");
    expect(serviceProbe({ supabase: true, groq: false, groqReason: "missing_env" }, "groq", true)).toBe("missing");
    expect(serviceProbe({ supabase: true, features: { tasks: { reason: "migration_required" } } }, "tasks", true)).toBe("missing");
    expect(serviceProbe({ supabase: true, features: { schema: { reason: "migration_required" } } }, "schema", true)).toBe("missing");
    expect(serviceProbeLabel("missing", "tasks")).toBe("Requiere migración");
    expect(serviceProbeDetail("missing", "tasks")).toContain("014_tasks.sql");
    expect(serviceProbeDetail("missing", "schema")).toContain("migraciones");
  });
});
