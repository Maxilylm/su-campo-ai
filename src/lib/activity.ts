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

/** "24/9, 08:15" in the viewer's zone; empty for an unreadable timestamp. */
export function formatActivityDate(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

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

// ── Presentation ──
// The audit trigger (012/035) logs every row change as "Update cattle
// (<uuid>)". Shown raw, the home feed printed internal ids and repeated what a
// readable entry right next to it already said ("Movidas 48 cabezas…").

const AUDIT_TABLE_LABELS: Record<string, [string, "m" | "f"]> = {
  sections: ["Sección", "f"],
  cattle: ["Lote de hacienda", "m"],
  crops: ["Cultivo", "m"],
  crop_applications: ["Aplicación", "f"],
  inventory_items: ["Insumo", "m"],
  inventory_movements: ["Movimiento de inventario", "m"],
  financial_transactions: ["Movimiento financiero", "m"],
  vaccinations: ["Vacunación", "f"],
  health_events: ["Evento sanitario", "m"],
  weight_records: ["Pesaje", "m"],
  padrones: ["Padrón", "m"],
  map_features: ["Elemento del mapa", "m"],
  tasks: ["Tarea", "f"],
};

const AUDIT_ACTIONS: Record<string, [string, string]> = {
  insert: ["registrado", "registrada"],
  update: ["actualizado", "actualizada"],
  delete: ["eliminado", "eliminada"],
};

export interface PresentableActivity {
  id: string;
  type: string;
  description: string;
  created_at: string;
  metadata?: (ActivityMetadata & { action?: string | null }) | null;
}

const AUDIT_DESCRIPTION = /^(insert|update|delete) [a-z_ ]+ \([0-9a-f-]{36}\)$/i;

export function isAuditActivity(activity: PresentableActivity): boolean {
  return activity.type === "registration"
    && typeof activity.metadata?.table === "string"
    && AUDIT_DESCRIPTION.test(activity.description.trim());
}

/** "Update cattle (uuid)" → "Lote de hacienda actualizado"; others unchanged. */
export function humanizeActivityDescription(activity: PresentableActivity): string {
  if (!isAuditActivity(activity)) return activity.description;
  const table = activity.metadata?.table ?? "";
  const action = (activity.metadata?.action ?? activity.description.split(" ")[0]).toLowerCase();
  const [label, gender] = AUDIT_TABLE_LABELS[table] ?? ["Registro", "m"];
  const verbs = AUDIT_ACTIONS[action] ?? ["modificado", "modificada"];
  return `${label} ${gender === "f" ? verbs[1] : verbs[0]}`;
}

const SIDE_EFFECT_WINDOW_MS = 10_000;

/** For a short feed: humanize audit rows, drop the ones that are side effects
 * of a readable activity logged within seconds of them, and merge bursts of
 * the same audit row. Newest first in, newest first out. */
export function presentActivities<T extends PresentableActivity>(activities: T[]): Array<T & { count: number }> {
  const readableTimes = activities
    .filter((activity) => !isAuditActivity(activity))
    .map((activity) => Date.parse(activity.created_at))
    .filter(Number.isFinite);

  const out: Array<T & { count: number }> = [];
  for (const activity of activities) {
    if (!isAuditActivity(activity)) {
      out.push({ ...activity, count: 1 });
      continue;
    }
    const at = Date.parse(activity.created_at);
    if (readableTimes.some((time) => Math.abs(time - at) <= SIDE_EFFECT_WINDOW_MS)) continue;
    const description = humanizeActivityDescription(activity);
    const previous = out[out.length - 1];
    if (previous && isAuditActivity(previous) && humanizeActivityDescription(previous) === description
      && Math.abs(Date.parse(previous.created_at) - at) <= SIDE_EFFECT_WINDOW_MS) {
      previous.count += 1;
      continue;
    }
    out.push({ ...activity, count: 1 });
  }
  return out.map((activity) => ({
    ...activity,
    description: isAuditActivity(activity)
      ? `${humanizeActivityDescription(activity)}${activity.count > 1 ? ` (${activity.count} registros)` : ""}`
      : activity.description,
  }));
}
