// Shared recharts styling. Every color is a CSS variable from globals.css, so
// the charts follow the light/dark theme without re-rendering.

export const axisTick = { fill: "var(--muted-foreground)", fontSize: 11 };
export const axisLine = { stroke: "var(--border)" };
export const gridStroke = "var(--border)";
export const tooltipStyle = {
  backgroundColor: "var(--popover)",
  color: "var(--popover-foreground)",
  border: "1px solid var(--border)",
  borderRadius: "6px",
  fontSize: "12px",
  boxShadow: "0 2px 8px rgb(0 0 0 / 0.12)",
};
export const tooltipLabelStyle = { color: "var(--muted-foreground)" };
export const tooltipItemStyle = { color: "var(--popover-foreground)" };
export const cursorFill = { fill: "var(--muted)" };
export const cursorStroke = { stroke: "var(--border)" };

// Income / expense are identities, not states. The pair was checked with the
// dataviz palette validator against the card surface in both themes: the info
// blue is stepped 20 % toward the card so it stays clear of the primary green
// for color-blind readers (CVD ΔE 15 light / 17.5 dark, normal vision ΔE ≥ 16.7).
// Position (income above zero, expenses below) is the second channel.
export const INCOME_COLOR = "var(--primary)";
export const EXPENSE_COLOR = "color-mix(in oklab, var(--info) 80%, var(--card))";
/** Net result line: ink, so it reads over both bar colors. */
export const NET_COLOR = "var(--foreground)";
/** A single-series magnitude (counts, one measure): the primary hue. */
export const SERIES_COLOR = "var(--primary)";
/** Diverging polarity: result or weight gain above / below zero is a state. */
export const GAIN_COLOR = "var(--ok)";
export const LOSS_COLOR = "var(--bad)";
