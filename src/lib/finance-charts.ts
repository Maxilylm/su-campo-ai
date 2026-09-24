// Pure aggregation for the finance charts (Finanzas and Métricas). Every
// function takes one currency: amounts in different currencies are never summed.

export interface ChartTransaction {
  type: "ingreso" | "egreso";
  amount: number;
  currency: string;
  date: string;
  category: string;
  section_id?: string | null;
  crop_id?: string | null;
  sections?: { name?: string | null } | null;
  crops?: { crop_type?: string | null } | null;
}

export type FlowGranularity = "day" | "week" | "month";

export interface FlowPoint {
  key: string;
  income: number;
  expenses: number;
  net: number;
  /** Movements in the bucket; 0 means the bucket is a zero-filled gap. */
  count: number;
}

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const DAY_MS = 86_400_000;

const currencyOf = (currency: string | null | undefined) => currency || "USD";

/** Days for a 7-day window, weeks for 30 days, months beyond — so every period
 * has enough points to show a shape. */
export function flowGranularity(period: string): FlowGranularity {
  if (period === "7d") return "day";
  if (period === "30d") return "week";
  return "month";
}

function parseDay(value: string): number {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Bucket of a YYYY-MM-DD date: the day, the Monday of its week, or YYYY-MM. */
export function flowBucketKey(date: string, granularity: FlowGranularity): string {
  if (granularity === "month") return date.slice(0, 7);
  const ms = parseDay(date);
  if (granularity === "day") return dayKey(ms);
  const weekday = (new Date(ms).getUTCDay() + 6) % 7; // Monday = 0
  return dayKey(ms - weekday * DAY_MS);
}

/** Every bucket from `start` to `end` inclusive, in order. */
export function flowBucketKeys(start: string, end: string, granularity: FlowGranularity): string[] {
  if (start.slice(0, 10) > end.slice(0, 10)) return [];
  const keys: string[] = [];
  if (granularity === "month") {
    let [year, month] = start.slice(0, 7).split("-").map(Number);
    const last = end.slice(0, 7);
    for (;;) {
      const key = `${year}-${String(month).padStart(2, "0")}`;
      if (key > last) break;
      keys.push(key);
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    return keys;
  }
  const step = granularity === "day" ? DAY_MS : 7 * DAY_MS;
  const last = parseDay(end);
  for (let ms = parseDay(flowBucketKey(start, granularity)); ms <= last; ms += step) keys.push(dayKey(ms));
  return keys;
}

/** "5/9" for a day or the week starting that day; "sep 26" for a month. */
export function flowBucketLabel(key: string, granularity: FlowGranularity): string {
  if (granularity === "month") {
    const [year, month] = key.split("-");
    return `${MONTHS[Number(month) - 1]} ${year.slice(2)}`;
  }
  const [, month, day] = key.split("-").map(Number);
  return `${day}/${month}`;
}

/** Income, expenses and net per bucket for one currency, zero-filled from
 * `start` to the later of `end` and the last movement. */
export function financeFlowSeries(
  transactions: ChartTransaction[],
  currency: string,
  start: string,
  end: string,
  granularity: FlowGranularity,
): FlowPoint[] {
  const inCurrency = transactions.filter((tx) => currencyOf(tx.currency) === currency && tx.date.slice(0, 10) >= start);
  const lastDate = inCurrency.reduce((latest, tx) => (tx.date.slice(0, 10) > latest ? tx.date.slice(0, 10) : latest), end);
  const points = new Map(flowBucketKeys(start, lastDate, granularity).map((key) => [key, { key, income: 0, expenses: 0, net: 0, count: 0 }]));
  for (const tx of inCurrency) {
    const point = points.get(flowBucketKey(tx.date, granularity));
    if (!point) continue;
    if (tx.type === "ingreso") point.income += tx.amount;
    else point.expenses += tx.amount;
    point.count += 1;
  }
  return [...points.values()].map((point) => ({ ...point, net: point.income - point.expenses }));
}

/** The Métricas API already groups by month and currency; zero-fill its gaps. */
export function monthlyFlowFromTrend(
  trend: { month: string; currency: string; income: number; expenses: number }[],
  currency: string,
  start: string,
  end: string,
): FlowPoint[] {
  const rows = trend.filter((row) => row.currency === currency);
  const lastMonth = rows.reduce((latest, row) => (row.month > latest ? row.month : latest), end.slice(0, 7));
  return flowBucketKeys(start, `${lastMonth}-01` > end ? `${lastMonth}-01` : end, "month").map((key) => {
    const row = rows.find((item) => item.month === key);
    const income = row?.income ?? 0;
    const expenses = row?.expenses ?? 0;
    return { key, income, expenses, net: income - expenses, count: row && (income !== 0 || expenses !== 0) ? 1 : 0 };
  });
}

/** Buckets that hold at least one movement — a chart needs two. */
export function activeFlowPoints(points: FlowPoint[]): number {
  return points.filter((point) => point.count > 0).length;
}

export interface CategoryShare { key: string; amount: number; share: number; count: number }

export const OTHERS_KEY = "__others";

/** Expenses per category in one currency, largest first, with the tail beyond
 * `topN` folded into one "Otros" row (only when it holds two or more). */
export function expensesByCategory(transactions: ChartTransaction[], currency: string, topN = 5): { rows: CategoryShare[]; total: number } {
  const byCategory = new Map<string, { amount: number; count: number }>();
  for (const tx of transactions) {
    if (tx.type !== "egreso" || currencyOf(tx.currency) !== currency) continue;
    const slot = byCategory.get(tx.category) || { amount: 0, count: 0 };
    slot.amount += tx.amount;
    slot.count += 1;
    byCategory.set(tx.category, slot);
  }
  const total = [...byCategory.values()].reduce((sum, slot) => sum + slot.amount, 0);
  const sorted = [...byCategory.entries()]
    .map(([key, slot]) => ({ key, amount: slot.amount, share: total > 0 ? slot.amount / total : 0, count: slot.count }))
    .sort((a, b) => b.amount - a.amount || a.key.localeCompare(b.key));
  if (sorted.length <= topN + 1) return { rows: sorted, total };
  const tail = sorted.slice(topN);
  const othersAmount = tail.reduce((sum, row) => sum + row.amount, 0);
  return {
    rows: [
      ...sorted.slice(0, topN),
      { key: OTHERS_KEY, amount: othersAmount, share: total > 0 ? othersAmount / total : 0, count: tail.reduce((sum, row) => sum + row.count, 0) },
    ],
    total,
  };
}

export interface DimensionResult { key: string; label: string; income: number; expenses: number; net: number }

export const UNASSIGNED_KEY = "unassigned";

/** Result (income − expenses) per section or crop in one currency, best first,
 * with movements that are not linked collected in a trailing "Sin asignar" row. */
export function resultByDimension(
  transactions: ChartTransaction[],
  currency: string,
  dimension: "section" | "crop",
  names: Record<string, string> = {},
): DimensionResult[] {
  const rows = new Map<string, DimensionResult>();
  for (const tx of transactions) {
    if (currencyOf(tx.currency) !== currency) continue;
    const id = dimension === "section" ? tx.section_id : tx.crop_id;
    const key = id || UNASSIGNED_KEY;
    const joinedName = dimension === "section" ? tx.sections?.name : tx.crops?.crop_type;
    const label = id ? joinedName || names[id] || (dimension === "section" ? "Sección sin nombre" : "Cultivo sin nombre") : "Sin asignar";
    const row = rows.get(key) || { key, label, income: 0, expenses: 0, net: 0 };
    if (tx.type === "ingreso") row.income += tx.amount;
    else row.expenses += tx.amount;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((row) => ({ ...row, net: row.income - row.expenses }))
    .sort((a, b) => Number(a.key === UNASSIGNED_KEY) - Number(b.key === UNASSIGNED_KEY) || b.net - a.net || a.label.localeCompare(b.label));
}

/** Currencies present in the movements, USD first, then alphabetical. */
export function chartCurrencies(transactions: { currency: string }[]): string[] {
  return [...new Set(transactions.map((tx) => currencyOf(tx.currency)))]
    .sort((a, b) => Number(b === "USD") - Number(a === "USD") || a.localeCompare(b));
}
