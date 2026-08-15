import { describe, expect, it } from "vitest";
import { auditInventoryPurchaseLinks, findDuplicateEarTagGroups } from "./integrity";

describe("findDuplicateEarTagGroups", () => {
  it("groups caravanas case-insensitively and ignores blank or malformed rows", () => {
    expect(findDuplicateEarTagGroups([
      { id: "cattle-1", ear_tag: " A-10 " },
      { id: "cattle-2", ear_tag: "a-10" },
      { id: "cattle-3", ear_tag: "" },
      { id: 42, ear_tag: "B-2" },
    ])).toEqual([{ tag: "A-10", cattleIds: ["cattle-1", "cattle-2"] }]);
  });

  it("does not flag unique caravanas", () => {
    expect(findDuplicateEarTagGroups([
      { id: "cattle-1", ear_tag: "A-10" },
      { id: "cattle-2", ear_tag: "B-2" },
    ])).toEqual([]);
  });
});

describe("auditInventoryPurchaseLinks", () => {
  it("finds purchases without a linked financial transaction", () => {
    expect(auditInventoryPurchaseLinks(
      [{ id: "movement-1", unit_cost: 12 }, { id: "movement-2", unit_cost: 0 }],
      [],
    ).missingPurchaseFinancialIds).toEqual(["movement-1"]);
  });

  it("finds orphaned and duplicated financial links", () => {
    expect(auditInventoryPurchaseLinks(
      [{ id: "movement-1", unit_cost: 12 }],
      [
        { id: "tx-1", inventory_movement_id: "missing" },
        { id: "tx-2", inventory_movement_id: "movement-1" },
        { id: "tx-3", inventory_movement_id: "movement-1" },
      ],
    )).toEqual({
      missingPurchaseFinancialIds: [],
      orphanedFinancialLinkIds: ["tx-1"],
      duplicateFinancialMovementIds: ["movement-1"],
    });
  });

  it("ignores non-purchase movements and malformed rows", () => {
    expect(auditInventoryPurchaseLinks(
      [{ id: "movement-1", unit_cost: null }, { id: 42, unit_cost: 10 }],
      [{ id: "tx-1", inventory_movement_id: null }],
    )).toEqual({ missingPurchaseFinancialIds: [], orphanedFinancialLinkIds: [], duplicateFinancialMovementIds: [] });
  });
});
