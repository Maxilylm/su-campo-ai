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
