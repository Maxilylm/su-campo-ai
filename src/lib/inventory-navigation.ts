export interface MovementCropOption {
  id: string;
  section_id?: string | null;
}

export interface InventoryUseContext {
  cropId?: string | null;
  sectionId?: string | null;
  cattleId?: string | null;
  itemName?: string | null;
  date?: string | null;
  notes?: string | null;
}

/**
 * Keeps inventory-use choices inside the selected section while still
 * showing an already-selected crop long enough for the user to correct it.
 * Crops without a section remain available because they are valid for any
 * section and the API allows the relation to stay unassigned.
 */
export function filterCropsForSection<T extends MovementCropOption>(
  crops: T[],
  sectionId: string,
  selectedCropId = "",
): T[] {
  if (!sectionId) return crops;
  return crops.filter((crop) => !crop.section_id || crop.section_id === sectionId || crop.id === selectedCropId);
}

export function inventoryUseHref(context: InventoryUseContext): string {
  const params = new URLSearchParams({ use: "1" });
  if (context.cropId) params.set("cropId", context.cropId);
  if (context.sectionId) params.set("sectionId", context.sectionId);
  if (context.cattleId) params.set("cattleId", context.cattleId);
  if (context.itemName?.trim()) params.set("itemName", context.itemName.trim());
  if (context.date) params.set("date", context.date);
  if (context.notes?.trim()) params.set("notes", context.notes.trim());
  return `/gestion/inventario?${params.toString()}`;
}
