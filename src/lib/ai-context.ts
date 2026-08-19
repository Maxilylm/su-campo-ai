export const AI_CONTEXT_LIMITS = {
  sections: 500,
  cattle: 2000,
  crops: 500,
  cropApplications: 1000,
  inventory: 500,
  tasks: 50,
  activities: 20,
  vaccinations: 10,
  healthEvents: 10,
  financials: 10,
  inventoryMovements: 50,
  weightRecords: 20,
  padrones: 100,
  mapFeatures: 100,
} as const;

export interface AIContextPage<T> {
  items: T[];
  truncated: boolean;
}

/** Keep AI requests bounded while retaining an explicit signal about omitted rows. */
export function boundAIContextRows<T>(rows: T[] | null | undefined, limit: number): AIContextPage<T> {
  const sourceRows = rows || [];
  return {
    items: sourceRows.slice(0, limit),
    truncated: sourceRows.length > limit,
  };
}

export const AI_CONTEXT_LABELS: Record<keyof typeof AI_CONTEXT_LIMITS, string> = {
  sections: "secciones",
  cattle: "hacienda",
  crops: "cultivos",
  cropApplications: "aplicaciones agrícolas",
  inventory: "inventario",
  tasks: "tareas pendientes",
  activities: "actividades",
  vaccinations: "vacunaciones recientes",
  healthEvents: "eventos sanitarios recientes",
  financials: "movimientos financieros recientes",
  inventoryMovements: "movimientos de inventario",
  weightRecords: "pesajes recientes",
  padrones: "padrones del mapa",
  mapFeatures: "infraestructura del mapa",
};

const WEATHER_CONTEXT_PATTERN = /\b(clima|tiempo|lluvia|llover|viento|pulveriz|fumig|helada|temperatura|pronóstico|pronostico|tormenta|sequía|sequia|siembra|sembrar|cosecha|cosechar|aplicación|aplicacion|labranza|pastura|forraje)\b/i;
const MAP_CONTEXT_PATTERN = /\b(mapa|padrón|padron|alambrado|aguada|portera|manga|geometría|geometria|límite|limite|camino)\b/i;
const FINANCIAL_CONTEXT_PATTERN = /\b(finanza|finanzas|financiero|ingreso|egreso|gast|costo|venta|margen|rentabilidad|presupuesto|moneda|dinero|pago|pagos)\b/i;
const INVENTORY_CONTEXT_PATTERN = /\b(inventario|stock|insumo|insumos|consumo|consumí|consumi|compr(?:a|é|e|as)|reposición|reposicion|quiebre|faltante|faltan)\b/i;

/** Only add the external weather lookup when the user is asking about it. */
export function messageNeedsWeatherContext(message: string): boolean {
  return typeof message === "string" && WEATHER_CONTEXT_PATTERN.test(message);
}

/** Only load map infrastructure when the user asks about a location or map feature. */
export function messageNeedsMapContext(message: string): boolean {
  return typeof message === "string" && MAP_CONTEXT_PATTERN.test(message);
}

/** Include recent transaction details only for financial questions. */
export function messageNeedsFinancialContext(message: string): boolean {
  return typeof message === "string" && FINANCIAL_CONTEXT_PATTERN.test(message);
}

/** Only load movement history when the question needs inventory traceability. */
export function messageNeedsInventoryContext(message: string): boolean {
  return typeof message === "string" && INVENTORY_CONTEXT_PATTERN.test(message);
}
