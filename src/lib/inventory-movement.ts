export type InventoryMovementType = "compra" | "uso" | "ajuste" | "pérdida";

export function signedInventoryQuantity(type: InventoryMovementType, value: number): number {
  if (type === "ajuste") return value;
  if (type === "uso" || type === "pérdida") return -Math.abs(value);
  return Math.abs(value);
}
