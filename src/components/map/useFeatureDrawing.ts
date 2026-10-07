"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import L from "leaflet";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { fenceProperties, type FenceKind } from "@/lib/fences";
import { metersPerPixel, nearestVertex, pathLengthMeters, type LngLat } from "@/lib/geo-measure";
import type { WaterPoint, WaterPointKind } from "@/lib/water-points";
import { isPointFeature } from "./constants";
import { linePreview, pointPreview } from "./layers";
import { sendWaterPoint } from "./waterPointApi";

/** Screen distance within which a fence vertex jumps onto a potrero/padrón corner. */
const SNAP_PIXELS = 14;

interface FeatureDrawingOptions {
  mapRef: RefObject<L.Map | null>;
  readOnly: boolean;
  setSaving: (saving: boolean) => void;
  clearActionError: () => void;
  setActionError: (message: string) => void;
  setMapFeatureMigrationRequired: (required: boolean) => void;
  /** Corners a fence can snap to (potrero and padrón outlines, other fences). */
  snapVertices: () => LngLat[];
  /** water_points (055) exists: aguadas are registered there, not as map features. */
  waterPointsEnabled: boolean;
  onWaterPointCreated: (point: WaterPoint) => void;
}

/** Drawing infrastructure on the map: points (aguada, portera) or lines (camino, alambrado…). */
export function useFeatureDrawing({
  mapRef, readOnly, setSaving, clearActionError, setActionError, setMapFeatureMigrationRequired,
  snapVertices, waterPointsEnabled, onWaterPointCreated,
}: FeatureDrawingOptions) {
  const [drawMode, setDrawMode] = useState<string | null>(null);
  const [drawName, setDrawName] = useState("");
  const [drawPoints, setDrawPoints] = useState<L.LatLng[]>([]);
  const [fenceKind, setFenceKind] = useState<FenceKind>("convencional");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [aguadaKind, setAguadaKind] = useState<WaterPointKind>("tajamar");
  const [lastSnapped, setLastSnapped] = useState(false);
  const drawPreviewRef = useRef<L.LayerGroup | null>(null);
  const drawAttempt = useRef<{ key: string; signature: string } | null>(null);
  const snapVerticesRef = useRef(snapVertices);
  useEffect(() => { snapVerticesRef.current = snapVertices; }, [snapVertices]);

  // ── Drawing mode: lock map + handle clicks ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!drawMode) {
      map.dragging.enable();
      map.off("click");
      if (drawPreviewRef.current) { map.removeLayer(drawPreviewRef.current); drawPreviewRef.current = null; }
      return;
    }

    // Lock map panning during line drawing (not for point types)
    const isPointType = isPointFeature(drawMode);
    if (!isPointType) map.dragging.disable();
    else map.dragging.enable();

    function onClick(e: L.LeafletMouseEvent) {
      if (isPointType) {
        setDrawPoints([e.latlng]);
        // Show preview marker
        if (drawPreviewRef.current) map!.removeLayer(drawPreviewRef.current);
        const preview = pointPreview(e.latlng, drawMode!);
        preview.addTo(map!);
        drawPreviewRef.current = preview;
        return;
      }

      let latlng = e.latlng;
      let snapped = false;
      if (drawMode === "alambrado" && snapEnabled) {
        const radius = SNAP_PIXELS * metersPerPixel(latlng.lat, map!.getZoom());
        const corner = nearestVertex([latlng.lng, latlng.lat], snapVerticesRef.current(), radius);
        if (corner) {
          latlng = L.latLng(corner[1], corner[0]);
          snapped = true;
        }
      }
      setLastSnapped(snapped);
      setDrawPoints((prev) => {
        const next = [...prev, latlng];
        // Update preview line + point markers
        if (drawPreviewRef.current) map!.removeLayer(drawPreviewRef.current);
        const preview = linePreview(next, drawMode);
        preview.addTo(map!);
        drawPreviewRef.current = preview;
        return next;
      });
    }

    map.on("click", onClick);
    return () => { map.off("click", onClick); };
  }, [drawMode, mapRef, snapEnabled]);

  function cleanupDraw() {
    const map = mapRef.current;
    if (map) {
      if (drawPreviewRef.current) { map.removeLayer(drawPreviewRef.current); drawPreviewRef.current = null; }
      map.dragging.enable();
    }
    setDrawPoints([]);
    setDrawMode(null);
    setDrawName("");
    setLastSnapped(false);
  }

  function undoLastPoint() {
    setDrawPoints((prev) => {
      const next = prev.slice(0, -1);
      const map = mapRef.current;
      if (map && drawPreviewRef.current) {
        map.removeLayer(drawPreviewRef.current);
        drawPreviewRef.current = null;
      }
      if (map && next.length > 0) {
        const preview = linePreview(next, drawMode);
        preview.addTo(map);
        drawPreviewRef.current = preview;
      }
      return next;
    });
    setLastSnapped(false);
  }

  async function saveMapFeature(payload: Record<string, unknown>): Promise<boolean> {
    const signature = JSON.stringify(payload);
    if (!drawAttempt.current || drawAttempt.current.signature !== signature) {
      drawAttempt.current = { key: createIdempotencyKey(), signature };
    }
    const result = await sendJsonResult("/api/map-features", "POST", payload, { idempotencyKey: drawAttempt.current.key });
    if (!result.ok) {
      setActionError(result.error || "No se pudo guardar la infraestructura.");
      setMapFeatureMigrationRequired(result.code === "map_feature_idempotency_migration_required");
      return false;
    }
    return true;
  }

  async function saveDrawnFeature() {
    if (readOnly || drawPoints.length === 0 || !drawMode) return;
    setSaving(true);
    clearActionError();
    try {
      const isPointType = isPointFeature(drawMode);
      const geometry: GeoJSON.Geometry = isPointType
        ? { type: "Point", coordinates: [drawPoints[0].lng, drawPoints[0].lat] }
        : { type: "LineString", coordinates: drawPoints.map((p) => [p.lng, p.lat]) };

      if (drawMode === "aguada" && waterPointsEnabled) {
        const payload = { name: drawName.trim() || "Aguada", kind: aguadaKind, location: geometry };
        const signature = JSON.stringify(payload);
        if (!drawAttempt.current || drawAttempt.current.signature !== signature) {
          drawAttempt.current = { key: createIdempotencyKey(), signature };
        }
        const result = await sendWaterPoint("POST", payload, drawAttempt.current.key);
        if (!result.ok) {
          // The table can disappear only in a rollback; fall back to the old marker.
          if (result.code === "water_points_migration_required") {
            drawAttempt.current = null;
            if (!(await saveMapFeature({ type: "aguada", name: drawName || null, geometry }))) return;
          } else {
            setActionError(result.error);
            return;
          }
        } else if (result.point) {
          onWaterPointCreated(result.point);
        }
      } else {
        const properties = drawMode === "alambrado" ? fenceProperties({ kind: fenceKind }) : {};
        if (!(await saveMapFeature({ type: drawMode, name: drawName || null, geometry, properties }))) return;
      }
      drawAttempt.current = null;
      cleanupDraw();
    } finally {
      setSaving(false);
    }
  }

  /** Toolbar: a second tap on the active tool turns it off. */
  function toggleDrawMode(value: string) {
    if (drawMode === value) { cleanupDraw(); }
    else { cleanupDraw(); setDrawMode(value); }
  }

  const drawLengthM = drawMode && !isPointFeature(drawMode) ? pathLengthMeters(drawPoints.map((p) => [p.lng, p.lat])) : 0;

  return {
    drawMode, drawName, setDrawName, drawPoints, cleanupDraw, undoLastPoint, saveDrawnFeature, toggleDrawMode,
    fenceKind, setFenceKind, snapEnabled, setSnapEnabled, lastSnapped, aguadaKind, setAguadaKind, drawLengthM,
  };
}
