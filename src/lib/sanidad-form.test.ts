import { describe, expect, it } from "vitest";
import {
  emptyHealthForm, emptyVaccinationForm, healthFormFrom, sanidadFormSignature, vaccinationFormFrom, withLot, withSection,
} from "./sanidad-form";

const lots = [
  { id: "lot-north", section_id: "north" },
  { id: "lot-free", section_id: null },
];

describe("sanidadFormSignature", () => {
  it("only counts the vaccination form in vaccination mode", () => {
    const base = { mode: "add-vax" as const, vaccinationId: null, healthId: null, vaccination: emptyVaccinationForm("2026-09-24"), health: emptyHealthForm("2026-09-24") };
    expect(sanidadFormSignature({ ...base, health: { ...base.health, description: "Fiebre" } })).toBe(sanidadFormSignature(base));
    expect(sanidadFormSignature({ ...base, vaccination: { ...base.vaccination, count: "12" } })).not.toBe(sanidadFormSignature(base));
  });

  it("only counts the health form in health mode", () => {
    const base = { mode: "add-health" as const, vaccinationId: null, healthId: "h1", vaccination: emptyVaccinationForm(), health: emptyHealthForm() };
    expect(sanidadFormSignature({ ...base, vaccination: { ...base.vaccination, name: "Rabia" } })).toBe(sanidadFormSignature(base));
    expect(sanidadFormSignature({ ...base, healthId: "h2" })).not.toBe(sanidadFormSignature(base));
  });
});

describe("form values from records", () => {
  it("keeps the stored calendar day of a vaccination", () => {
    expect(vaccinationFormFrom({
      vaccine_name: "Aftosa", section_id: null, cattle_id: "lot-1", head_count: 40,
      date_applied: "2026-09-01T03:00:00.000Z", next_due: "2027-03-01", applied_by: null, batch_number: "B7", notes: null,
    })).toEqual({ ...emptyVaccinationForm(), cattle: "lot-1", count: "40", date: "2026-09-01", nextDue: "2027-03-01", batch: "B7" });
  });

  it("maps a health event", () => {
    expect(healthFormFrom({
      type: "enfermedad", description: "Fiebre", section_id: "north", cattle_id: null, head_count: 2,
      date_occurred: "2026-09-10T00:00:00Z", veterinarian: "Dra. Pérez", notes: null,
    })).toEqual({ type: "enfermedad", description: "Fiebre", section: "north", cattle: "", count: "2", date: "2026-09-10", veterinarian: "Dra. Pérez", notes: "" });
  });
});

describe("section and lot linking", () => {
  const form = { section: "north", cattle: "lot-north" };

  it("drops a lot from another section", () => {
    expect(withSection(form, "south", lots)).toEqual({ section: "south", cattle: "" });
  });

  it("keeps the lot when clearing the section or picking its own", () => {
    expect(withSection(form, "none", lots)).toEqual({ section: "", cattle: "lot-north" });
    expect(withSection(form, "north", lots)).toEqual(form);
    expect(withSection({ section: "", cattle: "lot-free" }, "south", lots)).toEqual({ section: "south", cattle: "lot-free" });
  });

  it("moves the section to the chosen lot's section", () => {
    expect(withLot({ section: "", cattle: "" }, "lot-north", lots)).toEqual({ section: "north", cattle: "lot-north" });
    expect(withLot({ section: "south", cattle: "lot-north" }, "lot-free", lots)).toEqual({ section: "south", cattle: "lot-free" });
    expect(withLot(form, "none", lots)).toEqual({ section: "north", cattle: "" });
  });
});
