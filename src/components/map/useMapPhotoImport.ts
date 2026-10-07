"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import L from "leaflet";
import { createIdempotencyKey, notifySectionsChanged, sendJsonResult } from "@/lib/mutate";
import { fetchWithTimeout } from "@/lib/fetch";
import { fenceProperties } from "@/lib/fences";
import { padronForShape, pointInGeometry } from "@/lib/geo";
import { textTooltip } from "@/lib/map-labels";
import { isValidSectionMapCenter } from "@/lib/section-input";
import {
  boundsFromCorners, draftLineString, draftPoint, draftPotreroPolygon, isValidOverlayBounds, matchSectionByName,
  moveBoundsTo, normalizedToLngLat, parseMapExtraction, scaleBounds,
  type MapExtraction, type OverlayBounds,
} from "@/lib/map-photo-import";
import { DRAFT_COLOR, SECTION_COLORS, type Padron } from "./constants";
import { downscaleImage } from "./downscaleImage";
import { sendWaterPoint } from "./waterPointApi";

export type DraftItemStatus = "pending" | "saving" | "done" | "error" | "discarded";
export interface DraftItemState {
  status: DraftItemStatus;
  error?: string;
  /** What was written, for the review line ("Creado", "Ubicado en Norte"). */
  result?: string;
}

export interface ExistingSection {
  id: string;
  name: string;
  hasPolygon: boolean;
}

export type PotreroAction = "create" | "place";

interface PhotoImportOptions {
  mapRef: RefObject<L.Map | null>;
  readOnly: boolean;
  padrones: Padron[];
  sections: ExistingSection[];
  waterPointsEnabled: boolean;
  /** Where the photo starts: the farm's padrones, or null to use the view. */
  defaultBounds: () => L.LatLngBounds | null;
}

const toLeaflet = (bounds: OverlayBounds) => L.latLngBounds([bounds.south, bounds.west], [bounds.north, bounds.east]);
const fromLeaflet = (bounds: L.LatLngBounds): OverlayBounds => ({
  north: bounds.getNorth(), south: bounds.getSouth(), east: bounds.getEast(), west: bounds.getWest(),
});

const handleIcon = (kind: "corner" | "move", label: string) => L.divIcon({
  className: "feature-marker",
  html: kind === "corner"
    ? `<div title="${label}" style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;cursor:nwse-resize"><div style="width:16px;height:16px;border-radius:3px;background:#fff;border:2px solid #111827;box-shadow:0 1px 4px rgba(0,0,0,.5)"></div></div>`
    : `<div title="${label}" style="width:44px;height:44px;display:flex;align-items:center;justify-content:center;cursor:move"><div style="width:26px;height:26px;border-radius:999px;background:#fff;border:2px solid #111827;box-shadow:0 1px 4px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#111827" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M2 12h20M12 2l-3 3M12 2l3 3M12 22l-3-3M12 22l3-3M2 12l3-3M2 12l3 3M22 12l-3-3M22 12l-3 3"/></svg></div></div>`,
  iconSize: [44, 44],
  iconAnchor: [22, 22],
});

/**
 * "Importar plano": a photo of the field's map is read by the vision model
 * into draft potreros, aguadas and lines, pinned over the satellite view
 * where the user lines it up (drag the corners or the center), and each
 * draft is written only when the user confirms it.
 */
export function useMapPhotoImport({ mapRef, readOnly, padrones, sections, waterPointsEnabled, defaultBounds }: PhotoImportOptions) {
  const [phase, setPhase] = useState<"idle" | "analyzing" | "review">("idle");
  const [image, setImage] = useState<{ dataUrl: string; width: number; height: number } | null>(null);
  const [extraction, setExtraction] = useState<MapExtraction | null>(null);
  const [bounds, setBounds] = useState<OverlayBounds | null>(null);
  const [opacity, setOpacity] = useState(0.65);
  const [showDrafts, setShowDrafts] = useState(true);
  const [items, setItems] = useState<Record<string, DraftItemState>>({});
  const [error, setError] = useState("");
  const overlayRef = useRef<L.ImageOverlay | null>(null);
  const handlesRef = useRef<L.LayerGroup | null>(null);
  const draftsRef = useRef<L.LayerGroup | null>(null);
  // One retry key per draft and payload: realigning the photo after a failed
  // attempt sends new coordinates, which must not replay the old request.
  const keysRef = useRef<Map<string, { key: string; signature: string }>>(new Map());
  const requestRef = useRef<AbortController | null>(null);

  const reset = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    const map = mapRef.current;
    for (const ref of [overlayRef, handlesRef, draftsRef] as const) {
      if (ref.current && map) map.removeLayer(ref.current);
      ref.current = null;
    }
    keysRef.current.clear();
    setPhase("idle");
    setImage(null);
    setExtraction(null);
    setBounds(null);
    setItems({});
    setError("");
    setShowDrafts(true);
  }, [mapRef]);

  useEffect(() => () => {
    requestRef.current?.abort();
    const map = mapRef.current;
    for (const ref of [overlayRef, handlesRef, draftsRef] as const) {
      if (ref.current && map) map.removeLayer(ref.current);
      ref.current = null;
    }
  }, [mapRef]);

  function initialBounds(): OverlayBounds | null {
    const map = mapRef.current;
    if (!map) return null;
    const farm = defaultBounds();
    if (farm && farm.isValid()) return fromLeaflet(farm);
    // No padrones: the middle of what the user is looking at.
    return fromLeaflet(map.getBounds().pad(-0.15));
  }

  async function analyze(file: File) {
    if (readOnly || phase === "analyzing") return;
    setError("");
    if (!file.type.startsWith("image/")) {
      setError("Elegí una foto (JPG o PNG) del plano del campo.");
      return;
    }
    setPhase("analyzing");
    let downsized;
    try {
      downsized = await downscaleImage(file);
    } catch {
      setPhase("idle");
      setError("No se pudo leer la foto. Probá con otra imagen JPG o PNG.");
      return;
    }
    const controller = new AbortController();
    requestRef.current = controller;
    try {
      const res = await fetchWithTimeout("/api/map-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: downsized.dataUrl, width: downsized.width, height: downsized.height }),
        signal: controller.signal,
      }, 50_000);
      const body = await res.json().catch(() => null);
      if (controller.signal.aborted || requestRef.current !== controller) return;
      if (!res.ok) {
        setPhase("idle");
        setError(typeof body?.error === "string" ? body.error : "No se pudo analizar el plano.");
        return;
      }
      // The server already validated it; parse again so the client never
      // trusts the shape of a response it didn't build.
      const parsed = parseMapExtraction(body);
      const start = initialBounds();
      if (!parsed || !start) {
        setPhase("idle");
        setError("No se pudo leer el resultado del análisis.");
        return;
      }
      setImage(downsized);
      setExtraction(parsed);
      setBounds(start);
      setItems(Object.fromEntries([...parsed.potreros, ...parsed.aguadas, ...parsed.lines].map((item) => [item.key, { status: "pending" as const }])));
      setPhase("review");
      const map = mapRef.current;
      // Leave room for the alignment panel over the top-left of the map.
      if (map) map.fitBounds(toLeaflet(start), { paddingTopLeft: [24, 220], paddingBottomRight: [24, 24], maxZoom: 17 });
    } catch (caught) {
      if (controller.signal.aborted && requestRef.current !== controller) return;
      setPhase("idle");
      setError(caught instanceof Error && caught.name === "AbortError"
        ? "El análisis tardó demasiado. Probá de nuevo o con una foto más nítida."
        : "No se pudo conectar con el servidor.");
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  // ── Photo overlay ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !image || !bounds) return;
    if (!overlayRef.current) {
      // Its own pane between the tiles (200) and the vectors (400), so the
      // padrones, potreros and draft shapes stay visible on top of the photo.
      if (!map.getPane("plan")) map.createPane("plan").style.zIndex = "350";
      overlayRef.current = L.imageOverlay(image.dataUrl, toLeaflet(bounds), { opacity, interactive: false, className: "plan-overlay", pane: "plan" }).addTo(map);
    } else {
      overlayRef.current.setBounds(toLeaflet(bounds));
      overlayRef.current.setOpacity(opacity);
    }
  }, [bounds, image, mapRef, opacity]);

  // ── Corner and move handles ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bounds || phase !== "review") return;
    const group = L.layerGroup();
    const nw = L.marker([bounds.north, bounds.west], { draggable: true, icon: handleIcon("corner", "Arrastrá para ajustar la esquina"), keyboard: false, zIndexOffset: 2000 });
    const se = L.marker([bounds.south, bounds.east], { draggable: true, icon: handleIcon("corner", "Arrastrá para ajustar la esquina"), keyboard: false, zIndexOffset: 2000 });
    const center = L.marker([(bounds.north + bounds.south) / 2, (bounds.east + bounds.west) / 2], { draggable: true, icon: handleIcon("move", "Arrastrá para mover la foto"), keyboard: false, zIndexOffset: 2000 });
    let live = bounds;
    const preview = (next: OverlayBounds) => {
      if (!isValidOverlayBounds(next)) return;
      live = next;
      overlayRef.current?.setBounds(toLeaflet(next));
    };
    nw.on("drag", () => {
      const a = nw.getLatLng();
      preview(boundsFromCorners([a.lng, a.lat], [live.east, live.south]));
    });
    se.on("drag", () => {
      const b = se.getLatLng();
      preview(boundsFromCorners([live.west, live.north], [b.lng, b.lat]));
    });
    center.on("drag", () => {
      const c = center.getLatLng();
      preview(moveBoundsTo(live, [c.lng, c.lat]));
    });
    const commit = () => setBounds(live);
    nw.on("dragend", commit);
    se.on("dragend", commit);
    center.on("dragend", commit);
    group.addLayer(nw).addLayer(se).addLayer(center).addTo(map);
    handlesRef.current = group;
    return () => {
      map.removeLayer(group);
      if (handlesRef.current === group) handlesRef.current = null;
    };
  }, [bounds, mapRef, phase]);

  // ── Draft shapes under the current bounds ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !bounds || !extraction || phase !== "review" || !showDrafts) return;
    const group = L.layerGroup();
    const style = (key: string) => {
      const state = items[key]?.status;
      return { color: state === "error" ? "#ef4444" : DRAFT_COLOR, weight: 2.5, dashArray: "6 5", opacity: 1, fillOpacity: 0.12 };
    };
    const visible = (key: string) => !["done", "discarded"].includes(items[key]?.status ?? "pending");
    for (const potrero of extraction.potreros) {
      if (!visible(potrero.key)) continue;
      const polygon = draftPotreroPolygon(potrero.ring, bounds);
      L.polygon(polygon.coordinates[0].map(([lng, lat]) => [lat, lng] as L.LatLngTuple), { ...style(potrero.key), fillColor: DRAFT_COLOR, interactive: true })
        .bindTooltip(textTooltip(`Borrador: ${potrero.name}`), { sticky: true, className: "feature-tooltip" })
        .addTo(group);
    }
    for (const line of extraction.lines) {
      if (!visible(line.key)) continue;
      const geometry = draftLineString(line.points, bounds);
      L.polyline(geometry.coordinates.map(([lng, lat]) => [lat, lng] as L.LatLngTuple), { ...style(line.key), weight: 3 })
        .bindTooltip(textTooltip(`Borrador: ${line.name ?? (line.type === "alambrado" ? "Alambrado" : "Camino")}`), { sticky: true, className: "feature-tooltip" })
        .addTo(group);
    }
    for (const aguada of extraction.aguadas) {
      if (!visible(aguada.key)) continue;
      const [lng, lat] = normalizedToLngLat(aguada.point, bounds);
      L.circleMarker([lat, lng], { radius: 8, color: "#ffffff", weight: 2, fillColor: DRAFT_COLOR, fillOpacity: 1 })
        .bindTooltip(textTooltip(`Borrador: ${aguada.name}`), { className: "feature-tooltip" })
        .addTo(group);
    }
    group.addTo(map);
    draftsRef.current = group;
    return () => {
      map.removeLayer(group);
      if (draftsRef.current === group) draftsRef.current = null;
    };
  }, [bounds, extraction, items, mapRef, phase, showDrafts]);

  const keyFor = (itemKey: string, payload: unknown) => {
    const signature = JSON.stringify(payload);
    const current = keysRef.current.get(itemKey);
    if (current && current.signature === signature) return current.key;
    const key = createIdempotencyKey();
    keysRef.current.set(itemKey, { key, signature });
    return key;
  };

  const setItem = (key: string, state: DraftItemState) => setItems((current) => ({ ...current, [key]: state }));

  /** The potrero a point falls in, among those already drawn. */
  function sectionsContaining(point: [number, number]): string[] {
    const ids: string[] = [];
    for (const padron of padrones) {
      for (const section of padron.sections ?? []) {
        if (section.map_center?.type === "Polygon" && pointInGeometry(point, section.map_center)) ids.push(section.id);
      }
    }
    return ids;
  }

  async function confirmPotrero(key: string, action: PotreroAction, existing: ExistingSection | null): Promise<boolean> {
    const potrero = extraction?.potreros.find((item) => item.key === key);
    if (!potrero || !bounds || readOnly) return false;
    const polygon = draftPotreroPolygon(potrero.ring, bounds);
    if (!isValidSectionMapCenter(polygon)) {
      setItem(key, { status: "error", error: "La forma no es válida." });
      return false;
    }
    const padron = padronForShape(polygon.coordinates[0].slice(0, -1), padrones);
    if (!padron) {
      setItem(key, { status: "error", error: "Queda fuera de los padrones del campo. Ajustá la foto o agregá el padrón." });
      return false;
    }
    setItem(key, { status: "saving" });
    const createPayload = {
      padronId: padron.id,
      name: potrero.name,
      sizeHectares: potrero.hectares,
      color: SECTION_COLORS[(extraction?.potreros.indexOf(potrero) ?? 0) % SECTION_COLORS.length],
      mapCenter: polygon,
    };
    const result = action === "place" && existing
      ? await sendJsonResult("/api/sections/geometry", "PUT", { id: existing.id, padronId: padron.id, mapCenter: polygon })
      : await sendJsonResult("/api/padrones", "PUT", createPayload, { idempotencyKey: keyFor(key, createPayload) });
    if (!result.ok) {
      setItem(key, { status: "error", error: result.error || "No se pudo guardar el potrero." });
      return false;
    }
    notifySectionsChanged();
    setItem(key, { status: "done", result: action === "place" && existing ? `Ubicado en ${existing.name}` : `Potrero creado en ${padron.padron_code}` });
    return true;
  }

  async function confirmAguada(key: string): Promise<boolean> {
    const aguada = extraction?.aguadas.find((item) => item.key === key);
    if (!aguada || !bounds || readOnly) return false;
    const location = draftPoint(aguada.point, bounds);
    setItem(key, { status: "saving" });
    if (waterPointsEnabled) {
      const served = sectionsContaining(location.coordinates);
      const payload = { name: aguada.name, kind: aguada.kind, location, sectionIds: served };
      const result = await sendWaterPoint("POST", payload, keyFor(key, payload));
      if (!result.ok) {
        setItem(key, { status: "error", error: result.error });
        return false;
      }
      setItem(key, { status: "done", result: served.length > 0 ? "Aguada registrada con su potrero" : "Aguada registrada" });
      return true;
    }
    const legacy = { type: "aguada", name: aguada.name, geometry: location };
    const result = await sendJsonResult("/api/map-features", "POST", legacy, { idempotencyKey: keyFor(key, legacy) });
    if (!result.ok) {
      setItem(key, { status: "error", error: result.error || "No se pudo guardar la aguada." });
      return false;
    }
    setItem(key, { status: "done", result: "Aguada marcada en el mapa" });
    return true;
  }

  async function confirmLine(key: string): Promise<boolean> {
    const line = extraction?.lines.find((item) => item.key === key);
    if (!line || !bounds || readOnly) return false;
    setItem(key, { status: "saving" });
    const payload = {
      type: line.type,
      name: line.name,
      geometry: draftLineString(line.points, bounds),
      properties: line.type === "alambrado" ? fenceProperties({ kind: "convencional" }) : {},
    };
    const result = await sendJsonResult("/api/map-features", "POST", payload, { idempotencyKey: keyFor(key, payload) });
    if (!result.ok) {
      setItem(key, { status: "error", error: result.error || "No se pudo guardar la línea." });
      return false;
    }
    setItem(key, { status: "done", result: line.type === "alambrado" ? "Alambrado creado" : "Camino creado" });
    return true;
  }

  /** Same potrero already in the farm (by name), if any. */
  const existingFor = (name: string) => matchSectionByName(name, sections);

  /**
   * Every pending draft, one by one. A potrero whose name matches one that is
   * already drawn is left for the user to decide (it would replace a shape).
   */
  async function confirmAll() {
    if (!extraction) return;
    for (const potrero of extraction.potreros) {
      if (items[potrero.key]?.status !== "pending" && items[potrero.key]?.status !== "error") continue;
      const existing = existingFor(potrero.name);
      if (existing?.hasPolygon) continue;
      await confirmPotrero(potrero.key, existing ? "place" : "create", existing);
    }
    for (const aguada of extraction.aguadas) {
      if (items[aguada.key]?.status === "pending" || items[aguada.key]?.status === "error") await confirmAguada(aguada.key);
    }
    for (const line of extraction.lines) {
      if (items[line.key]?.status === "pending" || items[line.key]?.status === "error") await confirmLine(line.key);
    }
  }

  function discard(key: string) {
    setItem(key, { status: "discarded" });
  }

  function restore(key: string) {
    setItem(key, { status: "pending" });
  }

  function adjust(next: "padrones" | "view" | "bigger" | "smaller") {
    const map = mapRef.current;
    if (!map || !bounds) return;
    let target: OverlayBounds | null = null;
    if (next === "padrones") {
      const farm = defaultBounds();
      target = farm && farm.isValid() ? fromLeaflet(farm) : null;
    } else if (next === "view") {
      target = fromLeaflet(map.getBounds().pad(-0.1));
    } else {
      target = scaleBounds(bounds, next === "bigger" ? 1.05 : 1 / 1.05);
    }
    if (target && isValidOverlayBounds(target)) setBounds(target);
  }

  const counts = Object.values(items).reduce((acc, item) => {
    acc[item.status] = (acc[item.status] ?? 0) + 1;
    return acc;
  }, {} as Partial<Record<DraftItemStatus, number>>);

  return {
    phase, image, extraction, bounds, opacity, setOpacity, showDrafts, setShowDrafts, items, error, setError, counts,
    analyze, reset, adjust, confirmPotrero, confirmAguada, confirmLine, confirmAll, discard, restore, existingFor,
  };
}
