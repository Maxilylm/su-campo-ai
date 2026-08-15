import { describe, expect, it } from "vitest";
import { validateAIOperation } from "./ai-validation";

describe("validateAIOperation", () => {
  it("rejects invalid model-produced cattle and financial values", () => {
    expect(validateAIOperation("cattle", "insert", { category: "dragon", count: 2 })).toBe("category is invalid");
    expect(validateAIOperation("financial_transactions", "insert", { type: "egreso", category: "otro", amount: -10, currency: "USD", date: "2026-08-15" })).toBe("amount is invalid");
  });

  it("validates dates, relations and inventory values", () => {
    expect(validateAIOperation("crop_applications", "insert", { crop_id: "crop-1", type: "herbicida", date_applied: "2026-02-31" })).toBe("date_applied is invalid");
    expect(validateAIOperation("inventory_movements", "insert", { item_id: "item-1", type: "compra", quantity: 5, unit_cost: -1, date: "2026-08-15", currency: "USD" })).toBe("unit_cost is invalid");
  });

  it("allows partial updates and leaves task-specific rules to the executor", () => {
    expect(validateAIOperation("cattle", "update", { notes: "revisar" })).toBeNull();
    expect(validateAIOperation("tasks", "insert", {})).toBeNull();
    expect(validateAIOperation("inventory_movements", "delete", {})).toBeNull();
  });
});
