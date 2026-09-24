import { describe, expect, it } from "vitest";
import {
  EMPTY_APPLICATION_FORM, EMPTY_CROP_FORM, agricultureFormSignature, cropFormFrom, cropStatusTone,
} from "./agricultura-form";

describe("agricultureFormSignature", () => {
  it("only counts the crop form while a crop is being edited", () => {
    const base = { mode: "edit-crop" as const, editId: "c1", appCropId: null, crop: EMPTY_CROP_FORM, application: EMPTY_APPLICATION_FORM };
    expect(agricultureFormSignature({ ...base, application: { ...EMPTY_APPLICATION_FORM, product: "Glifosato" } })).toBe(agricultureFormSignature(base));
    expect(agricultureFormSignature({ ...base, crop: { ...EMPTY_CROP_FORM, hectares: "40" } })).not.toBe(agricultureFormSignature(base));
  });

  it("only counts the application form and its crop in application mode", () => {
    const base = { mode: "add-app" as const, editId: null, appCropId: "c1", crop: EMPTY_CROP_FORM, application: EMPTY_APPLICATION_FORM };
    expect(agricultureFormSignature({ ...base, crop: { ...EMPTY_CROP_FORM, type: "trigo" } })).toBe(agricultureFormSignature(base));
    expect(agricultureFormSignature({ ...base, appCropId: "c2" })).not.toBe(agricultureFormSignature(base));
  });
});

describe("cropFormFrom", () => {
  it("maps a crop, keeping empty optional values as blank strings", () => {
    expect(cropFormFrom({
      section_id: null, crop_type: "maiz", variety: null, planted_hectares: 32.5, planting_date: "2026-10-01",
      expected_harvest: null, actual_harvest: null, yield_kg: null, status: "growing", soil_type: null, irrigation_type: "pivot", notes: null,
    })).toEqual({ ...EMPTY_CROP_FORM, type: "maiz", hectares: "32.5", plantingDate: "2026-10-01", status: "growing", irrigationType: "pivot" });
  });
});

describe("cropStatusTone", () => {
  it("colors only states worth noticing", () => {
    expect(cropStatusTone("growing")).toBe("ok");
    expect(cropStatusTone("failed")).toBe("bad");
    expect(cropStatusTone("harvested")).toBe("info");
    expect(cropStatusTone("planted")).toBe("muted");
  });
});
