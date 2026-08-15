export type ActivityFilter = "all" | "movement" | "count_update" | "health" | "note" | "setup" | "registration";

export interface ActivityMetadata {
  table?: string | null;
  record_id?: string | null;
}

export const ACTIVITY_FILTERS: { value: ActivityFilter; label: string }[] = [
  { value: "all", label: "Todas" },
  { value: "movement", label: "Movimientos" },
  { value: "count_update", label: "Hacienda" },
  { value: "health", label: "Sanidad" },
  { value: "note", label: "Notas" },
  { value: "setup", label: "Configuración" },
  { value: "registration", label: "Registros" },
];

export function filterActivities<T extends {
  type: string;
  description?: string | null;
  raw_message?: string | null;
  message_type?: string | null;
}>(activities: T[], filter: ActivityFilter, query = ""): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return activities.filter((activity) => {
    if (filter !== "all" && activity.type !== filter) return false;
    if (!normalizedQuery) return true;
    return [activity.description, activity.raw_message, activity.message_type]
      .some((value) => value?.toLocaleLowerCase().includes(normalizedQuery));
  });
}

export function activityHref(activity: { metadata?: ActivityMetadata | null }): string | null {
  const table = activity.metadata?.table;
  const id = activity.metadata?.record_id;
  const encodedId = id ? encodeURIComponent(id) : "";
  switch (table) {
    case "farms": return "/gestion/campo";
    case "sections": return encodedId ? `/produccion/hacienda?sectionId=${encodedId}` : "/produccion/hacienda";
    case "cattle": return encodedId ? `/produccion/hacienda?cattleId=${encodedId}` : "/produccion/hacienda";
    case "crops": return encodedId ? `/produccion/agricultura?cropId=${encodedId}` : "/produccion/agricultura";
    case "vaccinations": return encodedId ? `/produccion/sanidad?vaccinationId=${encodedId}` : "/produccion/sanidad";
    case "health_events": return encodedId ? `/produccion/sanidad?healthId=${encodedId}` : "/produccion/sanidad";
    case "weight_records": return encodedId ? `/produccion/peso?weightId=${encodedId}` : "/produccion/peso";
    case "inventory_items": return encodedId ? `/gestion/inventario?itemId=${encodedId}` : "/gestion/inventario";
    case "inventory_movements": return encodedId ? `/gestion/inventario?movementId=${encodedId}` : "/gestion/inventario";
    case "financial_transactions": return encodedId ? `/gestion/finanzas?transactionId=${encodedId}` : "/gestion/finanzas";
    case "tasks": return encodedId ? `/gestion/tareas?taskId=${encodedId}` : "/gestion/tareas";
    case "padrones": return encodedId ? `/mapa?padronId=${encodedId}` : "/mapa";
    case "map_features": return encodedId ? `/mapa?featureId=${encodedId}` : "/mapa";
    case "crop_applications": return encodedId ? `/produccion/agricultura?applicationId=${encodedId}` : "/produccion/agricultura";
    default: return null;
  }
}
