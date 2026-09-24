"use client";

import { StatStrip } from "@/components/StatCard";
import { formatAmount } from "@/lib/format";
import type { CurrencyTotals } from "@/lib/finance-summary";

/** Ingresos / Egresos / Resultado, one strip per currency — never mixed.
 * Only the net result carries a tone. */
export function FinanceSummary({ totalsByCurrency }: { totalsByCurrency: Record<string, CurrencyTotals> }) {
  const entries = Object.entries(totalsByCurrency);
  const rows: [string, CurrencyTotals][] = entries.length === 0 ? [["USD", { income: 0, expenses: 0 }]] : entries;
  return (
    <div className="space-y-3">
      {rows.map(([currency, totals]) => {
        const net = totals.income - totals.expenses;
        return (
          <StatStrip
            key={currency}
            items={[
              { label: "Ingresos", value: formatAmount(totals.income), unit: currency },
              { label: "Egresos", value: formatAmount(totals.expenses), unit: currency },
              {
                label: "Resultado",
                value: `${net > 0 ? "+" : net < 0 ? "−" : ""}${formatAmount(Math.abs(net))}`,
                unit: currency,
                tone: net > 0 ? "ok" : net < 0 ? "bad" : undefined,
              },
            ]}
          />
        );
      })}
    </div>
  );
}
