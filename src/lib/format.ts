/** es-UY grouping (dot thousands, comma decimals), max 2 decimal places. */
export function formatAmount(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("es-UY", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(n);
}

/** Format a monetary amount with es-UY grouping/decimals and its currency code. */
export function formatMoney(n: number, currency: string): string {
  return `${currency} ${formatAmount(n)}`;
}
