import { describe, it, expect } from "vitest";
import { filterFinancialTransactions, sumCattleByCategory, totalHead, summarizeFinances, summarizeFinancesBySection, valuateInventory } from "./reports";

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

  it("keeps mixed currencies separate", () => {
    const r = summarizeFinances([
      { type: "ingreso", category: "venta_ganado", amount: 1000, currency: "USD" },
      { type: "egreso", category: "veterinario", amount: 50000, currency: "UYU" },
    ]);
    expect(r.income).toBe(0);
    expect(r.expense).toBe(0);
    expect(r.byCurrency).toEqual([
      { currency: "USD", income: 1000, expense: 0, net: 1000 },
      { currency: "UYU", income: 0, expense: 50000, net: -50000 },
    ]);
    expect(r.byCategory.find((c) => c.currency === "UYU")?.expense).toBe(50000);
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

  it("keeps mixed inventory valuation by currency", () => {
    const r = valuateInventory([
      { name: "Ración", current_stock: 100, cost_per_unit: 0.5, unit: "kg", currency: "USD" },
      { name: "Semilla", current_stock: 10, cost_per_unit: 200, unit: "kg", currency: "UYU" },
    ]);
    expect(r.total).toBe(0);
    expect(r.byCurrency).toEqual([
      { currency: "USD", total: 50 },
      { currency: "UYU", total: 2000 },
    ]);
  });
});

describe("summarizeFinancesBySection", () => {
  it("groups income and expenses by section and currency", () => {
    const rows = summarizeFinancesBySection([
      { type: "ingreso", category: "venta_ganado", amount: 1800, currency: "USD", section_id: "north", sections: { name: "Norte" } },
      { type: "egreso", category: "veterinario", amount: 300, currency: "USD", section_id: "north", sections: { name: "Norte" } },
      { type: "egreso", category: "compra_insumo", amount: 12000, currency: "UYU", section_id: "north", sections: { name: "Norte" } },
      { type: "egreso", category: "mano_obra", amount: 100, currency: "USD" },
    ]);
    expect(rows).toEqual([
      { sectionId: "north", sectionName: "Norte", currency: "USD", income: 1800, expense: 300, net: 1500 },
      { sectionId: "north", sectionName: "Norte", currency: "UYU", income: 0, expense: 12000, net: -12000 },
      { sectionId: "unassigned", sectionName: "Sin asignar", currency: "USD", income: 0, expense: 100, net: -100 },
    ]);
  });
});

describe("filterFinancialTransactions", () => {
  const transactions = [
    { type: "egreso", category: "veterinario", amount: 100, section_id: "north", currency: "USD" },
    { type: "egreso", category: "insumo", amount: 200, section_id: "south", currency: "UYU" },
    { type: "ingreso", category: "venta", amount: 300, section_id: null, currency: "USD" },
  ];

  it("filters by section and currency without mixing unassigned movements", () => {
    expect(filterFinancialTransactions(transactions, "north", "USD")).toEqual([transactions[0]]);
    expect(filterFinancialTransactions(transactions, "unassigned")).toEqual([transactions[2]]);
    expect(filterFinancialTransactions(transactions, "all", "UYU")).toEqual([transactions[1]]);
  });
});
