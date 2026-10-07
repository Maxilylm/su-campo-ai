// Leaflet layer builders for FarmMap. Every piece of text that reaches the map
// goes through mapLabelHtml / textTooltip, which escape it.

import L from "leaflet";
import { mapLabelHtml, safeHexColor, textTooltip } from "@/lib/map-labels";
import type { SectionFieldStatus } from "@/lib/grazing";
import type { FieldGraph } from "@/lib/field-graph";
import { fenceKindLabel, fenceKindOf, fenceStrandsOf, fenceStyle } from "@/lib/fences";
import { formatDistance, geometryLengthMeters } from "@/lib/geo-measure";
import { waterPointKindLabel, waterPointStatusLabel, type WaterPoint } from "@/lib/water-points";
import {
  FALLBACK_FEATURE_COLOR, LINDERO_COLOR, ROUTE_COLOR, STOCKING_FILL, WATER_STATUS_COLORS, featureType, padronColor,
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

export interface RestylableLayer extends L.Layer {
  /** Fences thicken with zoom; called on every zoomend. */
  restyle?: (zoom: number) => void;
}

/** Popup content built from text nodes (names are user-written). */
function infoPopup(title: string, lines: string[]): HTMLElement {
  const root = document.createElement("div");
  root.className = "map-info-popup";
  const heading = document.createElement("p");
  heading.className = "map-info-title";
  heading.textContent = title;
  root.appendChild(heading);
  for (const line of lines) {
    const row = document.createElement("p");
    row.textContent = line;
    root.appendChild(row);
  }
  return root;
}

const lineLatLngs = (geometry: GeoJSON.LineString) =>
  geometry.coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngTuple);

/** An alambrado: dark casing + wire (silver, or dashed yellow when eléctrico),
 * thickening with zoom, with a wide invisible line so it is easy to tap. */
function buildFenceLayer(f: MapFeature, zoom: number): RestylableLayer {
  const latlngs = lineLatLngs(f.geometry as GeoJSON.LineString);
  const kind = fenceKindOf(f.properties);
  const strands = fenceStrandsOf(f.properties);
  const meters = geometryLengthMeters(f.geometry);
  const style = fenceStyle(kind, zoom);
  const casing = L.polyline(latlngs, { color: style.casingColor, weight: style.casingWeight, opacity: 0.55, lineCap: "round", lineJoin: "round", interactive: false });
  const wire = L.polyline(latlngs, { color: style.color, weight: style.weight, dashArray: style.dashArray, opacity: 1, lineCap: "round", lineJoin: "round", interactive: false });
  const hit = L.polyline(latlngs, { color: "#000000", weight: 18, opacity: 0, lineCap: "round" });
  const kindText = `Alambrado ${fenceKindLabel(kind).toLowerCase()}`;
  hit.bindTooltip(textTooltip(`${f.name ? `${f.name} · ` : ""}${kindText} · ${formatDistance(meters)}`), { sticky: true, className: "feature-tooltip" });
  hit.bindPopup(infoPopup(f.name || kindText, [
    f.name ? kindText : null,
    strands ? `${strands} ${strands === 1 ? "hilo" : "hilos"}` : null,
    `Largo: ${formatDistance(meters)}`,
  ].filter((line): line is string => Boolean(line))), { className: "map-info" });
  const group = L.featureGroup([casing, wire, hit]) as L.FeatureGroup & RestylableLayer;
  group.restyle = (nextZoom: number) => {
    const next = fenceStyle(kind, nextZoom);
    casing.setStyle({ weight: next.casingWeight });
    wire.setStyle({ weight: next.weight, dashArray: next.dashArray });
  };
  return group;
}

/** A road/fence line or a portera/legacy aguada marker; null for unsupported geometry. */
export function buildFeatureLayer(f: MapFeature, zoom = 15): RestylableLayer | null {
  const type = featureType(f.type);
  const color = type?.color || FALLBACK_FEATURE_COLOR;
  const dash = type?.dash || "";

  if (f.geometry.type === "LineString") {
    if (f.type === "alambrado") return buildFenceLayer(f, zoom);
    const latlngs = lineLatLngs(f.geometry as GeoJSON.LineString);
    const meters = geometryLengthMeters(f.geometry);
    const line = L.polyline(latlngs, {
      color, weight: f.type === "road" ? 4 : 2.5,
      dashArray: dash || undefined, opacity: 0.9, interactive: false,
    });
    const hit = L.polyline(latlngs, { color: "#000000", weight: 18, opacity: 0 });
    const label = type?.label ?? "Línea";
    hit.bindTooltip(textTooltip(`${f.name ? `${f.name} · ` : ""}${label} · ${formatDistance(meters)}`), { sticky: true, className: "feature-tooltip" });
    hit.bindPopup(infoPopup(f.name || label, [f.name ? label : null, `Largo: ${formatDistance(meters)}`].filter((line): line is string => Boolean(line))), { className: "map-info" });
    return L.featureGroup([line, hit]);
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

/** A water drop, white-outlined, filled by status; the glyph repeats the
 * status for anyone who can't tell the colors apart. 44 px hit area. */
export function waterDropHtml(status: string, options: { selected?: boolean; overdue?: boolean } = {}): string {
  const fill = WATER_STATUS_COLORS[status] ?? WATER_STATUS_COLORS.ok;
  const glyph = status === "bajo"
    ? '<path d="M9 25h12" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>'
    : status === "seco"
      ? '<path d="M15 16v6M15 26.5v.1" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>'
      : status === "roto"
        ? '<path d="M11 19l8 8M19 19l-8 8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/>'
        : '<path d="M10.5 23a5 5 0 0 0 4.5 4.5" stroke="#fff" stroke-width="2.2" stroke-linecap="round" fill="none" opacity="0.9"/>';
  const dot = options.overdue ? '<circle cx="25" cy="7" r="4.5" fill="#fbbf24" stroke="#111827" stroke-width="1.5"/>' : "";
  const size = options.selected ? 1.2 : 1;
  const halo = options.selected ? "drop-shadow(0 0 0 #fff) drop-shadow(0 0 4px #ffffff)" : "drop-shadow(0 2px 3px rgba(0,0,0,0.45))";
  return `<div style="width:44px;height:44px;display:flex;align-items:flex-end;justify-content:center;filter:${halo}"><svg width="${Math.round(30 * size)}" height="${Math.round(40 * size)}" viewBox="-1 -1 32 42" aria-hidden="true"><path d="M15 1C15 1 3 15 3 25a12 12 0 0 0 24 0C27 15 15 1 15 1Z" fill="${fill}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/>${glyph}${dot}</svg></div>`;
}

/** An aguada (water_points, 055): a status-colored drop. */
export function buildWaterPointMarker(point: WaterPoint, options: { selected: boolean; overdue: boolean; onSelect: () => void }): L.Marker | null {
  if (!point.location) return null;
  const [lng, lat] = point.location.coordinates;
  const marker = L.marker([lat, lng], {
    icon: L.divIcon({ className: "feature-marker", html: waterDropHtml(point.status, options), iconSize: [44, 44], iconAnchor: [22, 42] }),
    title: `${point.name}: ${waterPointStatusLabel(point.status)}`,
    alt: `Aguada ${point.name}`,
    keyboard: true,
    riseOnHover: true,
    zIndexOffset: options.selected ? 1000 : 500,
  });
  marker.bindTooltip(textTooltip(`${point.name} · ${waterPointKindLabel(point.kind)} · ${waterPointStatusLabel(point.status)}`), { direction: "top", offset: [0, -40], className: "feature-tooltip" });
  marker.on("click", options.onSelect);
  marker.on("keypress", (event: L.LeafletKeyboardEvent) => {
    if (event.originalEvent.key === "Enter" || event.originalEvent.key === " ") options.onSelect();
  });
  return marker;
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
