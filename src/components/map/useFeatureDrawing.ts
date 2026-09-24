"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import type L from "leaflet";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { isPointFeature } from "./constants";
import { linePreview, pointPreview } from "./layers";

interface FeatureDrawingOptions {
  mapRef: RefObject<L.Map | null>;
  readOnly: boolean;
  setSaving: (saving: boolean) => void;
  clearActionError: () => void;
  setActionError: (message: string) => void;
  setMapFeatureMigrationRequired: (required: boolean) => void;
}

/** Drawing infrastructure on the map: points (aguada, portera) or lines (camino, alambrado…). */
export function useFeatureDrawing({ mapRef, readOnly, setSaving, clearActionError, setActionError, setMapFeatureMigrationRequired }: FeatureDrawingOptions) {
  const [drawMode, setDrawMode] = useState<string | null>(null);
  const [drawName, setDrawName] = useState("");
  const [drawPoints, setDrawPoints] = useState<L.LatLng[]>([]);
  const drawPreviewRef = useRef<L.LayerGroup | null>(null);
  const drawAttempt = useRef<{ key: string; signature: string } | null>(null);

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

      setDrawPoints((prev) => {
        const next = [...prev, e.latlng];
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
  }, [drawMode, mapRef]);

  function cleanupDraw() {
    const map = mapRef.current;
    if (map) {
      if (drawPreviewRef.current) { map.removeLayer(drawPreviewRef.current); drawPreviewRef.current = null; }
      map.dragging.enable();
    }
    setDrawPoints([]);
    setDrawMode(null);
    setDrawName("");
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
  }

  async function saveDrawnFeature() {
    if (readOnly || drawPoints.length === 0) return;
    setSaving(true);
    clearActionError();

    const isPointType = isPointFeature(drawMode);
    const geometry: GeoJSON.Geometry = isPointType
      ? { type: "Point", coordinates: [drawPoints[0].lng, drawPoints[0].lat] }
      : { type: "LineString", coordinates: drawPoints.map((p) => [p.lng, p.lat]) };

    const payload = { type: drawMode, name: drawName || null, geometry };
    const signature = JSON.stringify(payload);
    if (!drawAttempt.current || drawAttempt.current.signature !== signature) {
      drawAttempt.current = { key: createIdempotencyKey(), signature };
    }
    const result = await sendJsonResult("/api/map-features", "POST", payload, { idempotencyKey: drawAttempt.current.key });
    if (!result.ok) {
      setActionError(result.error || "No se pudo guardar la infraestructura.");
      setMapFeatureMigrationRequired(result.code === "map_feature_idempotency_migration_required");
      setSaving(false);
      return;
    }
    drawAttempt.current = null;
    cleanupDraw();
    setSaving(false);
  }

  /** Toolbar: a second tap on the active tool turns it off. */
  function toggleDrawMode(value: string) {
    if (drawMode === value) { cleanupDraw(); }
    else { cleanupDraw(); setDrawMode(value); }
  }

  return { drawMode, drawName, setDrawName, drawPoints, cleanupDraw, undoLastPoint, saveDrawnFeature, toggleDrawMode };
}
