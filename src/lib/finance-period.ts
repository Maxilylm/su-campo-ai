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
  // `date` is a SQL DATE column. Format the caller's local calendar day:
  // toISOString() would give the UTC day, which is already tomorrow after
  // 21:00 in Uruguay and made the browser's cached view drop a boundary day.
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`;
}
