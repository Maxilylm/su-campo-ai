"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { createIdempotencyKey, notifySectionsChanged, sendJsonResult } from "@/lib/mutate";
import { polygonVertices, type LngLat } from "@/lib/geo-measure";
import { isCheckOverdue, type WaterPoint } from "@/lib/water-points";
import { useFarm } from "@/contexts/FarmContext";
import { useOfflineAwareNavigation, useOfflineAwareReplace } from "@/lib/use-offline-aware-navigation";
import { parseLocalizedNumber } from "@/lib/number";
import { safeHexColor } from "@/lib/map-labels";
import type { SectionFieldStatus } from "@/lib/grazing";
import { FieldStatusPanel } from "@/components/FieldStatusPanel";
import { padronForShape } from "@/lib/geo";
import {
  DEFAULT_SUBSECTION_COLOR, SECTION_COLORS, isPointFeature,
  type MapFeature, type Padron,
} from "@/components/map/constants";
import { areaPreview, buildFeatureLayer, buildPadronLayer, buildWaterPointMarker, padronBounds, type RestylableLayer } from "@/components/map/layers";
import { useFarmMapData } from "@/components/map/useFarmMapData";
import { useFeatureDrawing } from "@/components/map/useFeatureDrawing";
import { usePadronSearch } from "@/components/map/usePadronSearch";
import { DrawOverlay, DrawToolbar, LinderosToggle, LocateButton, MapActionError, PadronSearchPanel, PlacementOverlay } from "@/components/map/MapOverlays";
import { useLinderosLayer } from "@/components/map/useLinderosLayer";
import { FeatureList, MapNotices, PadronList } from "@/components/map/MapLists";
import { AguadaList } from "@/components/map/AguadaList";
import { WaterPointSheet } from "@/components/map/WaterPointSheet";
import { useWaterPoints } from "@/components/map/useWaterPoints";
import { sendWaterPoint } from "@/components/map/waterPointApi";
import { useMapPhotoImport } from "@/components/map/useMapPhotoImport";
import { PhotoImportButton, PhotoImportControls, PhotoImportReview } from "@/components/map/PhotoImport";
import { RelocateOverlay } from "@/components/map/MapOverlays";

export default function FarmMap() {
  const { readOnly, userId, offlineMode, isOnline, farm } = useFarm();
  const showCattle = farm?.operation_type !== "crops";
  const offlineReadOnly = offlineMode || !isOnline;
  const navigate = useOfflineAwareNavigation();
  const replace = useOfflineAwareReplace();
  const searchParams = useSearchParams();
  const navigationQuery = searchParams.toString();
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const padronLayersRef = useRef<Map<string, L.LayerGroup>>(new Map());
  const featureLayersRef = useRef<Map<string, RestylableLayer>>(new Map());
  const waterLayerRef = useRef<L.LayerGroup | null>(null);
  const subsectionAttempt = useRef<{ key: string; signature: string } | null>(null);

  const {
    padrones, mapFeatures,
    padronesLoaded, featuresLoaded, padronesLoadError, featuresLoadError, padronesTruncated, featuresTruncated,
    offlineMapSavedAt, offlineMapAvailable,
    fieldStatuses, fieldTotals, rotation, graph, fieldLoading, fieldError,
    loadPadrones, loadFeatures, loadFieldStatus,
  } = useFarmMapData({ userId, offlineReadOnly });

  const [saving, setSaving] = useState(false);
  const [showSubdivide, setShowSubdivide] = useState<string | null>(null);
  const [subName, setSubName] = useState("");
  const [subHa, setSubHa] = useState("");
  const [subColor, setSubColor] = useState(DEFAULT_SUBSECTION_COLOR);
  const [subPoints, setSubPoints] = useState<L.LatLng[]>([]);
  const [placingArea, setPlacingArea] = useState(false);
  // Drawing an existing, unplaced potrero (vs. creating a sub-section).
  const [placingSection, setPlacingSection] = useState<SectionFieldStatus | null>(null);
  const [actionError, setActionError] = useState("");
  const [padronMigrationRequired, setPadronMigrationRequired] = useState(false);
  const [mapFeatureMigrationRequired, setMapFeatureMigrationRequired] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [showLinderos, setShowLinderos] = useState(false);
  // Potrero ids of the move being planned in the side panel's dialog.
  const [routePath, setRoutePath] = useState<string[] | null>(null);
  useLinderosLayer(mapRef, mapReady, graph, showLinderos, routePath);
  const handledNavigationQueryRef = useRef<string | null>(null);
  const subPreviewRef = useRef<L.LayerGroup | null>(null);
  const fittedPadronesRef = useRef<Padron[] | null>(null);

  function clearActionError() {
    setActionError("");
    setPadronMigrationRequired(false);
    setMapFeatureMigrationRequired(false);
  }

  // ── Init map ──
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [-33.0, -56.0],
      zoom: 7,
      zoomControl: false,
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "ESRI",
      maxZoom: 19,
    }).addTo(map);

    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
    }).addTo(map);

    // The map fills a flexible area (notices above it come and go), so tell
    // Leaflet whenever its box changes, not only on window resize.
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => map.invalidateSize());
    resizeObserver?.observe(mapContainerRef.current);

    mapRef.current = map;
    setMapReady(true);
    return () => { resizeObserver?.disconnect(); map.remove(); mapRef.current = null; setMapReady(false); };
  }, []);

  // ── Aguadas (055) ──
  const water = useWaterPoints({ offlineReadOnly });
  const { replaceLocal: replaceWaterPoint, removeLocal: removeWaterPoint } = water;
  const waterPointsEnabled = water.loaded && !water.migrationRequired && !water.loadError && !offlineReadOnly;
  const [selectedWaterId, setSelectedWaterId] = useState<string | null>(null);
  const [waterSheetOpen, setWaterSheetOpen] = useState(false);
  const [waterSaving, setWaterSaving] = useState(false);
  const [waterError, setWaterError] = useState("");
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [relocating, setRelocating] = useState<WaterPoint | null>(null);
  const selectedWater = water.waterPoints.find((point) => point.id === selectedWaterId) ?? null;
  const sectionChoices = useMemo(
    () => [...fieldStatuses].sort((a, b) => a.name.localeCompare(b.name, "es")).map((status) => ({ id: status.id, name: status.name, color: status.color })),
    [fieldStatuses],
  );
  const sectionNames = useMemo(() => new Map(fieldStatuses.map((status) => [status.id, status.name])), [fieldStatuses]);
  // Legacy aguada markers that now have a water_points row are drawn as drops instead.
  const linkedFeatureIds = useMemo(() => new Set(water.waterPoints.map((point) => point.map_feature_id).filter(Boolean)), [water.waterPoints]);
  const visibleFeatures = useMemo(
    () => (waterPointsEnabled ? mapFeatures.filter((feature) => !(feature.type === "aguada" && linkedFeatureIds.has(feature.id))) : mapFeatures),
    [linkedFeatureIds, mapFeatures, waterPointsEnabled],
  );

  const openWaterPoint = useCallback((point: WaterPoint) => {
    setSelectedWaterId(point.id);
    setWaterError("");
    setWaterSheetOpen(true);
  }, []);

  // Corners a fence can snap to: potrero and padrón outlines and other fences.
  const snapVertices = useCallback((): LngLat[] => {
    const shapes: unknown[] = [];
    for (const padron of padrones) {
      shapes.push(padron.geometry);
      for (const section of padron.sections ?? []) if (section.map_center?.type === "Polygon") shapes.push(section.map_center);
    }
    const vertices = polygonVertices(shapes);
    for (const feature of mapFeatures) {
      if (feature.type !== "alambrado" || feature.geometry.type !== "LineString") continue;
      for (const [lng, lat] of (feature.geometry as GeoJSON.LineString).coordinates) vertices.push([lng, lat]);
    }
    return vertices;
  }, [mapFeatures, padrones]);

  const search = usePadronSearch({ mapRef, readOnly, offlineReadOnly, userId, clearActionError, setActionError, setPadronMigrationRequired });

  // Declared before the placement effect: turning drawing off clears every map
  // click handler, and placement must re-register its own afterwards.
  const {
    drawMode, drawName, setDrawName, drawPoints, cleanupDraw, undoLastPoint, saveDrawnFeature, toggleDrawMode,
    fenceKind, setFenceKind, snapEnabled, setSnapEnabled, lastSnapped, aguadaKind, setAguadaKind, drawLengthM,
  } = useFeatureDrawing({
    mapRef, readOnly, setSaving, clearActionError, setActionError, setMapFeatureMigrationRequired,
    snapVertices, waterPointsEnabled,
    onWaterPointCreated: (point) => { replaceWaterPoint(point); openWaterPoint(point); },
  });

  const photo = useMapPhotoImport({
    mapRef,
    readOnly: readOnly || offlineReadOnly,
    padrones,
    sections: fieldStatuses.map((status) => ({ id: status.id, name: status.name, hasPolygon: status.hasPolygon ?? status.hasGeometry })),
    waterPointsEnabled,
    defaultBounds: () => {
      const bounds = padronBounds(padronLayersRef.current.values());
      return bounds.isValid() ? bounds : null;
    },
  });
  const importing = photo.phase === "review";

  // ── Render padrones on map ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing (includes labels now)
    padronLayersRef.current.forEach((group) => map.removeLayer(group));
    padronLayersRef.current.clear();
    const statusById = new Map(fieldStatuses.map((status) => [status.id, status]));

    padrones.forEach((p, i) => {
      const group = buildPadronLayer(p, i, statusById, showCattle);
      group.addTo(map);
      padronLayersRef.current.set(p.id, group);
    });

    // Fit only when the parcels themselves change, not when occupancy
    // refreshes, so a user's zoom survives a cattle move.
    if (padrones.length > 0 && fittedPadronesRef.current !== padrones) {
      fittedPadronesRef.current = padrones;
      const bounds = padronBounds(padronLayersRef.current.values());
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [fieldStatuses, padrones, showCattle]);

  // ── Render map features ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    featureLayersRef.current.forEach((layer) => map.removeLayer(layer));
    featureLayersRef.current.clear();

    visibleFeatures.forEach((f) => {
      const layer = buildFeatureLayer(f, map.getZoom());
      if (!layer) return;
      layer.addTo(map);
      featureLayersRef.current.set(f.id, layer);
    });
  }, [visibleFeatures]);

  // Fences thicken as you zoom in, so they read at farm scale and up close.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const onZoom = () => {
      const zoom = map.getZoom();
      featureLayersRef.current.forEach((layer) => layer.restyle?.(zoom));
    };
    map.on("zoomend", onZoom);
    return () => { map.off("zoomend", onZoom); };
  }, [mapReady]);

  // ── Aguadas as drops ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const group = L.layerGroup();
    for (const point of water.waterPoints) {
      const marker = buildWaterPointMarker(point, {
        selected: point.id === selectedWaterId && waterSheetOpen,
        overdue: isCheckOverdue(point.last_checked_at),
        onSelect: () => openWaterPoint(point),
      });
      if (marker) group.addLayer(marker);
    }
    group.addTo(map);
    waterLayerRef.current = group;
    return () => {
      map.removeLayer(group);
      if (waterLayerRef.current === group) waterLayerRef.current = null;
    };
  }, [mapReady, openWaterPoint, selectedWaterId, water.waterPoints, waterSheetOpen]);

  // ── Relocating an aguada: the next tap on the map is its new place ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !relocating) return;
    map.getContainer().style.cursor = "crosshair";
    const target = relocating;
    let done = false;
    async function onPick(event: L.LeafletMouseEvent) {
      if (done) return;
      done = true;
      const result = await sendWaterPoint("PATCH", { id: target.id, location: { type: "Point", coordinates: [event.latlng.lng, event.latlng.lat] } });
      if (!result.ok) setActionError(result.error);
      else if (result.point) replaceWaterPoint(result.point);
      setRelocating(null);
    }
    map.on("click", onPick);
    return () => {
      map.off("click", onPick);
      map.getContainer().style.cursor = "";
    };
  }, [relocating, replaceWaterPoint]);

  // Activity links can open the map with an exact padron or infrastructure
  // feature. Wait until Leaflet and both data layers exist before fitting the
  // viewport, then remove the query so a refresh does not refocus forever.
  useEffect(() => {
    if (!mapReady || handledNavigationQueryRef.current === navigationQuery || !padronesLoaded || !featuresLoaded) return;
    const params = new URLSearchParams(navigationQuery);
    const padronId = params.get("padronId");
    const featureId = params.get("featureId");
    if ((padronId && padronesLoadError) || (featureId && featuresLoadError)) return;
    const padron = padronId ? padrones.find((item) => item.id === padronId) : null;
    const feature = featureId ? visibleFeatures.find((item) => item.id === featureId) : null;
    if ((padronId && !padron) || (featureId && !feature)) return;
    if (padron) {
      window.requestAnimationFrame(() => focusPadron(padron));
    } else if (feature) {
      window.requestAnimationFrame(() => focusMapFeature(feature));
    }
    handledNavigationQueryRef.current = navigationQuery;
    if (navigationQuery) replace(window.location.pathname, { scroll: false });
  }, [featuresLoadError, featuresLoaded, visibleFeatures, mapReady, navigationQuery, padrones, padronesLoadError, padronesLoaded, replace]);

  // ── Placement mode: draw polygon area for sub-section ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !placingArea) return;

    map.getContainer().style.cursor = "crosshair";
    map.dragging.disable();

    function onPlaceClick(e: L.LeafletMouseEvent) {
      setSubPoints((prev) => {
        const next = [...prev, e.latlng];
        // Update preview
        if (subPreviewRef.current) map!.removeLayer(subPreviewRef.current);
        const preview = areaPreview(next, subColor);
        preview.addTo(map!);
        subPreviewRef.current = preview;
        return next;
      });
    }

    map.on("click", onPlaceClick);
    return () => {
      map.off("click", onPlaceClick);
      map.getContainer().style.cursor = "";
      map.dragging.enable();
    };
  }, [placingArea, subColor]);

  function startPlacingSection(status: SectionFieldStatus) {
    if (readOnly) return;
    cleanupDraw();
    cleanupSubdivide();
    setSubColor(safeHexColor(status.color));
    setPlacingSection(status);
    setPlacingArea(true);
    locateCampo();
    // After the overlay renders, or the smooth scroll is cancelled by it.
    window.requestAnimationFrame(() => mapContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  async function savePlacedSection() {
    if (!placingSection || subPoints.length < 3 || saving) return;
    const ring = subPoints.map((point) => [point.lng, point.lat] as [number, number]);
    const padron = padronForShape(ring, padrones);
    if (!padron) {
      setActionError("Dibujá el potrero dentro de uno de los padrones del campo.");
      return;
    }
    setSaving(true);
    clearActionError();
    try {
      const result = await sendJsonResult("/api/sections/geometry", "PUT", {
        id: placingSection.id,
        padronId: padron.id,
        mapCenter: { type: "Polygon", coordinates: [[...ring, ring[0]]] },
      });
      if (!result.ok) {
        setActionError(result.error || "No se pudo guardar el potrero en el mapa.");
        return;
      }
      cleanupSubdivide();
      notifySectionsChanged();
      await Promise.all([loadPadrones(), loadFieldStatus()]);
    } finally {
      setSaving(false);
    }
  }

  function locateCampo() {
    const map = mapRef.current;
    if (!map || padrones.length === 0) return;
    const bounds = padronBounds(padronLayersRef.current.values());
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }

  async function deletePadron(id: string) {
    if (readOnly || !window.confirm("¿Quitar este padrón del campo?")) return;
    clearActionError();
    const result = await sendJsonResult("/api/padrones", "DELETE", { id });
    if (!result.ok) {
      setActionError(result.error || "No se pudo quitar el padrón.");
      return;
    }
    notifySectionsChanged();
  }

  async function addSubsection(padronId: string) {
    if (readOnly || !subName.trim()) return;
    setSaving(true);
    clearActionError();

    // Build map_center: polygon if 3+ points, point if 1, null if 0
    let mapCenter = null;
    if (subPoints.length >= 3) {
      const coords = subPoints.map((p) => [p.lng, p.lat]);
      coords.push(coords[0]); // close ring
      mapCenter = { type: "Polygon", coordinates: [coords] };
    } else if (subPoints.length === 1) {
      mapCenter = { lat: subPoints[0].lat, lng: subPoints[0].lng };
    }

    const payload = {
      padronId, name: subName,
      sizeHectares: subHa ? parseLocalizedNumber(subHa) : null,
      color: subColor,
      mapCenter,
    };
    const signature = JSON.stringify(payload);
    if (!subsectionAttempt.current || subsectionAttempt.current.signature !== signature) {
      subsectionAttempt.current = { key: createIdempotencyKey(), signature };
    }
    const result = await sendJsonResult("/api/padrones", "PUT", payload, { idempotencyKey: subsectionAttempt.current.key });
    if (!result.ok) {
      setActionError(result.error || "No se pudo crear el potrero.");
      setSaving(false);
      return;
    }
    subsectionAttempt.current = null;
    try {
      cleanupSubdivide();
      await loadPadrones();
      notifySectionsChanged();
    } catch { setActionError("No se pudo actualizar el mapa. Revisá la conexión e intentá nuevamente."); }
    setSaving(false);
  }

  function cleanupSubdivide() {
    subsectionAttempt.current = null;
    if (subPreviewRef.current && mapRef.current) {
      mapRef.current.removeLayer(subPreviewRef.current);
      subPreviewRef.current = null;
    }
    setShowSubdivide(null); setPlacingArea(false); setPlacingSection(null);
    setSubName(""); setSubHa(""); setSubColor(DEFAULT_SUBSECTION_COLOR); setSubPoints([]);
  }

  function undoSubPoint() {
    setSubPoints((prev) => {
      const next = prev.slice(0, -1);
      const map = mapRef.current;
      if (map && subPreviewRef.current) { map.removeLayer(subPreviewRef.current); subPreviewRef.current = null; }
      if (map && next.length > 0) {
        const preview = areaPreview(next, subColor);
        preview.addTo(map);
        subPreviewRef.current = preview;
      }
      return next;
    });
  }

  async function deleteFeature(id: string) {
    if (readOnly || !window.confirm("¿Quitar este elemento del mapa?")) return;
    clearActionError();
    const result = await sendJsonResult("/api/map-features", "DELETE", { id });
    if (!result.ok) {
      setActionError(result.error || "No se pudo quitar la infraestructura.");
      return;
    }
  }

  function focusPadron(p: Padron) {
    const group = padronLayersRef.current.get(p.id);
    if (group && mapRef.current) {
      const bounds = padronBounds([group]);
      if (bounds.isValid()) mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  }

  function focusSection(status: SectionFieldStatus) {
    const map = mapRef.current;
    if (!map) return;
    const padron = padrones.find((item) => item.sections?.some((section) => section.id === status.id))
      ?? padrones.find((item) => item.id === status.padronId);
    const geometry = padron?.sections?.find((section) => section.id === status.id)?.map_center;
    if (geometry?.type === "Polygon") {
      const bounds = L.geoJSON(geometry as unknown as GeoJSON.Polygon).getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17 });
    } else if (geometry && typeof geometry.lat === "number" && typeof geometry.lng === "number") {
      map.setView([geometry.lat, geometry.lng], Math.max(map.getZoom(), 16));
    } else if (padron) {
      focusPadron(padron);
    } else {
      return;
    }
    mapContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function focusMapFeature(feature: MapFeature) {
    const layer = featureLayersRef.current.get(feature.id);
    const map = mapRef.current;
    if (!layer || !map) return;
    if (layer instanceof L.Marker) {
      map.setView(layer.getLatLng(), Math.max(map.getZoom(), 16));
    } else if (layer instanceof L.Polyline || layer instanceof L.FeatureGroup) {
      const bounds = layer.getBounds();
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [60, 60], maxZoom: 17 });
    }
  }

  function focusWaterPoint(point: WaterPoint) {
    const map = mapRef.current;
    if (!map || !point.location) return;
    const [lng, lat] = point.location.coordinates;
    map.setView([lat, lng], Math.max(map.getZoom(), 16));
  }

  async function saveWaterPoint(id: string, patch: Record<string, unknown>) {
    setWaterSaving(true);
    setWaterError("");
    try {
      const result = await sendWaterPoint("PATCH", { id, ...patch });
      if (!result.ok) {
        setWaterError(result.error);
        return;
      }
      if (result.point) replaceWaterPoint(result.point);
      setWaterSheetOpen(false);
    } finally {
      setWaterSaving(false);
    }
  }

  async function markWaterPointChecked(point: WaterPoint) {
    if (readOnly || checkingId) return;
    setCheckingId(point.id);
    setWaterError("");
    try {
      const result = await sendWaterPoint("PATCH", { id: point.id, checkedNow: true });
      if (!result.ok) {
        if (waterSheetOpen) setWaterError(result.error);
        else setActionError(result.error);
        return;
      }
      if (result.point) replaceWaterPoint(result.point);
    } finally {
      setCheckingId(null);
    }
  }

  async function deleteWaterPoint(point: WaterPoint) {
    if (readOnly || !window.confirm(`¿Eliminar la aguada ${point.name}? Los potreros que abastece dejan de depender de ella.`)) return;
    setWaterSaving(true);
    try {
      const result = await sendWaterPoint("DELETE", { id: point.id });
      if (!result.ok) {
        setWaterError(result.error);
        return;
      }
      removeWaterPoint(point.id);
      setWaterSheetOpen(false);
      setSelectedWaterId(null);
    } finally {
      setWaterSaving(false);
    }
  }

  function startRelocate(point: WaterPoint) {
    cleanupDraw();
    cleanupSubdivide();
    setWaterSheetOpen(false);
    setRelocating(point);
    if (point.location) focusWaterPoint(point);
    window.requestAnimationFrame(() => mapContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  const isPointType = isPointFeature(drawMode);
  const busyOnMap = Boolean(drawMode) || placingArea || importing || Boolean(relocating);
  const canEdit = !readOnly && !offlineReadOnly;

  return (
    <div className="flex flex-1 flex-col lg:min-h-0 lg:flex-row">
      <div className="flex flex-col lg:min-h-0 lg:flex-1">
        <MapNotices
          className="px-4 pb-3 sm:px-6"
          offlineReadOnly={offlineReadOnly}
          offlineMapAvailable={offlineMapAvailable}
          offlineMapSavedAt={offlineMapSavedAt}
          loadError={padronesLoadError || featuresLoadError}
          onRetry={() => { loadPadrones(); loadFeatures(); }}
          padronesTruncated={padronesTruncated}
          featuresTruncated={featuresTruncated}
        />

        {/* `isolate` keeps Leaflet's high z-indexes below the app's sticky header and tab bar. */}
        <div className="relative isolate h-[62dvh] min-h-[22rem] w-full border-y border-border lg:h-auto lg:min-h-0 lg:flex-1 lg:border-b-0">
          <div ref={mapContainerRef} className="absolute inset-0" />

          <div className="pointer-events-none absolute left-3 right-14 top-3 z-[1000] flex flex-col gap-2 sm:right-auto sm:w-[23rem] [&>*]:pointer-events-auto">
            {placingArea && (
              <PlacementOverlay
                sectionName={placingSection?.name ?? null}
                pointCount={subPoints.length}
                saving={saving}
                onSave={() => { void savePlacedSection(); }}
                onUndo={undoSubPoint}
                onCancel={cleanupSubdivide}
              />
            )}
            {drawMode && (
              <DrawOverlay
                drawMode={drawMode}
                drawName={drawName}
                onNameChange={setDrawName}
                pointCount={drawPoints.length}
                isPointType={isPointType}
                readOnly={readOnly}
                saving={saving}
                onUndo={undoLastPoint}
                onSave={saveDrawnFeature}
                onCancel={cleanupDraw}
                lengthM={drawLengthM}
                fence={drawMode === "alambrado" ? { kind: fenceKind, onKindChange: setFenceKind, snap: snapEnabled, onSnapChange: setSnapEnabled, lastSnapped } : undefined}
                aguada={drawMode === "aguada" && waterPointsEnabled ? { kind: aguadaKind, onKindChange: setAguadaKind } : undefined}
              />
            )}
            {relocating && <RelocateOverlay name={relocating.name} onCancel={() => setRelocating(null)} />}
            {importing && (
              <PhotoImportControls
                opacity={photo.opacity}
                onOpacityChange={photo.setOpacity}
                showDrafts={photo.showDrafts}
                onToggleDrafts={() => photo.setShowDrafts((shown) => !shown)}
                onAdjust={photo.adjust}
                hasPadrones={padrones.length > 0}
                pending={(photo.counts.pending ?? 0) + (photo.counts.error ?? 0)}
                onFinish={photo.reset}
              />
            )}
            {!busyOnMap && (
              <PadronSearchPanel
                searchDept={search.searchDept}
                onDeptChange={search.setSearchDept}
                searchNum={search.searchNum}
                onNumChange={search.setSearchNum}
                searching={search.searching}
                searchResult={search.searchResult}
                adding={search.adding}
                readOnly={readOnly}
                onSearch={search.searchPadron}
                onAdd={search.addPadron}
              />
            )}
            {photo.error && (
              <MapActionError message={photo.error} showDiagnostic={false} onDiagnostic={() => photo.setError("")} />
            )}
            {actionError && (
              <MapActionError
                message={actionError}
                showDiagnostic={padronMigrationRequired || mapFeatureMigrationRequired}
                onDiagnostic={() => navigate("/gestion/campo")}
              />
            )}
          </div>

          {!busyOnMap && (
            <div className="absolute right-3 top-3 z-[1000] flex flex-col items-end gap-2">
              {padrones.length > 0 && <LocateButton onClick={locateCampo} />}
              {graph && graph.edges.length > 0 && <LinderosToggle pressed={showLinderos} onToggle={() => setShowLinderos((shown) => !shown)} />}
              {canEdit && (
                <PhotoImportButton
                  disabled={!mapReady}
                  busy={photo.phase === "analyzing"}
                  onFile={(file) => { clearActionError(); void photo.analyze(file); }}
                />
              )}
            </div>
          )}

          {!importing && !relocating && (
            <div className="absolute bottom-3 left-3 right-14 z-[1000] flex">
              <DrawToolbar
                drawMode={drawMode}
                onToggle={toggleDrawMode}
              />
            </div>
          )}
        </div>
      </div>

      <aside aria-label="Potreros, aguadas, padrones e infraestructura" className="space-y-8 px-4 py-6 sm:px-6 lg:w-[27rem] lg:shrink-0 lg:overflow-y-auto lg:border-l lg:border-border lg:px-5">
        {importing && photo.extraction && photo.bounds && (
          <PhotoImportReview
            extraction={photo.extraction}
            bounds={photo.bounds}
            items={photo.items}
            readOnly={!canEdit}
            existingFor={photo.existingFor}
            onConfirmPotrero={(key, action, existing) => { void photo.confirmPotrero(key, action, existing); }}
            onConfirmAguada={(key) => { void photo.confirmAguada(key); }}
            onConfirmLine={(key) => { void photo.confirmLine(key); }}
            onConfirmAll={() => { void photo.confirmAll(); }}
            onDiscard={photo.discard}
            onRestore={photo.restore}
            onFinish={photo.reset}
          />
        )}

        {(!offlineReadOnly || fieldStatuses.length > 0) && <FieldStatusPanel
          statuses={fieldStatuses}
          totals={fieldTotals}
          rotation={showCattle ? rotation : []}
          showCattle={showCattle}
          loading={fieldLoading}
          error={fieldError && !offlineReadOnly}
          onRetry={() => { void loadFieldStatus(); }}
          onFocus={focusSection}
          onOpen={(status) => navigate(`/produccion/hacienda?sectionId=${encodeURIComponent(status.id)}`)}
          readOnly={readOnly || offlineReadOnly}
          onPlace={padrones.length > 0 ? startPlacingSection : undefined}
          onMoved={() => { void loadFieldStatus(); }}
          padrones={padrones.map((padron) => ({ id: padron.id, code: padron.padron_code }))}
          onPlaced={() => { void Promise.all([loadPadrones(), loadFieldStatus()]); }}
          graph={graph}
          onRouteChange={setRoutePath}
        />}

        {!offlineReadOnly && (
          <AguadaList
            points={water.waterPoints}
            sectionNames={sectionNames}
            truncated={water.truncated}
            migrationRequired={water.migrationRequired}
            loadError={water.loadError}
            readOnly={readOnly}
            checkingId={checkingId}
            onOpen={(point) => { focusWaterPoint(point); openWaterPoint(point); }}
            onMarkChecked={(point) => { void markWaterPointChecked(point); }}
            onRetry={() => { void water.loadWaterPoints(); }}
          />
        )}

        <PadronList
          padrones={padrones}
          truncated={padronesTruncated}
          subdividingId={showSubdivide}
          readOnly={readOnly}
          onFocus={focusPadron}
          onDelete={deletePadron}
          onOpenSection={(sectionId) => navigate(`/produccion/hacienda?sectionId=${encodeURIComponent(sectionId)}`)}
          onToggleSubdivide={(p) => {
            setShowSubdivide(showSubdivide === p.id ? null : p.id);
            setSubName(`${p.padron_code} `);
            setSubColor(SECTION_COLORS[(p.sections?.length || 0) % SECTION_COLORS.length]);
          }}
          subdivide={{
            name: subName,
            onNameChange: setSubName,
            hectares: subHa,
            onHectaresChange: setSubHa,
            color: subColor,
            onColorChange: setSubColor,
            pointCount: subPoints.length,
            placingArea,
            onTogglePlacing: (p) => { setPlacingArea(!placingArea); focusPadron(p); },
            onUndo: undoSubPoint,
            onCreate: (padronId) => { void addSubsection(padronId); },
            onCancel: cleanupSubdivide,
            saving,
          }}
        />

        <FeatureList
          features={visibleFeatures}
          truncated={featuresTruncated}
          readOnly={readOnly}
          onFocus={(feature) => {
            focusMapFeature(feature);
            mapContainerRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          }}
          onDelete={deleteFeature}
        />
      </aside>

      <WaterPointSheet
        key={selectedWater?.id ?? "none"}
        point={selectedWater}
        open={waterSheetOpen && Boolean(selectedWater)}
        onOpenChange={(open) => { setWaterSheetOpen(open); if (!open) setWaterError(""); }}
        sections={sectionChoices}
        readOnly={readOnly || offlineReadOnly}
        saving={waterSaving}
        error={waterError}
        onSave={(id, patch) => { void saveWaterPoint(id, patch); }}
        onMarkChecked={(point) => { void markWaterPointChecked(point); }}
        onRelocate={startRelocate}
        onDelete={(point) => { void deleteWaterPoint(point); }}
      />
    </div>
  );
}
