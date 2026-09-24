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
  /** Lighter chip for secondary labels (padrón names, point-placed potreros). */
  muted?: boolean;
  /** Secondary line under the name (occupancy, crop, rest days). */
  detail?: string | null;
  /** Where the label sits relative to its point: centered on it (default),
   * or hanging below it for labels pinned to a parcel's top edge. */
  anchor?: "center" | "top";
}

/**
 * Labels sit on the map tiles, not on the page, so they ignore the app theme:
 * a near-black translucent chip with white text reads on satellite imagery and
 * on light street tiles alike (white on the chip over white tiles is ≥ 6:1).
 * The section's own color only marks the dot and the chip's border.
 */
export function mapLabelHtml(text: string, color: unknown, options: MapLabelOptions = {}): string {
  const safeColor = safeHexColor(color);
  const chipAlpha = options.muted ? "0.66" : "0.8";
  const detail = options.detail
    ? `<div style="font-size:10px;font-weight:500;color:rgba(255,255,255,0.88)">${escapeHtml(options.detail)}</div>`
    : "";
  const transform = options.anchor === "top" ? "translate(-50%,4px)" : "translate(-50%,-50%)";
  const dot = `<span style="display:inline-block;width:7px;height:7px;margin-right:5px;border-radius:9999px;vertical-align:1px;background:${safeColor};box-shadow:0 0 0 1px rgba(255,255,255,0.75)"></span>`;
  return `<div style="position:absolute;transform:${transform};text-align:center;background:rgba(16,22,18,${chipAlpha});border:1px solid ${safeColor};border-radius:6px;padding:2px 7px;font-size:11px;line-height:1.35;color:#ffffff;white-space:nowrap;font-weight:600;box-shadow:0 1px 3px rgba(0,0,0,0.45)">${dot}${escapeHtml(text)}${detail}</div>`;
}
