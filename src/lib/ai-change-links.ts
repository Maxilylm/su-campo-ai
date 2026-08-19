export interface AIChangeLink {
  label: string;
  href: string;
}

type AIChangeOperation = { table?: unknown; data?: unknown };

const TABLE_LINKS: Record<string, AIChangeLink[]> = {
  sections: [{ label: "Mi campo", href: "/gestion/campo" }],
  cattle: [{ label: "Hacienda", href: "/produccion/hacienda" }],
  activities: [{ label: "Registro", href: "/gestion/registro" }],
  vaccinations: [{ label: "Sanidad", href: "/produccion/sanidad" }],
  health_events: [{ label: "Sanidad", href: "/produccion/sanidad" }],
  crops: [{ label: "Agricultura", href: "/produccion/agricultura" }],
  crop_applications: [{ label: "Agricultura", href: "/produccion/agricultura" }],
  inventory_items: [{ label: "Inventario", href: "/gestion/inventario" }],
  inventory_movements: [{ label: "Inventario", href: "/gestion/inventario" }],
  financial_transactions: [{ label: "Finanzas", href: "/gestion/finanzas" }],
  tasks: [{ label: "Tareas", href: "/gestion/tareas" }],
  weight_records: [{ label: "Peso", href: "/produccion/peso" }],
};

/** Build stable, permission-safe destinations from the AI's affected tables. */
export function buildAIChangeLinks(operations: readonly AIChangeOperation[] | null | undefined): AIChangeLink[] {
  const links: AIChangeLink[] = [];
  const seen = new Set<string>();
  for (const operation of operations || []) {
    if (!operation || typeof operation !== "object" || typeof operation.table !== "string") continue;
    const operationLinks = [...(TABLE_LINKS[operation.table] || [])];
    if (operation.table === "inventory_movements" && operation.data && typeof operation.data === "object") {
      const data = operation.data as { type?: unknown; unit_cost?: unknown };
      if (data.type === "compra" && Number(data.unit_cost) > 0) operationLinks.push({ label: "Finanzas", href: "/gestion/finanzas" });
    }
    for (const link of operationLinks) {
      if (seen.has(link.href)) continue;
      seen.add(link.href);
      links.push(link);
    }
  }
  return links;
}
