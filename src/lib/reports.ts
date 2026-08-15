// Pure aggregations for printable reports — no DB/IO, unit-testable.

export interface CattleRow { category: string; count: number }
export interface TxRow {
  type: string;
  category: string;
  amount: number;
  currency?: string | null;
  section_id?: string | null;
  sections?: { name?: string } | null;
}

export function filterFinancialTransactions<T extends Pick<TxRow, "section_id" | "currency">>(
  transactions: T[],
  sectionId = "all",
  currency = "all",
): T[] {
  return transactions.filter((transaction) => {
    const matchesSection = sectionId === "all"
      || (sectionId === "unassigned" ? !transaction.section_id : transaction.section_id === sectionId);
    const matchesCurrency = currency === "all" || (transaction.currency || "USD") === currency;
    return matchesSection && matchesCurrency;
  });
}
export interface InvRow { name: string; current_stock: number; cost_per_unit: number | null; unit?: string; currency?: string | null }

export function sumCattleByCategory(cattle: CattleRow[]): { category: string; count: number }[] {
  const map = new Map<string, number>();
  for (const c of cattle) map.set(c.category, (map.get(c.category) || 0) + c.count);
  return [...map.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count);
}

export function totalHead(cattle: CattleRow[]): number {
  return cattle.reduce((s, c) => s + c.count, 0);
}

export function summarizeFinances(tx: TxRow[]): {
  income: number; expense: number; net: number;
  byCurrency: { currency: string; income: number; expense: number; net: number }[];
  byCategory: { category: string; currency: string; income: number; expense: number }[];
} {
  let income = 0, expense = 0;
  const cats = new Map<string, { category: string; currency: string; income: number; expense: number }>();
  const currencies = new Map<string, { income: number; expense: number }>();
  for (const t of tx) {
    const currency = t.currency || "USD";
    const currencySlot = currencies.get(currency) || { income: 0, expense: 0 };
    const key = `${currency}:${t.category}`;
    const slot = cats.get(key) || { category: t.category, currency, income: 0, expense: 0 };
    if (t.type === "ingreso") { income += t.amount; currencySlot.income += t.amount; slot.income += t.amount; }
    else if (t.type === "egreso") { expense += t.amount; currencySlot.expense += t.amount; slot.expense += t.amount; }
    else continue;
    cats.set(key, slot);
    currencies.set(currency, currencySlot);
  }
  const byCurrency = [...currencies.entries()]
    .map(([currency, v]) => ({ currency, ...v, net: v.income - v.expense }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  const byCategory = [...cats.values()]
    .sort((a, b) => b.income + b.expense - (a.income + a.expense));
  const comparable = byCurrency.length <= 1;
  return {
    income: comparable ? income : 0,
    expense: comparable ? expense : 0,
    net: comparable ? income - expense : 0,
    byCurrency,
    byCategory,
  };
}

export function summarizeFinancesBySection(tx: TxRow[]): {
  sectionId: string;
  sectionName: string;
  currency: string;
  income: number;
  expense: number;
  net: number;
}[] {
  const rows = new Map<string, {
    sectionId: string;
    sectionName: string;
    currency: string;
    income: number;
    expense: number;
  }>();

  for (const item of tx) {
    if (item.type !== "ingreso" && item.type !== "egreso") continue;
    const sectionId = item.section_id || "unassigned";
    const sectionName = item.sections?.name || "Sin asignar";
    const currency = item.currency || "USD";
    const key = `${sectionId}:${currency}`;
    const row = rows.get(key) || { sectionId, sectionName, currency, income: 0, expense: 0 };
    if (item.type === "ingreso") row.income += item.amount;
    else row.expense += item.amount;
    rows.set(key, row);
  }

  return [...rows.values()]
    .map((row) => ({ ...row, net: row.income - row.expense }))
    .sort((a, b) => a.sectionName.localeCompare(b.sectionName) || a.currency.localeCompare(b.currency));
}

export function valuateInventory(items: InvRow[]): {
  rows: { name: string; stock: number; unit: string; cost: number; value: number; currency: string }[];
  total: number;
  byCurrency: { currency: string; total: number }[];
} {
  const rows = items.map((i) => ({
    name: i.name,
    stock: i.current_stock,
    unit: i.unit || "",
    cost: i.cost_per_unit || 0,
    value: i.current_stock * (i.cost_per_unit || 0),
    currency: i.currency || "USD",
  }));
  const totals = new Map<string, number>();
  for (const row of rows) totals.set(row.currency, (totals.get(row.currency) || 0) + row.value);
  const byCurrency = [...totals.entries()]
    .map(([currency, total]) => ({ currency, total }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  return { rows, total: byCurrency.length <= 1 ? (byCurrency[0]?.total || 0) : 0, byCurrency };
}
