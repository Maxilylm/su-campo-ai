import { describe, expect, it } from "vitest";
import { taskDueInfo } from "./task-due";

const now = new Date("2026-09-24T10:00:00");
const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("es-UY");

describe("taskDueInfo", () => {
  it("labels tasks without a date", () => {
    expect(taskDueInfo(null, "pending", now)).toEqual({ label: "Sin fecha", tone: "muted" });
  });

  it("flags overdue pending tasks as bad", () => {
    expect(taskDueInfo("2026-09-20", "pending", now)).toEqual({ label: `Vencida · ${day("2026-09-20")}`, tone: "bad" });
  });

  it("warns for today and tomorrow", () => {
    expect(taskDueInfo("2026-09-24", "pending", now)).toEqual({ label: "Vence hoy", tone: "warn" });
    expect(taskDueInfo("2026-09-25", "pending", now)).toEqual({ label: "Vence mañana", tone: "warn" });
  });

  it("keeps later and completed tasks neutral", () => {
    expect(taskDueInfo("2026-10-02", "pending", now)).toEqual({ label: day("2026-10-02"), tone: "muted" });
    expect(taskDueInfo("2026-09-20", "completed", now)).toEqual({ label: day("2026-09-20"), tone: "muted" });
  });
});
