// Pure description of a realistic demo farm. The route inserts it, resolving
// sectionKey → real section id. Date offsets are days-from-now (resolved at insert
// time) and are chosen so the Alerts panel lights up immediately (a soon-due
// vaccination, low stock, an upcoming harvest) — showing the app alive on first run.

export interface SampleData {
  farm: { name: string; operation_type: "mixed"; total_hectares: number; location: string };
  sections: { key: string; name: string; size_hectares: number; water_status: string; pasture_status: string }[];
  cattle: { sectionKey: string; category: string; breed: string; count: number; weight_kg: number; vaccination_status: string }[];
  crops: { sectionKey: string; crop_type: string; variety: string; planted_hectares: number; status: string; expectedHarvestInDays: number }[];
  inventory: { name: string; category: string; unit: string; current_stock: number; min_stock: number; cost_per_unit: number }[];
  vaccinations: { vaccine_name: string; head_count: number; appliedDaysAgo: number; nextDueInDays: number }[];
  health_events: { type: string; description: string; head_count: number; resolved: boolean }[];
  transactions: { type: string; category: string; amount: number; currency: string; daysAgo: number; description: string }[];
}

export function buildSampleData(): SampleData {
  return {
    farm: { name: "Campo Demo", operation_type: "mixed", total_hectares: 420, location: "Paysandú, Uruguay" },
    sections: [
      { key: "norte", name: "Potrero Norte", size_hectares: 120, water_status: "bueno", pasture_status: "bueno" },
      { key: "sur", name: "Potrero Sur", size_hectares: 95, water_status: "bajo", pasture_status: "sobrepastoreado" },
      { key: "bajo", name: "Bajo del Arroyo", size_hectares: 80, water_status: "bueno", pasture_status: "creciendo" },
    ],
    cattle: [
      { sectionKey: "norte", category: "vaca", breed: "Hereford", count: 60, weight_kg: 420, vaccination_status: "al_dia" },
      { sectionKey: "norte", category: "ternero", breed: "Hereford", count: 38, weight_kg: 160, vaccination_status: "pendiente" },
      { sectionKey: "sur", category: "novillo", breed: "Angus", count: 45, weight_kg: 380, vaccination_status: "al_dia" },
      { sectionKey: "sur", category: "toro", breed: "Angus", count: 3, weight_kg: 720, vaccination_status: "al_dia" },
    ],
    crops: [
      { sectionKey: "bajo", crop_type: "soja", variety: "DM 53i54", planted_hectares: 60, status: "growing", expectedHarvestInDays: 20 },
    ],
    inventory: [
      { name: "Ración balanceada", category: "alimento", unit: "kg", current_stock: 150, min_stock: 500, cost_per_unit: 0.45 },
      { name: "Aftosa (dosis)", category: "medicamento", unit: "dosis", current_stock: 200, min_stock: 50, cost_per_unit: 1.2 },
      { name: "Gasoil", category: "combustible", unit: "L", current_stock: 800, min_stock: 300, cost_per_unit: 1.05 },
    ],
    vaccinations: [
      { vaccine_name: "Aftosa", head_count: 146, appliedDaysAgo: 170, nextDueInDays: 10 },
    ],
    health_events: [
      { type: "enfermedad", description: "Cojera en 2 novillos del Sur — en observación", head_count: 2, resolved: false },
    ],
    transactions: [
      { type: "ingreso", category: "venta_ganado", amount: 18500, currency: "USD", daysAgo: 25, description: "Venta de 22 novillos gordos" },
      { type: "egreso", category: "compra_insumo", amount: 2300, currency: "USD", daysAgo: 12, description: "Compra de ración" },
      { type: "egreso", category: "veterinario", amount: 640, currency: "USD", daysAgo: 5, description: "Visita veterinaria + antiparasitario" },
    ],
  };
}
