import { describe, expect, it } from "vitest";
import { buildAIChangeLinks, parseAIChangeReceipt } from "./ai-change-links";

describe("AI change links", () => {
  it("deduplicates module destinations and includes linked purchase effects", () => {
    expect(buildAIChangeLinks([
      { table: "cattle" },
      { table: "cattle" },
      { table: "inventory_movements", data: { type: "compra", unit_cost: 100 } },
    ])).toEqual([
      { label: "Hacienda", href: "/produccion/hacienda" },
      { label: "Inventario", href: "/gestion/inventario" },
      { label: "Finanzas", href: "/gestion/finanzas" },
    ]);
    expect(buildAIChangeLinks([{ table: "inventory_movements", data: { type: "uso", quantity: -1 } }])).toEqual([
      { label: "Inventario", href: "/gestion/inventario" },
    ]);
  });

  it("ignores untrusted or unknown operation tables", () => {
    expect(buildAIChangeLinks([{ table: "users" }, {}, { table: 42 }])).toEqual([]);
  });

  it("links AI weighings to the weight module", () => {
    expect(buildAIChangeLinks([{ table: "weight_records", data: {} }])).toEqual([{ label: "Peso", href: "/produccion/peso" }]);
  });

  it("restores safe destinations from a persisted receipt", () => {
    expect(parseAIChangeReceipt("Registrado.\n\n📌 Revisá: Tareas, Inventario."))
      .toEqual([
        { label: "Tareas", href: "/gestion/tareas" },
        { label: "Inventario", href: "/gestion/inventario" },
      ]);
    expect(parseAIChangeReceipt("📌 Afecta: Tareas.")).toEqual([]);
    expect(parseAIChangeReceipt("📌 Revisá: https://example.com.")).toEqual([]);
  });
});
