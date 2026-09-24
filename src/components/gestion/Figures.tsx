import { formatAmount } from "@/lib/format";
import { cn } from "@/lib/utils";

/** Amount as a condensed tabular figure with the currency code small and muted after it.
 * `sign` prefixes "+" / "−" to show direction without color. */
export function Money({ amount, currency, sign, className }: {
  amount: number;
  currency: string;
  sign?: "+" | "-";
  className?: string;
}) {
  return (
    <span className={cn("whitespace-nowrap", className)}>
      <span className="figure">{sign === "-" ? "−" : sign}{formatAmount(amount)}</span>
      <span className="ml-1 text-xs font-normal text-muted-foreground">{currency}</span>
    </span>
  );
}

/** Quantity figure with its unit small and muted after it. */
export function Quantity({ value, unit, className }: { value: number | string; unit?: string | null; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap", className)}>
      <span className="figure">{value}</span>
      {unit && <span className="ml-1 text-xs font-normal text-muted-foreground">{unit}</span>}
    </span>
  );
}
