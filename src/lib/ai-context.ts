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
  weightRecords: 20,
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
  weightRecords: "pesajes recientes",
};
