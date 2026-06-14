// Pure alert-derivation logic — no DB access, so it can be unit-tested.
// The route fetches rows and calls buildAlerts(); the home page renders the result.

export type AlertKind = "vaccination" | "stock" | "health" | "harvest";
export type AlertSeverity = "high" | "medium";

export interface Alert {
  id: string;
  kind: AlertKind;
  severity: AlertSeverity;
  title: string;
  detail: string;
  href: string;
}

export interface AlertInputs {
  vaccinations: { id: string; vaccine_name: string; next_due: string | null; sections?: { name: string } | null }[];
  inventory: { id: string; name: string; current_stock: number; min_stock: number | null; unit: string }[];
  health: { id: string; type: string; description: string; resolved: boolean | null }[];
  crops: {
    id: string; crop_type: string; status: string | null;
    expected_harvest: string | null; actual_harvest: string | null;
    sections?: { name: string } | null;
  }[];
}

const DAY = 86_400_000;
const HORIZON_DAYS = 30;

function daysUntil(iso: string, now: number): number {
  return Math.round((new Date(iso).getTime() - now) / DAY);
}

const fmt = (iso: string) => new Date(iso).toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit" });

export function buildAlerts(input: AlertInputs, now: number): Alert[] {
  const alerts: Alert[] = [];

  for (const v of input.vaccinations) {
    if (!v.next_due) continue;
    const d = daysUntil(v.next_due, now);
    if (d > HORIZON_DAYS) continue;
    const where = v.sections?.name ? ` en ${v.sections.name}` : "";
    alerts.push({
      id: `vac-${v.id}`,
      kind: "vaccination",
      severity: d < 0 ? "high" : "medium",
      title: `Vacunación: ${v.vaccine_name}`,
      detail: d < 0 ? `Vencida hace ${Math.abs(d)}d${where}` : d === 0 ? `Vence hoy${where}` : `Vence en ${d}d (${fmt(v.next_due)})${where}`,
      href: "/produccion/sanidad",
    });
  }

  for (const it of input.inventory) {
    if (it.min_stock == null || it.current_stock >= it.min_stock) continue;
    alerts.push({
      id: `stk-${it.id}`,
      kind: "stock",
      severity: it.current_stock <= 0 ? "high" : "medium",
      title: `Stock bajo: ${it.name}`,
      detail: `${it.current_stock} ${it.unit} (mín ${it.min_stock})`,
      href: "/gestion/inventario",
    });
  }

  for (const h of input.health) {
    if (h.resolved) continue;
    alerts.push({
      id: `hlt-${h.id}`,
      kind: "health",
      severity: "medium",
      title: `Sanidad pendiente: ${h.type}`,
      detail: h.description,
      href: "/produccion/sanidad",
    });
  }

  for (const c of input.crops) {
    if (!c.expected_harvest || c.actual_harvest) continue;
    if (c.status === "harvested" || c.status === "failed") continue;
    const d = daysUntil(c.expected_harvest, now);
    if (d > HORIZON_DAYS) continue;
    const where = c.sections?.name ? ` en ${c.sections.name}` : "";
    alerts.push({
      id: `crp-${c.id}`,
      kind: "harvest",
      severity: d < 0 ? "high" : "medium",
      title: `Cosecha: ${c.crop_type}`,
      detail: d < 0 ? `Atrasada ${Math.abs(d)}d${where}` : d === 0 ? `Cosechar hoy${where}` : `En ${d}d (${fmt(c.expected_harvest)})${where}`,
      href: "/produccion/agricultura",
    });
  }

  // High severity first; stable within a severity.
  return alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "high" ? -1 : 1));
}
