// Leaflet layer builders for FarmMap. Every piece of text that reaches the map
// goes through mapLabelHtml / textTooltip, which escape it.

import L from "leaflet";
import { mapLabelHtml, safeHexColor, textTooltip } from "@/lib/map-labels";
import type { SectionFieldStatus } from "@/lib/grazing";
import type { FieldGraph } from "@/lib/field-graph";
import {
  FALLBACK_FEATURE_COLOR, LINDERO_COLOR, ROUTE_COLOR, STOCKING_FILL, featureType, padronColor,
  type MapFeature, type Padron,
} from "./constants";

const featureMarkerHtml = (icon: string, style: string) => `<div style="${style}">${icon}</div>`;

/** A padrón's outline plus its potreros (drawn areas, pinned points, or plain names on the top edge). */
export function buildPadronLayer(p: Padron, index: number, statusById: Map<string, SectionFieldStatus>, showCattle: boolean): L.LayerGroup {
  const labelDetail = (id: string) => {
    const status = statusById.get(id);
    if (!status) return null;
    return showCattle ? status.summary : status.crops.map((crop) => crop.label).join(" + ") || null;
  };
  const color = padronColor(index);
  const group = L.layerGroup();

  const polygon = L.geoJSON(p.geometry as GeoJSON.GeoJsonObject, {
    style: { color, weight: 3, fillColor: color, fillOpacity: 0.15 },
  });

  const padronCenter = polygon.getBounds().getCenter();

  const sections = p.sections || [];
  const sectionsWithGeo = sections.filter((s) => s.map_center?.type === "Polygon");
  const sectionsWithPoint = sections.filter((s) => s.map_center && !s.map_center.type);
  const sectionsPlain = sections.filter((s) => !s.map_center);

  // Polygon sub-sections
  for (const s of sectionsWithGeo) {
    const geo = s.map_center as unknown as GeoJSON.Polygon;
    const stockingFill = showCattle ? STOCKING_FILL[statusById.get(s.id)?.stocking ?? "empty"] : undefined;
    const subPoly = L.geoJSON(geo as GeoJSON.GeoJsonObject, {
      style: {
        color: safeHexColor(s.color),
        weight: 2,
        fillColor: stockingFill ?? safeHexColor(s.color),
        fillOpacity: stockingFill ? 0.4 : 0.2,
      },
    });
    const subCenter = subPoly.getBounds().getCenter();
    const sLabel = L.marker(subCenter, {
      icon: L.divIcon({
        className: "padron-label",
        html: mapLabelHtml(s.name, s.color, { detail: labelDetail(s.id) }),
        iconAnchor: [0, 0],
      }),
      interactive: false,
    });
    group.addLayer(subPoly);
    group.addLayer(sLabel);
  }

  // Point-placed section labels
  for (const s of sectionsWithPoint) {
    const mc = s.map_center as { lat: number; lng: number };
    const sLabel = L.marker(L.latLng(mc.lat, mc.lng), {
      icon: L.divIcon({
        className: "padron-label",
        html: mapLabelHtml(s.name, s.color, { muted: true, detail: labelDetail(s.id) }),
        iconAnchor: [0, 0],
      }),
      interactive: false,
    });
    group.addLayer(sLabel);
  }

  // Plain sections (no geometry) + padron label at center
  const plainNames = sectionsPlain.length > 0
    ? sectionsPlain.map((s) => {
      const detail = labelDetail(s.id);
      return detail ? `${s.name} (${detail})` : s.name;
    }).join(", ")
    : (sectionsWithGeo.length === 0 && sectionsWithPoint.length === 0) ? p.padron_code : null;

  if (plainNames) {
    // Pinned to the parcel's top edge so drawn potreros, usually central,
    // never sit under the padrón's own label.
    const padronBounds = polygon.getBounds();
    const topCenter = L.latLng(padronBounds.getNorth(), padronCenter.lng);
    const label = L.marker(topCenter, {
      icon: L.divIcon({
        className: "padron-label",
        html: mapLabelHtml(plainNames, color, { muted: true, anchor: "top" }),
        iconAnchor: [0, 0],
      }),
      interactive: false,
    });
    group.addLayer(label);
  }

  group.addLayer(polygon);
  return group;
}

/** A road/fence line or an aguada/portera marker; null for unsupported geometry. */
export function buildFeatureLayer(f: MapFeature): L.Layer | null {
  const type = featureType(f.type);
  const color = type?.color || FALLBACK_FEATURE_COLOR;
  const dash = type?.dash || "";

  if (f.geometry.type === "LineString") {
    const coords = (f.geometry as GeoJSON.LineString).coordinates.map(
      ([lng, lat]) => [lat, lng] as L.LatLngTuple
    );
    const line = L.polyline(coords, {
      color, weight: f.type === "road" ? 4 : 2.5,
      dashArray: dash || undefined, opacity: 0.9,
    });
    if (f.name) line.bindTooltip(textTooltip(f.name), { permanent: false, direction: "center", className: "feature-tooltip" });
    return line;
  }
  if (f.geometry.type === "Point") {
    const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: "feature-marker",
        html: featureMarkerHtml(type?.icon || "📍", "font-size:20px;text-shadow:0 1px 3px rgba(0,0,0,0.6)"),
        iconAnchor: [12, 12],
      }),
    });
    if (f.name) marker.bindTooltip(textTooltip(f.name));
    return marker;
  }
  return null;
}

/** Preview of a point feature while placing it. */
export function pointPreview(latlng: L.LatLng, drawMode: string): L.LayerGroup {
  const type = featureType(drawMode);
  const color = type?.color || FALLBACK_FEATURE_COLOR;
  const preview = L.layerGroup();
  L.marker(latlng, {
    icon: L.divIcon({
      className: "feature-marker",
      html: featureMarkerHtml(type?.icon || "📍", `font-size:24px;text-shadow:0 1px 3px rgba(0,0,0,0.6);filter:drop-shadow(0 0 4px ${color})`),
      iconAnchor: [14, 14],
    }),
  }).addTo(preview);
  return preview;
}

function numberedVertices(preview: L.LayerGroup, points: L.LatLng[], color: string, radius: number, offset: number) {
  points.forEach((pt, idx) => {
    L.circleMarker(pt, { radius, color, fillColor: "white", fillOpacity: 1, weight: 2 })
      .bindTooltip(`${idx + 1}`, { permanent: true, direction: "right", className: "feature-tooltip", offset: [offset, 0] })
      .addTo(preview);
  });
}

/** Preview of a line feature (road, fence…) with numbered vertices. */
export function linePreview(points: L.LatLng[], drawMode: string | null): L.LayerGroup {
  const color = featureType(drawMode)?.color || FALLBACK_FEATURE_COLOR;
  const preview = L.layerGroup();
  if (points.length > 1) {
    L.polyline(points, { color, weight: 3, dashArray: "6 4", opacity: 0.8 }).addTo(preview);
  }
  numberedVertices(preview, points, color, 5, 8);
  return preview;
}

/** Preview of a potrero area being drawn: a line until the third vertex, then a polygon. */
export function areaPreview(points: L.LatLng[], color: string): L.LayerGroup {
  const preview = L.layerGroup();
  if (points.length >= 3) {
    L.polygon(points, { color, weight: 2, fillColor: color, fillOpacity: 0.25, dashArray: "6 4" }).addTo(preview);
  } else if (points.length === 2) {
    L.polyline(points, { color, weight: 2, dashArray: "6 4" }).addTo(preview);
  }
  numberedVertices(preview, points, color, 4, 6);
  return preview;
}

const nodeLatLng = (graph: FieldGraph, id: string): L.LatLng | null => {
  const centroid = graph.nodes.find((node) => node.id === id)?.centroid;
  return centroid ? L.latLng(centroid[1], centroid[0]) : null;
};

/** Linderos as thin lines between potrero centers: solid and thicker where a
 * portera is marked on the shared fence, dashed otherwise. */
export function buildLinderosLayer(graph: FieldGraph): L.LayerGroup {
  const group = L.layerGroup();
  const names = new Map(graph.nodes.map((node) => [node.id, node.name]));
  for (const edge of graph.edges) {
    const a = nodeLatLng(graph, edge.a);
    const b = nodeLatLng(graph, edge.b);
    if (!a || !b) continue;
    const line = L.polyline([a, b], {
      color: LINDERO_COLOR,
      weight: edge.gate ? 3 : 1.5,
      opacity: 0.9,
      dashArray: edge.gate ? undefined : "4 5",
    });
    line.bindTooltip(textTooltip(`${names.get(edge.a)} – ${names.get(edge.b)} · ${edge.sharedM} m de alambrado${edge.gate ? " · portera" : ""}`), { sticky: true, className: "feature-tooltip" });
    group.addLayer(line);
  }
  return group;
}

/** The planned move, potrero to potrero, drawn over everything else. */
export function buildRouteLayer(graph: FieldGraph, path: string[]): L.LayerGroup | null {
  const points = path.map((id) => nodeLatLng(graph, id));
  if (points.length < 2 || points.some((point) => point === null)) return null;
  const group = L.layerGroup();
  const latlngs = points as L.LatLng[];
  L.polyline(latlngs, { color: "#000000", weight: 7, opacity: 0.35, interactive: false }).addTo(group);
  L.polyline(latlngs, { color: ROUTE_COLOR, weight: 4, opacity: 1, interactive: false }).addTo(group);
  latlngs.forEach((point, index) => {
    L.circleMarker(point, { radius: index === 0 || index === latlngs.length - 1 ? 6 : 4, color: "#000000", weight: 1, fillColor: ROUTE_COLOR, fillOpacity: 1, interactive: false }).addTo(group);
  });
  return group;
}

/** Bounds of every padrón outline, for "centrar en mi campo" and the first fit. */
export function padronBounds(groups: Iterable<L.LayerGroup>): L.LatLngBounds {
  const bounds = L.latLngBounds([]);
  for (const group of groups) {
    group.eachLayer((l) => { if (l instanceof L.GeoJSON) bounds.extend(l.getBounds()); });
  }
  return bounds;
}
