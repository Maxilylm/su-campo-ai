import { isHexColor } from "./map-labels";

// Shared by the REST routes and the AI validator so a section can only be
// written in one shape, whichever path writes it.

export const SECTION_WATER_STATUS = new Set(["bueno", "bajo", "seco", "inundado"]);
export const SECTION_PASTURE_STATUS = new Set(["bueno", "sobrepastoreado", "seco", "creciendo"]);

const MAX_POLYGON_VERTICES = 500;

function isCoordinate(value: unknown): boolean {
  if (!Array.isArray(value) || value.length < 2) return false;
  const [lng, lat] = value;
  return typeof lng === "number" && typeof lat === "number"
    && Number.isFinite(lng) && Number.isFinite(lat)
    && lng >= -180 && lng <= 180 && lat >= -90 && lat <= 90;
}

/** `sections.map_center` holds either a label point `{lat, lng}` or a drawn
 * GeoJSON Polygon. Every member's map renders it, so a malformed value must
 * never be stored. */
export function isValidSectionMapCenter(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  if (record.type === "Polygon") {
    const rings = record.coordinates;
    if (!Array.isArray(rings) || rings.length !== 1) return false;
    const ring = rings[0];
    return Array.isArray(ring) && ring.length >= 4 && ring.length <= MAX_POLYGON_VERTICES && ring.every(isCoordinate);
  }
  if ("type" in record) return false;
  return isCoordinate([record.lng, record.lat]);
}

/** Returns a Spanish error for the first invalid optional section field, or null. */
export function sectionFieldError(body: Record<string, unknown>): string | null {
  if (body.color != null && body.color !== "" && !isHexColor(body.color)) return "color inválido: usá #rrggbb";
  if (body.waterStatus != null && body.waterStatus !== "" && !SECTION_WATER_STATUS.has(String(body.waterStatus))) return "waterStatus inválido";
  if (body.pastureStatus != null && body.pastureStatus !== "" && !SECTION_PASTURE_STATUS.has(String(body.pastureStatus))) return "pastureStatus inválido";
  if ("mapCenter" in body && !isValidSectionMapCenter(body.mapCenter)) return "mapCenter inválido";
  return null;
}
