// "Esta semana": what is coming after the next two days, and whether the
// supplies it needs are in stock — so a vaccination on Sunday becomes a
// purchase on Thursday, not a surprise at the manga.

export interface SupplyItem {
  name: string;
  category: string;
  unit: string;
  current_stock: number | string | null;
}

export interface DueVaccination {
  id: string;
  vaccine: string;
  date: string;
  sectionId: string | null;
  sectionName: string | null;
}

export type SupplyStatus = "ok" | "short" | "missing";

export interface SupplyCheck {
  id: string;
  vaccine: string;
  date: string;
  where: string;
  dosesNeeded: number;
  itemName: string | null;
  inStock: number | null;
  status: SupplyStatus;
  /** Spanish one-liner for the plan, WhatsApp and the assistant. */
  summary: string;
}

function normalize(value: string): string {
  return value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/** The medicine item whose name contains the vaccine's name (or vice versa),
 * preferring items counted in doses. */
export function matchSupply(vaccine: string, items: SupplyItem[]): SupplyItem | null {
  const target = normalize(vaccine);
  if (!target) return null;
  const candidates = items.filter((item) => {
    if (item.category !== "medicamento") return false;
    const name = normalize(item.name);
    return name.includes(target) || (name.length >= 4 && target.includes(name));
  });
  return candidates.find((item) => item.unit === "dosis") ?? candidates[0] ?? null;
}

/** One dose per head present where the vaccination applies (its potrero, or
 * the whole farm when it names none). */
export function vaccinationSupplyChecks(
  vaccinations: DueVaccination[],
  items: SupplyItem[],
  headsBySection: Map<string, number>,
  totalHeads: number,
): SupplyCheck[] {
  // The same vaccine due twice this week needs the doses of both.
  const neededByItem = new Map<string, number>();
  const rows = vaccinations.map((vaccination) => {
    const dosesNeeded = vaccination.sectionId ? headsBySection.get(vaccination.sectionId) ?? 0 : totalHeads;
    const item = matchSupply(vaccination.vaccine, items);
    if (item) neededByItem.set(item.name, (neededByItem.get(item.name) ?? 0) + dosesNeeded);
    return { vaccination, dosesNeeded, item };
  });

  return rows.map(({ vaccination, dosesNeeded, item }) => {
    const where = vaccination.sectionName ?? "todo el campo";
    const base = { id: vaccination.id, vaccine: vaccination.vaccine, date: vaccination.date, where, dosesNeeded };
    if (!item) {
      return { ...base, itemName: null, inStock: null, status: "missing" as const, summary: `${vaccination.vaccine}: ${dosesNeeded} dosis para ${where}; no hay insumo registrado en inventario` };
    }
    const inStock = Number(item.current_stock) || 0;
    const totalNeeded = neededByItem.get(item.name) ?? dosesNeeded;
    const unit = item.unit === "dosis" ? "dosis" : item.unit;
    if (inStock >= totalNeeded) {
      return { ...base, itemName: item.name, inStock, status: "ok" as const, summary: `${vaccination.vaccine}: ${dosesNeeded} dosis para ${where}; hay ${inStock} ${unit} en stock` };
    }
    return { ...base, itemName: item.name, inStock, status: "short" as const, summary: `${vaccination.vaccine}: ${dosesNeeded} dosis para ${where}; hay ${inStock} ${unit}, faltan ${totalNeeded - inStock}` };
  });
}

export interface WeekDay<T> {
  date: string;
  items: T[];
}

/** Items after the daily plan's lookahead, up to a week, grouped by day. */
export function groupWeek<T extends { date: string; daysFromNow: number }>(items: T[], afterDays: number, untilDays = 7): WeekDay<T>[] {
  const days = new Map<string, T[]>();
  for (const item of items) {
    if (item.daysFromNow <= afterDays || item.daysFromNow > untilDays) continue;
    const list = days.get(item.date) ?? [];
    list.push(item);
    days.set(item.date, list);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, dayItems]) => ({ date, items: dayItems }));
}
