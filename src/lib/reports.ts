// Pure aggregations for printable reports — no DB/IO, unit-testable.

export interface CattleRow { category: string; count: number }
export interface TxRow { type: string; category: string; amount: number }
export interface InvRow { name: string; current_stock: number; cost_per_unit: number | null; unit?: string }

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
  byCategory: { category: string; income: number; expense: number }[];
} {
  let income = 0, expense = 0;
  const cats = new Map<string, { income: number; expense: number }>();
  for (const t of tx) {
    const slot = cats.get(t.category) || { income: 0, expense: 0 };
    if (t.type === "ingreso") { income += t.amount; slot.income += t.amount; }
    else if (t.type === "egreso") { expense += t.amount; slot.expense += t.amount; }
    cats.set(t.category, slot);
  }
  const byCategory = [...cats.entries()]
    .map(([category, v]) => ({ category, ...v }))
    .sort((a, b) => b.income + b.expense - (a.income + a.expense));
  return { income, expense, net: income - expense, byCategory };
}

export function valuateInventory(items: InvRow[]): {
  rows: { name: string; stock: number; unit: string; cost: number; value: number }[];
  total: number;
} {
  const rows = items.map((i) => ({
    name: i.name,
    stock: i.current_stock,
    unit: i.unit || "",
    cost: i.cost_per_unit || 0,
    value: i.current_stock * (i.cost_per_unit || 0),
  }));
  const total = rows.reduce((s, r) => s + r.value, 0);
  return { rows, total };
}
