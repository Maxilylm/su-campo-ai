import { describe, expect, it } from "vitest";
import { parseFinanceAmount, validateFinanceImportRows } from "./finance-import";

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
});
