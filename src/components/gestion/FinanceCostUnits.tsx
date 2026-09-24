import { costUnitLabel, type CostUnitRow } from "@/lib/finance-summary";
import { cn } from "@/lib/utils";
import { Money } from "./Figures";

const HEAD = "px-4 py-2 text-xs font-medium text-muted-foreground";

/** Expenses linked to each cattle batch or crop, total and per head / per ha. */
export function FinanceCostUnits({ rows }: { rows: CostUnitRow[] }) {
  if (rows.length === 0) return null;
  return (
    <section aria-labelledby="finance-cost-units-title" className="space-y-3">
      <div>
        <h2 id="finance-cost-units-title" className="text-base font-semibold">Costo por unidad</h2>
        <p className="text-sm text-muted-foreground">Egresos del período vinculados a cada lote o cultivo.</p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr>
              <th scope="col" className={cn(HEAD, "text-left")}>Lote o cultivo</th>
              <th scope="col" className={cn(HEAD, "text-right")}>Total</th>
              <th scope="col" className={cn(HEAD, "text-right")}>Por unidad</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row, i) => (
              <tr key={`${row.label}-${row.currency}-${i}`}>
                <td className="px-4 py-3">
                  <span className="block font-medium">{row.label}</span>
                  <span className="text-xs text-muted-foreground"><span className="figure">{row.count}</span> {costUnitLabel(row.unit, row.count)}</span>
                </td>
                <td className="px-4 py-3 text-right"><Money amount={row.totalCost} currency={row.currency} /></td>
                <td className="px-4 py-3 text-right">
                  <Money amount={row.perUnit} currency={row.currency} className="font-semibold" />
                  <span className="block text-xs text-muted-foreground">por {row.unit === "ha" ? "ha" : "cabeza"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
