import { addCalendarDays } from "./date";

/** Inclusive lower date for a financial report period, counted back from the
 * calendar day `today` (YYYY-MM-DD). Servers pass `farmLocalToday()`; the
 * browser passes its own day. Taking a Date here read the process's day,
 * which on the UTC server is already tomorrow after 21:00 in Uruguay. */
export function financialPeriodStart(period: string, today: string): string {
  switch (period) {
    case "7d":
      return addCalendarDays(today, -7) ?? today;
    case "90d":
      return addCalendarDays(today, -90) ?? today;
    case "year": {
      const [year, month, day] = today.split("-").map(Number);
      // 29 Feb → 1 Mar of the previous year, matching Date#setFullYear.
      return addCalendarDays(`${year - 1}-${String(month).padStart(2, "0")}-01`, day - 1) ?? today;
    }
    default: // 30d
      return addCalendarDays(today, -30) ?? today;
  }
}
