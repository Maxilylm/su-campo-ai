import { describe, expect, it } from "vitest";
import { groupWeek, matchSupply, vaccinationSupplyChecks } from "./week-prep";

const items = [
  { name: "Aftosa (dosis)", category: "medicamento", unit: "dosis", current_stock: "200" },
  { name: "Ración balanceada", category: "alimento", unit: "kg", current_stock: "150" },
  { name: "Ivermectina", category: "medicamento", unit: "L", current_stock: 2 },
];

describe("matchSupply", () => {
  it("finds the medicine by name, accents and punctuation aside", () => {
    expect(matchSupply("Aftosa", items)?.name).toBe("Aftosa (dosis)");
    expect(matchSupply("aftosa ", items)?.name).toBe("Aftosa (dosis)");
    expect(matchSupply("Ivermectina 1%", items)?.name).toBe("Ivermectina");
    expect(matchSupply("Carbunco", items)).toBeNull();
    expect(matchSupply("Ración", items)).toBeNull(); // not a medicine
  });

  it("matches whole words only, so a short name cannot hit an unrelated item", () => {
    const withFibra = [...items, { name: "Fibra digestiva", category: "medicamento", unit: "kg", current_stock: 10 }, { name: "IBR/DVB", category: "medicamento", unit: "dosis", current_stock: 30 }];
    expect(matchSupply("IBR", withFibra)?.name).toBe("IBR/DVB");
    expect(matchSupply("IBR", items)).toBeNull();
  });
});

describe("vaccinationSupplyChecks", () => {
  const heads = new Map([["norte", 98], ["sur", 48]]);

  it("counts one dose per head where it applies and compares with stock", () => {
    const [farm] = vaccinationSupplyChecks([{ id: "v1", vaccine: "Aftosa", date: "2026-09-28", sectionId: null, sectionName: null }], items, heads, 146);
    expect(farm).toMatchObject({ dosesNeeded: 146, inStock: 200, status: "ok" });
    expect(farm.summary).toBe("Aftosa: 146 dosis para todo el campo; hay 200 dosis en stock");
  });

  it("sums the same vaccine due twice before judging stock", () => {
    const checks = vaccinationSupplyChecks([
      { id: "a", vaccine: "Aftosa", date: "2026-09-26", sectionId: "norte", sectionName: "Potrero Norte" },
      { id: "b", vaccine: "Aftosa", date: "2026-09-28", sectionId: null, sectionName: null },
    ], items, heads, 146);
    expect(checks.map((check) => check.status)).toEqual(["short", "short"]);
    expect(checks[1].summary).toBe("Aftosa: 146 dosis para todo el campo; hay 200 dosis, faltan 44");
  });

  it("says when nothing in inventory matches", () => {
    const [check] = vaccinationSupplyChecks([{ id: "c", vaccine: "Carbunco", date: "2026-09-27", sectionId: "sur", sectionName: "Potrero Sur" }], items, heads, 146);
    expect(check).toMatchObject({ status: "missing", dosesNeeded: 48 });
    expect(check.summary).toBe("Carbunco: 48 dosis para Potrero Sur; no hay insumo registrado en inventario");
  });
});

describe("groupWeek", () => {
  it("keeps days 3-7 only, by date", () => {
    const week = groupWeek([
      { id: "1", date: "2026-09-24", daysFromNow: 1 },
      { id: "2", date: "2026-09-28", daysFromNow: 5 },
      { id: "3", date: "2026-09-26", daysFromNow: 3 },
      { id: "4", date: "2026-09-28", daysFromNow: 5 },
      { id: "5", date: "2026-10-08", daysFromNow: 15 },
    ], 2);
    expect(week.map((day) => [day.date, day.items.map((item) => item.id)])).toEqual([["2026-09-26", ["3"]], ["2026-09-28", ["2", "4"]]]);
  });
});
