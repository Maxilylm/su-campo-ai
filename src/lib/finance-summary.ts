// Pure aggregation for the Finanzas page: totals per currency and cost per unit.

interface SummaryTransaction {
  type: "ingreso" | "egreso";
  amount: number;
  currency: string;
  cattle_id?: string | null;
  crop_id?: string | null;
}

export interface CurrencyTotals { income: number; expenses: number }

/** Income and expenses per currency — currencies are never mixed. */
export function financeTotalsByCurrency(transactions: SummaryTransaction[]): Record<string, CurrencyTotals> {
  return transactions.reduce<Record<string, CurrencyTotals>>((totals, tx) => {
    const slot = totals[tx.currency] || { income: 0, expenses: 0 };
    if (tx.type === "ingreso") slot.income += tx.amount;
    else slot.expenses += tx.amount;
    totals[tx.currency] = slot;
    return totals;
  }, {});
}

export interface CostUnitRow {
  label: string;
  totalCost: number;
  perUnit: number;
  unit: "cabeza" | "ha";
  count: number;
  currency: string;
}

function expensesByCurrency(transactions: SummaryTransaction[], matches: (tx: SummaryTransaction) => boolean): Map<string, number> {
  const byCurrency = new Map<string, number>();
  transactions
    .filter((tx) => tx.type === "egreso" && matches(tx))
    .forEach((tx) => byCurrency.set(tx.currency, (byCurrency.get(tx.currency) || 0) + tx.amount));
  return byCurrency;
}

/** Expenses linked to each cattle batch (per head) and crop (per planted ha),
 * one row per currency. Batches or crops without linked expenses are omitted. */
export function costPerUnitRows(
  transactions: SummaryTransaction[],
  cattle: { id: string; category: string; breed: string | null; count: number }[],
  crops: { id: string; crop_type: string; planted_hectares: number | null }[],
): CostUnitRow[] {
  const cattleCosts = cattle.flatMap((batch) =>
    Array.from(expensesByCurrency(transactions, (tx) => tx.cattle_id === batch.id), ([currency, totalCost]) => ({
      label: `${batch.category}${batch.breed ? ` (${batch.breed})` : ""}`,
      totalCost,
      perUnit: batch.count > 0 ? totalCost / batch.count : 0,
      unit: "cabeza" as const,
      count: batch.count,
      currency,
    })));
  const cropCosts = crops.flatMap((crop) =>
    Array.from(expensesByCurrency(transactions, (tx) => tx.crop_id === crop.id), ([currency, totalCost]) => ({
      label: crop.crop_type,
      totalCost,
      perUnit: crop.planted_hectares && crop.planted_hectares > 0 ? totalCost / crop.planted_hectares : 0,
      unit: "ha" as const,
      count: crop.planted_hectares || 0,
      currency,
    })));
  return [...cattleCosts, ...cropCosts];
}

/** "1 cabeza", "12 cabezas", "35 ha" — ha never takes an s. */
export function costUnitLabel(unit: CostUnitRow["unit"], count: number): string {
  if (unit === "ha") return "ha";
  return count === 1 ? "cabeza" : "cabezas";
}
