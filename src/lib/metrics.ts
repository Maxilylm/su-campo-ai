export interface CropMetricRow {
  status?: string | null;
  yield_kg?: number | null;
  planted_hectares?: number | null;
}

export function countOverdueDates(values: Array<string | null | undefined>, today: string): number {
  return values.filter((value) => Boolean(value) && value!.slice(0, 10) < today).length;
}

export function averageValidCropYield(crops: CropMetricRow[]): number {
  const yields = crops
    .map((crop) => {
      const yieldKg = crop.yield_kg;
      const plantedHectares = crop.planted_hectares;
      return typeof yieldKg === "number" && Number.isFinite(yieldKg) && yieldKg >= 0
        && typeof plantedHectares === "number" && Number.isFinite(plantedHectares) && plantedHectares > 0
        ? yieldKg / plantedHectares
        : null;
    })
    .filter((value): value is number => value !== null);
  return yields.length > 0 ? yields.reduce((total, value) => total + value, 0) / yields.length : 0;
}

export function countActiveCrops(crops: Array<{ status?: string | null }>): number {
  return crops.filter((crop) => crop.status !== "harvested" && crop.status !== "failed").length;
}
