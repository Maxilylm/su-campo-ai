import { describe, expect, it } from "vitest";
import { costPerUnitRows, costUnitLabel, financeTotalsByCurrency } from "./finance-summary";

describe("financeTotalsByCurrency", () => {
  it("keeps each currency separate", () => {
    expect(financeTotalsByCurrency([
      { type: "ingreso", amount: 100, currency: "USD" },
      { type: "egreso", amount: 40, currency: "USD" },
      { type: "egreso", amount: 500, currency: "UYU" },
    ])).toEqual({ USD: { income: 100, expenses: 40 }, UYU: { income: 0, expenses: 500 } });
  });
});

describe("costPerUnitRows", () => {
  const cattle = [
    { id: "c1", category: "Novillos", breed: "Hereford", count: 10 },
    { id: "c2", category: "Vacas", breed: null, count: 0 },
    { id: "c3", category: "Terneros", breed: null, count: 5 },
  ];
  const crops = [
    { id: "k1", crop_type: "Soja", planted_hectares: 20 },
    { id: "k2", crop_type: "Maíz", planted_hectares: null },
  ];

  it("splits expenses per head and per hectare by currency, ignoring income", () => {
    const rows = costPerUnitRows([
      { type: "egreso", amount: 100, currency: "USD", cattle_id: "c1" },
      { type: "egreso", amount: 50, currency: "UYU", cattle_id: "c1" },
      { type: "ingreso", amount: 999, currency: "USD", cattle_id: "c1" },
      { type: "egreso", amount: 30, currency: "USD", cattle_id: "c2" },
      { type: "egreso", amount: 400, currency: "USD", crop_id: "k1" },
      { type: "egreso", amount: 70, currency: "USD", crop_id: "k2" },
    ], cattle, crops);

    expect(rows).toEqual([
      { label: "Novillos (Hereford)", totalCost: 100, perUnit: 10, unit: "cabeza", count: 10, currency: "USD" },
      { label: "Novillos (Hereford)", totalCost: 50, perUnit: 5, unit: "cabeza", count: 10, currency: "UYU" },
      { label: "Vacas", totalCost: 30, perUnit: 0, unit: "cabeza", count: 0, currency: "USD" },
      { label: "Soja", totalCost: 400, perUnit: 20, unit: "ha", count: 20, currency: "USD" },
      { label: "Maíz", totalCost: 70, perUnit: 0, unit: "ha", count: 0, currency: "USD" },
    ]);
  });
});

describe("costUnitLabel", () => {
  it("pluralizes heads but not hectares", () => {
    expect(costUnitLabel("cabeza", 1)).toBe("cabeza");
    expect(costUnitLabel("cabeza", 12)).toBe("cabezas");
    expect(costUnitLabel("ha", 35)).toBe("ha");
  });
});
