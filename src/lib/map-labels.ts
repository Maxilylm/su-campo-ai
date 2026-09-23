// Markup for Leaflet labels. `L.divIcon({ html })` and `bindTooltip(string)`
// both assign innerHTML, and everything shown on the map — section names and
// colors, padrón codes, feature names — is written by farm members or by the
// assistant. Every value goes through here so none of it is parsed as HTML.

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_COLOR.test(value);
}

export const DEFAULT_SECTION_COLOR = "#22c55e";

/** Colors land inside a style attribute, where escaping alone would still let
 * a value add declarations; only a plain #rrggbb is ever emitted. Rows saved
 * before validation existed fall back to the default instead of breaking. */
export function safeHexColor(value: unknown, fallback = DEFAULT_SECTION_COLOR): string {
  return isHexColor(value) ? value : fallback;
}

/** Tooltip content as a text node, so Leaflet never parses it. */
export function textTooltip(value: string): HTMLElement {
  const span = document.createElement("span");
  span.textContent = value;
  return span;
}

export interface MapLabelOptions {
  /** Hex opacity suffix for the label background, e.g. "33". */
  backgroundAlpha?: string;
  /** Secondary line under the name (occupancy, crop, rest days). */
  detail?: string | null;
}

export function mapLabelHtml(text: string, color: unknown, options: MapLabelOptions = {}): string {
  const safeColor = safeHexColor(color);
  const alpha = options.backgroundAlpha ?? "33";
  const detail = options.detail
    ? `<div style="font-size:10px;font-weight:500;opacity:0.95">${escapeHtml(options.detail)}</div>`
    : "";
  return `<div style="background:${safeColor}${alpha};border:1px solid ${safeColor};border-radius:6px;padding:2px 8px;font-size:11px;color:white;white-space:nowrap;font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,0.8)">${escapeHtml(text)}${detail}</div>`;
}
