import { describe, expect, it } from "vitest";
import { deadlinesAIContext, farmLocalToday, humanDay } from "./ai-deadlines-context";
import { buildDeadlineActions } from "./briefing";

describe("farmLocalToday", () => {
  it("uses the farm's day, not the server's UTC day", () => {
    // 23:30 local on the 23rd is already the 24th in UTC.
    expect(farmLocalToday(Date.parse("2026-09-24T02:30:00Z"))).toBe("2026-09-23");
    expect(farmLocalToday(Date.parse("2026-09-23T15:00:00Z"))).toBe("2026-09-23");
  });
});

describe("humanDay", () => {
  it("formats like a foreman says it", () => {
    expect(humanDay("2026-09-28")).toBe("lun 28/9");
    expect(humanDay("2026-10-08T00:00:00Z")).toBe("jue 8/10");
  });
});

describe("deadlinesAIContext", () => {
  it("groups by overdue / this week / later with human dates and no ISO", () => {
    const now = Date.parse("2026-09-23T12:00:00Z");
    const ctx = deadlinesAIContext(buildDeadlineActions([
      { id: "t1", kind: "task", label: "Tarea: Revisar aguada", date: "2026-09-20", sectionName: "Potrero Sur" },
      { id: "v1", kind: "vaccination", label: "Vacunación: Aftosa", date: "2026-09-28" },
      { id: "c1", kind: "harvest", label: "Cosecha: soja", date: "2026-10-08", sectionName: "Bajo del Arroyo" },
    ], now));
    expect(ctx).toContain("ATRASADO:\n- dom 20/9 · Tarea: Revisar aguada (Vencida hace 3d en Potrero Sur)\n");
    expect(ctx).toContain("ESTA SEMANA (hoy y los próximos 7 días):\n- lun 28/9 · Vacunación: Aftosa (Vence en 5d (28/09))\n");
    expect(ctx).toContain("MÁS ADELANTE (hasta 30 días):\n- jue 8/10 · Cosecha: soja");
    expect(ctx).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it("is empty with nothing pending", () => {
    expect(deadlinesAIContext([])).toBe("");
  });
});
