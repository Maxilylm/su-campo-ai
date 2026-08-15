import { describe, expect, it } from "vitest";
import { validateFarmProfileInput } from "./farm-input";

describe("validateFarmProfileInput", () => {
  it("normalizes a new farm profile and applies defaults", () => {
    expect(validateFarmProfileInput({ name: "  La Gloria ", totalHectares: "125.5", location: "  Paysandú  " }, "create")).toEqual({
      ok: true,
      value: { name: "La Gloria", totalHectares: 125.5, location: "Paysandú", operationType: "livestock" },
    });
  });

  it("rejects whitespace-only names and negative hectares", () => {
    expect(validateFarmProfileInput({ name: "   " }, "create")).toEqual({ ok: false, error: "name inválido" });
    expect(validateFarmProfileInput({ totalHectares: -1 }, "create")).toEqual({ ok: false, error: "totalHectares inválido" });
  });

  it("keeps partial updates partial", () => {
    expect(validateFarmProfileInput({ location: "  Salto " }, "update")).toEqual({
      ok: true,
      value: { location: "Salto" },
    });
  });

  it("rejects invalid operation types and oversized locations", () => {
    expect(validateFarmProfileInput({ operationType: "other" }, "update")).toEqual({ ok: false, error: "operationType inválido" });
    expect(validateFarmProfileInput({ location: "x".repeat(201) }, "update")).toEqual({ ok: false, error: "location inválida" });
  });
});
