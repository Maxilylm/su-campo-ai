/** Return the inclusive lower date for a financial report period. */
export function financialPeriodStart(period: string, now = new Date()): string {
  const start = new Date(now);
  switch (period) {
    case "7d":
      start.setDate(start.getDate() - 7);
      break;
    case "90d":
      start.setDate(start.getDate() - 90);
      break;
    case "year":
      start.setFullYear(start.getFullYear() - 1);
      break;
    default: // 30d
      start.setDate(start.getDate() - 30);
  }
  // `date` is a SQL DATE column. Return a date-only value so the boundary
  // does not depend on timezone casting.
  return start.toISOString().slice(0, 10);
}
