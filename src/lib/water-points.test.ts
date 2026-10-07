import { describe, expect, it } from "vitest";
import { buildFieldStatus, planRotation } from "./grazing";
import { buildAlerts } from "./alerts";
import { buildDailyPlan } from "./daily-plan";
import {
  applyWaterPoints, checkedLabel, daysSinceChecked, normalizeWaterPoint, parseWaterPointInput, servedWaterStatus,
  waterPointStatusAdjective, waterPointsAIContext, type WaterPoint,
} from "./water-points";

const SEC_A = "11111111-1111-4111-8111-111111111111";
const SEC_B = "22222222-2222-4222-8222-222222222222";
const NOW = Date.parse("2026-10-07T12:00:00Z");

const point = (overrides: Partial<WaterPoint>): WaterPoint => ({
  id: "w1", name: "Tajamar Norte", kind: "tajamar", status: "ok", capacity_liters: null, location: null,
  section_ids: [], last_checked_at: null, notes: null, map_feature_id: null, ...overrides,
});

describe("parseWaterPointInput", () => {
  it("requires a name on create and validates every field", () => {
    expect(parseWaterPointInput({}, { partial: false })).toEqual({ ok: false, error: "Poné un nombre a la aguada." });
    const parsed = parseWaterPointInput({
      name: "  Bebedero 1 ", kind: "bebedero", status: "bajo", capacityLiters: "1500.4",
      location: { type: "Point", coordinates: [-56.1, -33.2] }, sectionIds: [SEC_A, SEC_A, SEC_B], notes: " flotador ",
    }, { partial: false });
    expect(parsed).toEqual({
      ok: true,
      value: {
        name: "Bebedero 1", kind: "bebedero", status: "bajo", capacity_liters: 1500,
        location: { type: "Point", coordinates: [-56.1, -33.2] }, section_ids: [SEC_A, SEC_B], notes: "flotador",
      },
    });
  });
  it("rejects bad values with Spanish messages", () => {
    expect(parseWaterPointInput({ name: "x", kind: "laguna" }, { partial: false })).toMatchObject({ ok: false, error: "Tipo de aguada inválido." });
    expect(parseWaterPointInput({ status: "vacio" }, { partial: true })).toMatchObject({ ok: false });
    expect(parseWaterPointInput({ capacityLiters: -3 }, { partial: true })).toMatchObject({ ok: false });
    expect(parseWaterPointInput({ location: { type: "Point", coordinates: [200, 0] } }, { partial: true })).toMatchObject({ ok: false });
    expect(parseWaterPointInput({ sectionIds: ["not-a-uuid"] }, { partial: true })).toMatchObject({ ok: false });
    expect(parseWaterPointInput({ name: "x".repeat(121) }, { partial: true })).toMatchObject({ ok: false });
    expect(parseWaterPointInput({}, { partial: true })).toEqual({ ok: false, error: "No hay cambios para guardar." });
  });
  it("marks as checked with the server clock and allows clearing optional fields", () => {
    const now = new Date("2026-10-07T10:00:00Z");
    expect(parseWaterPointInput({ checkedNow: true }, { partial: true, now })).toEqual({ ok: true, value: { last_checked_at: now.toISOString() } });
    expect(parseWaterPointInput({ capacityLiters: null, notes: "", location: null }, { partial: true })).toEqual({
      ok: true, value: { capacity_liters: null, notes: null, location: null },
    });
  });
});

describe("normalizeWaterPoint", () => {
  it("coerces DB rows and drops junk", () => {
    expect(normalizeWaterPoint(null)).toBeNull();
    expect(normalizeWaterPoint({ id: 1, name: "x" })).toBeNull();
    expect(normalizeWaterPoint({ id: "w", name: "A", kind: "x", status: "y", capacity_liters: "2000", location: { type: "Point", coordinates: [1, 2] }, section_ids: [SEC_A, 3] }))
      .toMatchObject({ kind: "tajamar", status: "ok", capacity_liters: 2000, location: { type: "Point", coordinates: [1, 2] }, section_ids: [SEC_A] });
  });
});

describe("check labels", () => {
  it("counts whole days", () => {
    expect(daysSinceChecked(null, NOW)).toBeNull();
    expect(checkedLabel(null, NOW)).toBe("Nunca revisada");
    expect(checkedLabel("2026-10-07T08:00:00Z", NOW)).toBe("Revisada hoy");
    expect(checkedLabel("2026-10-06T08:00:00Z", NOW)).toBe("Revisada ayer");
    expect(checkedLabel("2026-10-01T08:00:00Z", NOW)).toBe("Revisada hace 6 d");
  });
  it("agrees in gender with the kind", () => {
    expect(waterPointStatusAdjective("seco", "tajamar")).toBe("seco");
    expect(waterPointStatusAdjective("seco", "canada")).toBe("seca");
  });
});

describe("servedWaterStatus / applyWaterPoints", () => {
  it("takes the best aguada: one with water is enough", () => {
    expect(servedWaterStatus([])).toBeNull();
    expect(servedWaterStatus([{ status: "seco" }, { status: "ok" }])).toBe("bueno");
    expect(servedWaterStatus([{ status: "seco" }, { status: "bajo" }])).toBe("bajo");
    expect(servedWaterStatus([{ status: "roto" }])).toBe("seco");
  });

  const fresh = () => buildFieldStatus(
    [
      { id: SEC_A, name: "Norte", water_status: "bueno" },
      { id: SEC_B, name: "Sur", water_status: "seco" },
    ],
    [{ id: "c1", section_id: SEC_A, category: "vaca", count: 30 }, { id: "c2", section_id: SEC_B, category: "novillo", count: 12 }],
    [],
    NOW,
  );

  it("makes a potrero worse when its only aguada fails, and names it", () => {
    const [norte] = applyWaterPoints(fresh(), [point({ status: "roto", kind: "bebedero", name: "Bebedero 2", section_ids: [SEC_A] })]);
    expect(norte.waterStatus).toBe("seco");
    expect(norte.waterIssue).toBe("aguada: Bebedero 2 roto");
    expect(norte.waterPoints).toEqual([{ id: "w1", name: "Bebedero 2", kind: "bebedero", status: "roto" }]);
  });

  it("never makes a potrero better than what was recorded on it", () => {
    const [, sur] = applyWaterPoints(fresh(), [point({ status: "ok", section_ids: [SEC_B] })]);
    expect(sur.waterStatus).toBe("seco");
    expect(sur.waterIssue).toBeUndefined();
  });

  it("leaves potreros without aguadas alone and ignores unknown section ids", () => {
    const statuses = applyWaterPoints(fresh(), [point({ status: "seco", section_ids: ["33333333-3333-4333-8333-333333333333"] })]);
    expect(statuses[0].waterStatus).toBe("bueno");
    expect(statuses[0].waterPoints).toBeUndefined();
  });

  it("flows into alerts, the daily plan and the rotation", () => {
    const statuses = applyWaterPoints(fresh(), [point({ status: "seco", section_ids: [SEC_A] })]);
    const alerts = buildAlerts({ vaccinations: [], inventory: [], health: [], crops: [], fieldStatus: statuses }, NOW)
      .filter((alert) => alert.id === `fld-agua-${SEC_A}`);
    expect(alerts).toEqual([expect.objectContaining({ severity: "high", detail: "30 cabezas · aguada: Tajamar Norte seco" })]);

    const plan = buildDailyPlan({ today: "2026-10-07", agenda: [], statuses, rotation: [], weather: null });
    const water = plan.stops.find((stop) => stop.sectionId === SEC_A)?.items.find((item) => item.kind === "water");
    expect(water).toMatchObject({ urgency: "overdue", title: "Sin agua: resolver hoy", detail: "30 cabezas · aguada: Tajamar Norte seco" });

    // A dry potrero is never suggested as a destination.
    const empty = buildFieldStatus([{ id: SEC_A, name: "Norte" }, { id: SEC_B, name: "Sur" }], [{ id: "c", section_id: SEC_B, category: "vaca", count: 500 }], [], NOW);
    applyWaterPoints(empty, [point({ status: "seco", section_ids: [SEC_A] })]);
    const moves = planRotation(empty);
    expect(moves.flatMap((move) => move.destinations.map((destination) => destination.sectionId))).not.toContain(SEC_A);
  });
});

describe("waterPointsAIContext", () => {
  it("lists aguadas with the potreros they serve, escaped", () => {
    const text = waterPointsAIContext(
      [point({ name: "Taja\"mar", status: "bajo", section_ids: [SEC_A, "gone"], capacity_liters: 20000, last_checked_at: "2026-10-05T12:00:00Z" })],
      new Map([[SEC_A, "Norte"]]),
      (value) => value.replace(/"/g, "'"),
      NOW,
    );
    expect(text).toContain("AGUADAS");
    expect(text).toContain("aguada \"Taja'mar\" (tajamar): bajo · abastece Norte · revisada hace 2 d · 20.000 L");
    expect(waterPointsAIContext([], new Map(), (value) => value)).toBe("");
  });
});
