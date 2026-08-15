import { describe, expect, it } from "vitest";
import { signedInventoryQuantity } from "@/lib/inventory-movement";

describe("signedInventoryQuantity", () => {
  it("makes purchases positive", () => {
    expect(signedInventoryQuantity("compra", -4)).toBe(4);
  });

  it("makes use and loss negative", () => {
    expect(signedInventoryQuantity("uso", 4)).toBe(-4);
    expect(signedInventoryQuantity("pérdida", -2)).toBe(-2);
  });

  it("preserves the sign for stock adjustments", () => {
    expect(signedInventoryQuantity("ajuste", -3)).toBe(-3);
    expect(signedInventoryQuantity("ajuste", 8)).toBe(8);
  });
});
