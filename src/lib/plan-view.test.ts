import { describe, expect, it } from "vitest";
import type { DailyPlan, PlanStop } from "./daily-plan";
import type { SupplyCheck } from "./week-prep";
import { planChatItems, planDateLabel, planShareText, stopTally, weekdayLabel } from "./plan-view";

const stop = (overrides: Partial<PlanStop> = {}): PlanStop => ({
  sectionId: "norte",
  name: "Potrero Norte",
  context: "40 vacas",
  items: [
    { id: "tsk-1", kind: "task", urgency: "overdue", title: "Arreglar alambrado", detail: "Lado del camino", href: "/gestion/tareas" },
    { id: "tsk-2", kind: "task", urgency: "today", title: "Pulverizar", detail: "", href: "/gestion/tareas", blockedBy: "viento fuerte" },
  ],
  ...overrides,
});

const plan: DailyPlan = {
  date: "2026-09-24",
  weather: null,
  stops: [stop()],
  counts: { total: 2, overdue: 1, blocked: 1 },
};

const supply = (overrides: Partial<SupplyCheck>): SupplyCheck => ({
  id: "s1", vaccine: "Aftosa", date: "2026-09-27", where: "Norte", dosesNeeded: 40, itemName: null, inStock: null,
  status: "missing", summary: "Aftosa: sin insumo", ...overrides,
});

describe("plan labels", () => {
  it("reads the plan's calendar day without shifting it by time zone", () => {
    expect(planDateLabel("2026-09-24")).toMatch(/^Jueves, 24 de se/);
    expect(weekdayLabel("2026-09-26")).toMatch(/^Sábado.*26/);
  });

  it("tallies a stop's tasks and overdue ones", () => {
    expect(stopTally(stop())).toBe("2 tareas · 1 atrasada");
    expect(stopTally(stop({ items: [stop().items[1]] }))).toBe("1 tarea");
  });
});

describe("planShareText", () => {
  it("appends only the supplies that still need buying", () => {
    const text = planShareText({ ...plan, supplies: [supply({ id: "a", status: "ok", summary: "Carbunco: en stock" }), supply({ id: "b" })] }, "La Aurora");
    expect(text).toContain("*Plan del día — La Aurora*");
    expect(text).toContain("*Preparar esta semana*\n• Aftosa: sin insumo");
    expect(text).not.toContain("Carbunco");
  });

  it("adds nothing when every supply is in stock", () => {
    expect(planShareText({ ...plan, supplies: [supply({ status: "ok" })] })).not.toContain("Preparar esta semana");
  });
});

describe("planChatItems", () => {
  it("labels each item with its stop and says why it is not for today", () => {
    expect(planChatItems(plan.stops)).toEqual([
      { label: "Potrero Norte: Arreglar alambrado", detail: "Lado del camino" },
      { label: "Potrero Norte: Pulverizar", detail: "no hoy: viento fuerte" },
    ]);
  });
});
