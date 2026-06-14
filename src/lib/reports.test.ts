import { describe, it, expect } from "vitest";
import { sumCattleByCategory, totalHead, summarizeFinances, valuateInventory } from "./reports";

describe("sumCattleByCategory / totalHead", () => {
  const cattle = [
    { category: "vaca", count: 60 },
    { category: "ternero", count: 38 },
    { category: "vaca", count: 20 },
  ];
  it("sums per category and sorts descending", () => {
    expect(sumCattleByCategory(cattle)).toEqual([
      { category: "vaca", count: 80 },
      { category: "ternero", count: 38 },
    ]);
  });
  it("totals all head", () => {
    expect(totalHead(cattle)).toBe(118);
  });
});

describe("summarizeFinances", () => {
  it("computes income, expense, net, and per-category split", () => {
    const r = summarizeFinances([
      { type: "ingreso", category: "venta_ganado", amount: 1000 },
      { type: "egreso", category: "veterinario", amount: 200 },
      { type: "egreso", category: "veterinario", amount: 50 },
    ]);
    expect(r.income).toBe(1000);
    expect(r.expense).toBe(250);
    expect(r.net).toBe(750);
    expect(r.byCategory.find((c) => c.category === "veterinario")?.expense).toBe(250);
  });
});

describe("valuateInventory", () => {
  it("values stock × cost and totals, treating null cost as 0", () => {
    const r = valuateInventory([
      { name: "Ración", current_stock: 100, cost_per_unit: 0.5, unit: "kg" },
      { name: "Sin costo", current_stock: 10, cost_per_unit: null },
    ]);
    expect(r.rows[0].value).toBe(50);
    expect(r.rows[1].value).toBe(0);
    expect(r.total).toBe(50);
  });
});
