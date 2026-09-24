import { describe, expect, it } from "vitest";
import {
  EMPTY_CATTLE_FORM, EMPTY_SECTION_FORM, cattleFormFrom, haciendaFormSignature, pastureTone, sectionFormFrom, waterTone,
} from "./hacienda-form";

describe("haciendaFormSignature", () => {
  it("ignores the cattle form while a section form is open", () => {
    const base = { mode: "add-section" as const, editId: null, section: EMPTY_SECTION_FORM, cattle: EMPTY_CATTLE_FORM };
    const changedCattle = { ...base, cattle: { ...EMPTY_CATTLE_FORM, count: "30" } };
    expect(haciendaFormSignature(changedCattle)).toBe(haciendaFormSignature(base));
    const changedSection = { ...base, section: { ...EMPTY_SECTION_FORM, name: "Norte" } };
    expect(haciendaFormSignature(changedSection)).not.toBe(haciendaFormSignature(base));
  });

  it("ignores the section form while a cattle form is open", () => {
    const base = { mode: "edit-cattle" as const, editId: "c1", section: EMPTY_SECTION_FORM, cattle: EMPTY_CATTLE_FORM };
    expect(haciendaFormSignature({ ...base, section: { ...EMPTY_SECTION_FORM, name: "Sur" } })).toBe(haciendaFormSignature(base));
    expect(haciendaFormSignature({ ...base, cattle: { ...EMPTY_CATTLE_FORM, breed: "Angus" } })).not.toBe(haciendaFormSignature(base));
    expect(haciendaFormSignature({ ...base, editId: "c2" })).not.toBe(haciendaFormSignature(base));
  });
});

describe("form values from records", () => {
  it("maps a section, keeping empty optional numbers as blank strings", () => {
    expect(sectionFormFrom({
      name: "Norte", size_hectares: 120.5, capacity: null, color: "#3b82f6", water_status: "bajo", pasture_status: "bueno", notes: null,
    })).toEqual({ name: "Norte", hectares: "120.5", capacity: "", color: "#3b82f6", water: "bajo", pasture: "bueno", notes: "" });
  });

  it("maps a cattle lot with the same fallbacks as a new lot", () => {
    expect(cattleFormFrom({
      section_id: null, category: "novillo", breed: null, count: 40, weight_kg: null, ear_tag: null, origin: "",
      vaccination_status: "", reproductive_status: null, health_status: "", notes: null,
    })).toEqual({ ...EMPTY_CATTLE_FORM, category: "novillo", count: "40" });
  });
});

describe("condition tones", () => {
  it("flags dry or flooded water as bad and low water as a warning", () => {
    expect(waterTone("seco")).toBe("bad");
    expect(waterTone("inundado")).toBe("bad");
    expect(waterTone("bajo")).toBe("warn");
    expect(waterTone("bueno")).toBeNull();
  });

  it("flags overgrazed or dry pasture as a warning", () => {
    expect(pastureTone("sobrepastoreado")).toBe("warn");
    expect(pastureTone("seco")).toBe("warn");
    expect(pastureTone("creciendo")).toBeNull();
  });
});
