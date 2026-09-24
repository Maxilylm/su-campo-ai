import { describe, expect, it } from "vitest";
import { buildDailyPlan, dailyPlanText } from "./daily-plan";
import { buildFieldStatus, planRotation } from "./grazing";
import type { AgendaItem } from "./agenda";
import { fieldGraphFromData } from "./field-graph";

const NOW = Date.parse("2026-09-22T12:00:00Z");
const statuses = buildFieldStatus(
  [
    { id: "norte", name: "Potrero Norte", pasture_status: "sobrepastoreado", water_status: "bajo" },
    { id: "sur", name: "Potrero Sur", last_vacated_at: "2026-07-01T00:00:00Z" },
    { id: "chacra", name: "Chacra" },
  ],
  [{ id: "b1", section_id: "norte", category: "vaca", count: 40 }],
  [{ id: "k1", section_id: "chacra", crop_type: "soja", status: "growing" }],
  NOW,
);
const agenda = (overrides: Partial<AgendaItem>): AgendaItem => ({
  id: "tsk-1", kind: "task", date: "2026-09-22", daysFromNow: 0, title: "Tarea: x", detail: "", href: "/gestion/tareas", ...overrides,
});

describe("buildDailyPlan", () => {
  it("groups the day by potrero, most urgent stop first, General last", () => {
    const plan = buildDailyPlan({
      today: "2026-09-22",
      statuses,
      rotation: planRotation(statuses),
      weather: null,
      agenda: [
        agenda({ id: "tsk-general", title: "Tarea: pagar peones", daysFromNow: 0 }),
        agenda({ id: "vac-1", kind: "vaccination", title: "Vacunación: aftosa", daysFromNow: -2, sectionId: "sur" }),
        agenda({ id: "crp-1", kind: "harvest", title: "Cosecha: soja", daysFromNow: 1, sectionId: "chacra" }),
        agenda({ id: "tsk-far", title: "Tarea: lejana", daysFromNow: 10 }),
      ],
    });
    expect(plan.stops.map((stop) => stop.name)).toEqual(["Potrero Sur", "Potrero Norte", "Chacra", "General"]);
    const norte = plan.stops[1];
    expect(norte.context).toBe("40 vacas");
    expect(norte.items.map((item) => item.kind)).toEqual(["water", "move"]);
    expect(norte.items[1].title).toBe("Mover 40 cabezas a Potrero Sur");
    expect(plan.counts).toEqual({ total: 5, overdue: 1, blocked: 0 });
  });

  it("holds spraying when wind or rain says so, and warns about heat", () => {
    const plan = buildDailyPlan({
      today: "2026-09-22",
      statuses,
      rotation: [],
      weather: { current: { wind: 28, precip: 0 }, today: { tmax: 34, precip: 0 } },
      agenda: [
        agenda({ id: "tsk-spray", title: "Tarea: pulverizar herbicida", sectionId: "chacra" }),
        agenda({ id: "tsk-fence", title: "Tarea: arreglar alambrado", sectionId: "chacra" }),
      ],
    });
    expect(plan.weather?.sprayOk).toBe(false);
    expect(plan.weather?.notes[0]).toMatch(/Calor/);
    const [spray, fence] = plan.stops.find((stop) => stop.sectionId === "chacra")!.items;
    expect(spray.blockedBy).toMatch(/Viento/);
    expect(fence.blockedBy).toBeUndefined();
    expect(plan.counts.blocked).toBe(1);
  });

  it("does not duplicate a water task someone already scheduled", () => {
    const plan = buildDailyPlan({
      today: "2026-09-22",
      statuses,
      rotation: [],
      weather: null,
      agenda: [agenda({ id: "tsk-agua", title: "Tarea: Revisar aguada del Norte", daysFromNow: -3, sectionId: "norte" })],
    });
    expect(plan.stops[0].items.map((item) => item.id)).toEqual(["tsk-agua"]);
  });

  it("says when the next spray window is on a no-spray day", () => {
    const plan = buildDailyPlan({
      today: "2026-09-22",
      statuses,
      rotation: [],
      weather: { current: { wind: 28, precip: 0 }, sprayWindow: "próxima ventana para pulverizar: mañana 7–11 h (viento hasta 9 km/h, sin lluvia)" },
      agenda: [agenda({ id: "tsk-spray", title: "Tarea: pulverizar", sectionId: "chacra" })],
    });
    expect(plan.weather?.notes[0]).toBe("Próxima ventana para pulverizar: mañana 7–11 h (viento hasta 9 km/h, sin lluvia).");
    const spray = plan.stops.find((stop) => stop.sectionId === "chacra")!.items[0];
    expect(spray.blockedBy).toMatch(/Viento fuerte .* · próxima ventana para pulverizar: mañana 7–11 h/);
  });

  it("is empty on a quiet day", () => {
    const plan = buildDailyPlan({ today: "2026-09-22", statuses: [], rotation: [], weather: null, agenda: [] });
    expect(plan.stops).toEqual([]);
    expect(plan.counts.total).toBe(0);
  });
});

describe("dailyPlanText", () => {
  it("renders a phone-readable route with weather and blocked items", () => {
    const plan = buildDailyPlan({
      today: "2026-09-22",
      statuses,
      rotation: [],
      weather: { current: { wind: 28, precip: 0 } },
      agenda: [
        agenda({ id: "tsk-spray", title: "Tarea: pulverizar", sectionId: "chacra" }),
        agenda({ id: "vac-1", kind: "vaccination", title: "Vacunación: aftosa", daysFromNow: -1, sectionId: "sur" }),
      ],
    });
    const text = dailyPlanText(plan, "La Esperanza");
    const [title, date, ...rest] = text.split("\n");
    expect(title).toBe("*Plan del día — La Esperanza*");
    // es-UY spells it "setiembre"; older ICU builds say "septiembre".
    expect(date).toMatch(/^Martes, 22 de se(p)?tiembre$/);
    expect(rest).toEqual([
      "",
      "⛔ Pulverizar: Viento fuerte (28 km/h) — riesgo de deriva",
      "",
      "*Potrero Sur*",
      "‼️ Vacunación: aftosa — atrasado",
      "",
      "*Potrero Norte* (40 vacas)",
      "• Agua baja: revisar aguada",
      "",
      "*Chacra* (Soja)",
      "• Tarea: pulverizar — NO HOY: Viento fuerte (28 km/h) — riesgo de deriva",
    ]);
  });
});

describe("move routes in the plan", () => {
  it("says how to get the herd to the suggested potrero", () => {
    const ll = (x: number, y: number) => [-57.9 + x / 94_000, -32.3 + y / 111_195];
    const rect = (x: number) => ({ type: "Polygon", coordinates: [[ll(x, 0), ll(x + 200, 0), ll(x + 200, 200), ll(x, 200), ll(x, 0)]] });
    const rows = [
      { id: "norte", name: "Potrero Norte", pasture_status: "sobrepastoreado", map_center: rect(0) },
      { id: "sur", name: "Potrero Sur", last_vacated_at: "2026-07-01T00:00:00Z", map_center: rect(200) },
    ];
    const field = buildFieldStatus(rows, [{ id: "b1", section_id: "norte", category: "vaca", count: 40 }], [], NOW);
    const plan = buildDailyPlan({ today: "2026-09-22", statuses: field, rotation: planRotation(field, { graph: fieldGraphFromData(rows) }), weather: null, agenda: [] });
    const move = plan.stops[0].items.find((item) => item.kind === "move")!;
    expect(move.detail).toContain("lindero directo");
  });
});
