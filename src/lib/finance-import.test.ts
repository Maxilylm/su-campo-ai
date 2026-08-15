import { describe, expect, it } from "vitest";
import { collectFinanceImportRelationIds, parseFinanceAmount, resolveFinanceImportRelation, validateFinanceImportRows } from "./finance-import";

describe("financial CSV import validation", () => {
  it("parses dot-decimal and regional thousands/decimal formats", () => {
    expect(parseFinanceAmount("1250.50")).toBe(1250.5);
    expect(parseFinanceAmount("1.250,50")).toBe(1250.5);
    expect(parseFinanceAmount(" 2 500,75 ")).toBe(2500.75);
  });

  it("normalizes valid rows and optional fields", () => {
    const result = validateFinanceImportRows([{
      type: "egreso",
      category: "compra_insumo",
      amount: "1250.50",
      currency: "UYU",
      date: "2026-08-15",
      description: " Ración ",
      sectionId: "section-1",
    }]);

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ amount: 1250.5, description: "Ración", sectionId: "section-1", cropId: null });
  });

  it("reports every invalid financial field before any write", () => {
    const result = validateFinanceImportRows([{
      type: "transferencia",
      category: "desconocida",
      amount: 0,
      currency: "EUR",
      date: "2026-02-30",
    }]);

    expect(result.errors).toHaveLength(5);
    expect(result.rows).toHaveLength(1);
  });

  it("rejects rows beyond the batch limit", () => {
    const result = validateFinanceImportRows(Array.from({ length: 3 }, () => ({
      type: "ingreso", category: "otro", amount: 1, currency: "USD",
    })), 2);
    expect(result.errors[0]).toContain("hasta 2");
    expect(result.rows).toHaveLength(2);
  });

  it("collects only referenced relation ids for bounded lookups", () => {
    const sectionId = "11111111-1111-4111-8111-111111111111";
    const cropId = "22222222-2222-4222-8222-222222222222";
    const cattleId = "33333333-3333-4333-8333-333333333333";
    const cattleId2 = "44444444-4444-4444-8444-444444444444";
    const result = validateFinanceImportRows([
      { type: "ingreso", category: "otro", amount: 1, currency: "USD", sectionId, cropId, cattleId },
      { type: "ingreso", category: "otro", amount: 2, currency: "USD", sectionId, cropId: null, cattleId: cattleId2 },
    ]);
    expect(collectFinanceImportRelationIds(result.rows)).toEqual({
      sectionIds: [sectionId],
      cropIds: [cropId],
      cattleIds: [cattleId, cattleId2],
    });
  });

  it("resolves relation labels only when they are unambiguous", () => {
    const options = [
      { id: "section-1", label: "Norte" },
      { id: "section-2", label: "Sur" },
    ];
    expect(resolveFinanceImportRelation(" norte ", options, "la sección")).toEqual({ id: "section-1", error: null });
    expect(resolveFinanceImportRelation("Desconocida", options, "la sección").error).toContain("No se encontró");
    expect(resolveFinanceImportRelation("Norte", [{ id: "1", label: "Norte" }, { id: "2", label: "Norte" }], "la sección").error).toContain("varias opciones");
  });
});
