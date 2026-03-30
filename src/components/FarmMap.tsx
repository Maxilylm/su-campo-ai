"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

// ── Types ──
interface Padron {
  id: string;
  padron_code: string;
  padron_number: number;
  department_code: string;
  department_name: string;
  area_m2: number | null;
  geometry: GeoJSON.Geometry;
  sections?: { id: string; name: string; color: string; map_center?: Record<string, unknown> | null }[];
}

interface MapFeature {
  id: string;
  type: string;
  name: string | null;
  geometry: GeoJSON.Geometry;
  properties: Record<string, unknown>;
}

// ── Constants ──
const DEPARTMENTS = [
  ["A", "Canelones"], ["B", "Maldonado"], ["C", "Rocha"],
  ["D", "Treinta y Tres"], ["E", "Cerro Largo"], ["F", "Rivera"],
  ["G", "Artigas"], ["H", "Salto"], ["I", "Paysandú"],
  ["J", "Río Negro"], ["K", "Soriano"], ["L", "Colonia"],
  ["M", "San José"], ["N", "Flores"], ["O", "Florida"],
  ["P", "Lavalleja"], ["Q", "Durazno"], ["R", "Tacuarembó"],
  ["V", "Montevideo"],
] as const;

const FEATURE_TYPES = [
  { value: "road", label: "Camino", color: "#a1887f", icon: "🛤️", dash: "8 4" },
  { value: "portera", label: "Portera", color: "#fbbf24", icon: "🚪", dash: "" },
  { value: "alambrado", label: "Alambrado", color: "#78909c", icon: "🔗", dash: "4 4" },
  { value: "aguada", label: "Aguada", color: "#42a5f5", icon: "💧", dash: "" },
  { value: "manga", label: "Manga/Corral", color: "#ef5350", icon: "🏗️", dash: "" },
] as const;

const PADRON_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const SECTION_COLORS = ["#22c55e", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

export default function FarmMap() {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const padronLayersRef = useRef<Map<string, L.LayerGroup>>(new Map());
  const featureLayersRef = useRef<Map<string, L.Layer>>(new Map());
  const searchLayerRef = useRef<L.GeoJSON | null>(null);
  const drawPreviewRef = useRef<L.LayerGroup | null>(null);

  const [padrones, setPadrones] = useState<Padron[]>([]);
  const [mapFeatures, setMapFeatures] = useState<MapFeature[]>([]);
  const [searchDept, setSearchDept] = useState("D");
  const [searchNum, setSearchNum] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<GeoJSON.FeatureCollection | null>(null);
  const [adding, setAdding] = useState(false);
  const [drawMode, setDrawMode] = useState<string | null>(null);
  const [drawName, setDrawName] = useState("");
  const [drawPoints, setDrawPoints] = useState<L.LatLng[]>([]);
  const [saving, setSaving] = useState(false);
  const [showSubdivide, setShowSubdivide] = useState<string | null>(null);
  const [subName, setSubName] = useState("");
  const [subHa, setSubHa] = useState("");
  const [subColor, setSubColor] = useState("#22c55e");
  const [subPoints, setSubPoints] = useState<L.LatLng[]>([]);
  const [placingArea, setPlacingArea] = useState(false);
  const subPreviewRef = useRef<L.LayerGroup | null>(null);

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

    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; };
  }, []);

  // ── Load data ──
  const loadPadrones = useCallback(async () => {
    try {
      const res = await fetch("/api/padrones");
      if (res.ok) setPadrones(await res.json());
    } catch { /* ignore */ }
  }, []);

  const loadFeatures = useCallback(async () => {
    try {
      const res = await fetch("/api/map-features");
      if (res.ok) setMapFeatures(await res.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadPadrones(); loadFeatures(); }, [loadPadrones, loadFeatures]);

  // ── Render padrones on map ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing (includes labels now)
    padronLayersRef.current.forEach((group) => map.removeLayer(group));
    padronLayersRef.current.clear();

    padrones.forEach((p, i) => {
      const color = PADRON_COLORS[i % PADRON_COLORS.length];
      const group = L.layerGroup();

      const polygon = L.geoJSON(p.geometry as GeoJSON.GeoJsonObject, {
        style: { color, weight: 3, fillColor: color, fillOpacity: 0.15 },
      });

      const padronCenter = polygon.getBounds().getCenter();

      // Render sub-section areas and labels
      const sections = p.sections || [];
      const sectionsWithGeo = sections.filter((s) => s.map_center?.type === "Polygon");
      const sectionsWithPoint = sections.filter((s) => s.map_center && !s.map_center.type);
      const sectionsPlain = sections.filter((s) => !s.map_center);

      // Polygon sub-sections
      for (const s of sectionsWithGeo) {
        const geo = s.map_center as unknown as GeoJSON.Polygon;
        const subPoly = L.geoJSON(geo as GeoJSON.GeoJsonObject, {
          style: { color: s.color, weight: 2, fillColor: s.color, fillOpacity: 0.2 },
        });
        const subCenter = subPoly.getBounds().getCenter();
        const sLabel = L.marker(subCenter, {
          icon: L.divIcon({
            className: "padron-label",
            html: `<div style="background:${s.color}33;border:1px solid ${s.color};border-radius:6px;padding:2px 8px;font-size:11px;color:white;white-space:nowrap;font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,0.8)">${s.name}</div>`,
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
            html: `<div style="background:${s.color}22;border:1px solid ${s.color};border-radius:6px;padding:2px 8px;font-size:11px;color:white;white-space:nowrap;font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,0.8)">${s.name}</div>`,
            iconAnchor: [0, 0],
          }),
          interactive: false,
        });
        group.addLayer(sLabel);
      }

      // Plain sections (no geometry) + padron label at center
      const plainNames = sectionsPlain.length > 0
        ? sectionsPlain.map((s) => s.name).join(", ")
        : (sectionsWithGeo.length === 0 && sectionsWithPoint.length === 0) ? p.padron_code : null;

      if (plainNames) {
        const label = L.marker(padronCenter, {
          icon: L.divIcon({
            className: "padron-label",
            html: `<div style="background:${color}22;border:1px solid ${color};border-radius:6px;padding:2px 8px;font-size:11px;color:white;white-space:nowrap;font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,0.8)">${plainNames}</div>`,
            iconAnchor: [0, 0],
          }),
          interactive: false,
        });
        group.addLayer(label);
      }

      group.addLayer(polygon);
      group.addTo(map);
      padronLayersRef.current.set(p.id, group);
    });

    if (padrones.length > 0) {
      const bounds = L.latLngBounds([]);
      padronLayersRef.current.forEach((group) => {
        group.eachLayer((l) => {
          if (l instanceof L.GeoJSON) bounds.extend(l.getBounds());
        });
      });
      if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
    }
  }, [padrones]);

  // ── Render map features ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    featureLayersRef.current.forEach((layer) => map.removeLayer(layer));
    featureLayersRef.current.clear();

    mapFeatures.forEach((f) => {
      const featureType = FEATURE_TYPES.find((t) => t.value === f.type);
      const color = featureType?.color || "#ffffff";
      const dash = featureType?.dash || "";

      if (f.geometry.type === "LineString") {
        const coords = (f.geometry as GeoJSON.LineString).coordinates.map(
          ([lng, lat]) => [lat, lng] as L.LatLngTuple
        );
        const line = L.polyline(coords, {
          color, weight: f.type === "road" ? 4 : 2.5,
          dashArray: dash || undefined, opacity: 0.9,
        });
        if (f.name) line.bindTooltip(f.name, { permanent: false, direction: "center", className: "feature-tooltip" });
        line.addTo(map);
        featureLayersRef.current.set(f.id, line);
      } else if (f.geometry.type === "Point") {
        const [lng, lat] = (f.geometry as GeoJSON.Point).coordinates;
        const icon = featureType?.icon || "📍";
        const marker = L.marker([lat, lng], {
          icon: L.divIcon({
            className: "feature-marker",
            html: `<div style="font-size:20px;text-shadow:0 1px 3px rgba(0,0,0,0.6)">${icon}</div>`,
            iconAnchor: [12, 12],
          }),
        });
        if (f.name) marker.bindTooltip(f.name);
        marker.addTo(map);
        featureLayersRef.current.set(f.id, marker);
      }
    });
  }, [mapFeatures]);

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
    const isPointType = drawMode === "aguada" || drawMode === "portera";
    if (!isPointType) map.dragging.disable();
    else map.dragging.enable();

    const featureType = FEATURE_TYPES.find((t) => t.value === drawMode);
    const color = featureType?.color || "#ffffff";

    function onClick(e: L.LeafletMouseEvent) {
      if (isPointType) {
        setDrawPoints([e.latlng]);
        // Show preview marker
        if (drawPreviewRef.current) map!.removeLayer(drawPreviewRef.current);
        const preview = L.layerGroup();
        const icon = featureType?.icon || "📍";
        L.marker(e.latlng, {
          icon: L.divIcon({
            className: "feature-marker",
            html: `<div style="font-size:24px;text-shadow:0 1px 3px rgba(0,0,0,0.6);filter:drop-shadow(0 0 4px ${color})">${icon}</div>`,
            iconAnchor: [14, 14],
          }),
        }).addTo(preview);
        preview.addTo(map!);
        drawPreviewRef.current = preview;
        return;
      }

      setDrawPoints((prev) => {
        const next = [...prev, e.latlng];
        // Update preview line + point markers
        if (drawPreviewRef.current) map!.removeLayer(drawPreviewRef.current);
        const preview = L.layerGroup();
        if (next.length > 1) {
          L.polyline(next, { color, weight: 3, dashArray: "6 4", opacity: 0.8 }).addTo(preview);
        }
        next.forEach((pt, idx) => {
          L.circleMarker(pt, {
            radius: 5, color, fillColor: "white", fillOpacity: 1, weight: 2,
          }).bindTooltip(`${idx + 1}`, { permanent: true, direction: "right", className: "feature-tooltip", offset: [8, 0] })
            .addTo(preview);
        });
        preview.addTo(map!);
        drawPreviewRef.current = preview;
        return next;
      });
    }

    map.on("click", onClick);
    return () => { map.off("click", onClick); };
  }, [drawMode]);

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
        const preview = L.layerGroup();
        if (next.length >= 3) {
          L.polygon(next, { color: subColor, weight: 2, fillColor: subColor, fillOpacity: 0.25, dashArray: "6 4" }).addTo(preview);
        } else if (next.length === 2) {
          L.polyline(next, { color: subColor, weight: 2, dashArray: "6 4" }).addTo(preview);
        }
        next.forEach((pt, idx) => {
          L.circleMarker(pt, { radius: 4, color: subColor, fillColor: "white", fillOpacity: 1, weight: 2 })
            .bindTooltip(`${idx + 1}`, { permanent: true, direction: "right", className: "feature-tooltip", offset: [6, 0] })
            .addTo(preview);
        });
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

  function locateCampo() {
    const map = mapRef.current;
    if (!map || padrones.length === 0) return;
    const bounds = L.latLngBounds([]);
    padronLayersRef.current.forEach((group) => {
      group.eachLayer((l) => { if (l instanceof L.GeoJSON) bounds.extend(l.getBounds()); });
    });
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }

  // ── Search padron ──
  async function searchPadron() {
    if (!searchNum.trim()) return;
    setSearching(true);
    setSearchResult(null);

    try {
      const code = `${searchDept}-${searchNum.trim()}`;
      const res = await fetch(`/api/padrones/search?code=${encodeURIComponent(code)}`);
      const data = await res.json();

      if (data.features && data.features.length > 0) {
        setSearchResult(data);
        const map = mapRef.current;
        if (map) {
          if (searchLayerRef.current) map.removeLayer(searchLayerRef.current);
          searchLayerRef.current = L.geoJSON(data, {
            style: { color: "#fbbf24", weight: 3, fillColor: "#fbbf24", fillOpacity: 0.2, dashArray: "6 4" },
          }).addTo(map);
          map.fitBounds(searchLayerRef.current.getBounds(), { padding: [60, 60], maxZoom: 16 });
        }
      } else {
        setSearchResult({ type: "FeatureCollection", features: [] });
      }
    } catch {
      setSearchResult({ type: "FeatureCollection", features: [] });
    } finally {
      setSearching(false);
    }
  }

  async function addPadron() {
    if (!searchResult || searchResult.features.length === 0) return;
    setAdding(true);
    const feature = searchResult.features[0];
    const props = feature.properties || {};
    const code = `${searchDept}-${searchNum.trim()}`;

    try {
      const res = await fetch("/api/padrones", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          padronCode: code,
          padronNumber: parseInt(searchNum),
          departmentCode: searchDept,
          departmentName: props.nomDepto || DEPARTMENTS.find(([c]) => c === searchDept)?.[1] || "",
          areaM2: props["SHAPE.STArea()"] || null,
          geometry: feature.geometry,
        }),
      });
      if (res.ok) {
        if (mapRef.current && searchLayerRef.current) {
          mapRef.current.removeLayer(searchLayerRef.current);
          searchLayerRef.current = null;
        }
        setSearchResult(null);
        setSearchNum("");
        await loadPadrones();
      }
    } catch { /* ignore */ }
    setAdding(false);
  }

  async function deletePadron(id: string) {
    await fetch("/api/padrones", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    await loadPadrones();
  }

  async function addSubsection(padronId: string) {
    if (!subName.trim()) return;
    setSaving(true);

    // Build map_center: polygon if 3+ points, point if 1, null if 0
    let mapCenter = null;
    if (subPoints.length >= 3) {
      const coords = subPoints.map((p) => [p.lng, p.lat]);
      coords.push(coords[0]); // close ring
      mapCenter = { type: "Polygon", coordinates: [coords] };
    } else if (subPoints.length === 1) {
      mapCenter = { lat: subPoints[0].lat, lng: subPoints[0].lng };
    }

    await fetch("/api/padrones", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        padronId, name: subName,
        sizeHectares: subHa ? Number(subHa) : null,
        color: subColor,
        mapCenter,
      }),
    });
    cleanupSubdivide();
    setSaving(false);
    await loadPadrones();
  }

  function cleanupSubdivide() {
    if (subPreviewRef.current && mapRef.current) {
      mapRef.current.removeLayer(subPreviewRef.current);
      subPreviewRef.current = null;
    }
    setShowSubdivide(null); setPlacingArea(false);
    setSubName(""); setSubHa(""); setSubColor("#22c55e"); setSubPoints([]);
  }

  function undoSubPoint() {
    setSubPoints((prev) => {
      const next = prev.slice(0, -1);
      const map = mapRef.current;
      if (map && subPreviewRef.current) { map.removeLayer(subPreviewRef.current); subPreviewRef.current = null; }
      if (map && next.length > 0) {
        const preview = L.layerGroup();
        if (next.length >= 3) {
          L.polygon(next, { color: subColor, weight: 2, fillColor: subColor, fillOpacity: 0.25, dashArray: "6 4" }).addTo(preview);
        } else if (next.length === 2) {
          L.polyline(next, { color: subColor, weight: 2, dashArray: "6 4" }).addTo(preview);
        }
        next.forEach((pt, idx) => {
          L.circleMarker(pt, { radius: 4, color: subColor, fillColor: "white", fillOpacity: 1, weight: 2 })
            .bindTooltip(`${idx + 1}`, { permanent: true, direction: "right", className: "feature-tooltip", offset: [6, 0] })
            .addTo(preview);
        });
        preview.addTo(map);
        subPreviewRef.current = preview;
      }
      return next;
    });
  }

  async function saveDrawnFeature() {
    if (drawPoints.length === 0) return;
    setSaving(true);

    const isPointType = drawMode === "aguada" || drawMode === "portera";
    const geometry: GeoJSON.Geometry = isPointType
      ? { type: "Point", coordinates: [drawPoints[0].lng, drawPoints[0].lat] }
      : { type: "LineString", coordinates: drawPoints.map((p) => [p.lng, p.lat]) };

    try {
      await fetch("/api/map-features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: drawMode, name: drawName || null, geometry }),
      });
      cleanupDraw();
      await loadFeatures();
    } catch { /* ignore */ }
    setSaving(false);
  }

  async function deleteFeature(id: string) {
    await fetch("/api/map-features", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    await loadFeatures();
  }

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
        const featureType = FEATURE_TYPES.find((t) => t.value === drawMode);
        const color = featureType?.color || "#ffffff";
        const preview = L.layerGroup();
        if (next.length > 1) {
          L.polyline(next, { color, weight: 3, dashArray: "6 4", opacity: 0.8 }).addTo(preview);
        }
        next.forEach((pt, idx) => {
          L.circleMarker(pt, { radius: 5, color, fillColor: "white", fillOpacity: 1, weight: 2 })
            .bindTooltip(`${idx + 1}`, { permanent: true, direction: "right", className: "feature-tooltip", offset: [8, 0] })
            .addTo(preview);
        });
        preview.addTo(map);
        drawPreviewRef.current = preview;
      }
      return next;
    });
  }

  function focusPadron(p: Padron) {
    const group = padronLayersRef.current.get(p.id);
    if (group && mapRef.current) {
      const bounds = L.latLngBounds([]);
      group.eachLayer((l) => {
        if (l instanceof L.GeoJSON) bounds.extend(l.getBounds());
      });
      if (bounds.isValid()) mapRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  }

  const isPointType = drawMode === "aguada" || drawMode === "portera";

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Buscar Padron</h3>
        <div className="flex flex-col sm:flex-row gap-2">
          <select value={searchDept} onChange={(e) => setSearchDept(e.target.value)}
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground sm:w-48">
            {DEPARTMENTS.map(([code, name]) => (
              <option key={code} value={code}>{code} — {name}</option>
            ))}
          </select>
          <input type="text" inputMode="numeric" pattern="[0-9]*"
            value={searchNum} onChange={(e) => setSearchNum(e.target.value.replace(/\D/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && searchPadron()}
            placeholder="Nro de padron (ej: 995)"
            className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground flex-1" />
          <button onClick={searchPadron} disabled={!searchNum.trim() || searching}
            className="h-9 px-4 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 text-sm whitespace-nowrap">
            {searching ? "Buscando..." : "Buscar"}
          </button>
        </div>

        {searchResult && searchResult.features.length === 0 && (
          <p className="text-sm text-red-400 mt-2">No se encontro padron {searchDept}-{searchNum}</p>
        )}
        {searchResult && searchResult.features.length > 0 && (
          <div className="mt-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-muted/60 rounded-lg p-3">
            <div>
              <span className="text-sm font-medium text-emerald-400">{searchDept}-{searchNum}</span>
              <span className="text-xs text-muted-foreground ml-2">
                {searchResult.features[0].properties?.nomDepto}
                {searchResult.features[0].properties?.["SHAPE.STArea()"] &&
                  ` · ${Math.round(searchResult.features[0].properties["SHAPE.STArea()"] / 10000 * 10) / 10} ha`}
              </span>
            </div>
            <button onClick={addPadron} disabled={adding} className="h-8 px-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 text-xs">
              {adding ? "Agregando..." : "+ Agregar al campo"}
            </button>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="rounded-xl border border-border bg-card overflow-hidden relative">
        <div ref={mapContainerRef} style={{ height: "min(500px, 55vh)" }} className="w-full" />

        {/* Locate button */}
        {padrones.length > 0 && !drawMode && !placingArea && (
          <button onClick={locateCampo}
            className="absolute top-3 right-3 z-[1000] w-9 h-9 flex items-center justify-center rounded-lg bg-zinc-900/90 border border-zinc-700/50 text-zinc-400 hover:text-emerald-400 hover:border-emerald-500/50 transition-colors backdrop-blur-sm"
            title="Centrar en mi campo">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" />
            </svg>
          </button>
        )}

        {/* Placement mode overlay */}
        {placingArea && (
          <div className="absolute top-3 left-3 right-14 z-[1000] bg-zinc-900/95 border border-emerald-500/30 rounded-xl px-3 py-2 backdrop-blur-sm">
            <span className="text-sm text-emerald-400">
              Toca puntos en el mapa para dibujar el area de la seccion
              {subPoints.length > 0 && <span className="text-zinc-400"> ({subPoints.length} pts{subPoints.length < 3 ? ", min 3" : ""})</span>}
            </span>
          </div>
        )}

        {/* Draw mode overlay */}
        {drawMode && (
          <div className="absolute top-3 left-3 right-3 z-[1000] bg-zinc-900/95 border border-zinc-700 rounded-xl p-3 backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2 mb-2">
              <span className="text-sm text-zinc-300">
                <span className="text-emerald-400 font-medium">
                  {FEATURE_TYPES.find((t) => t.value === drawMode)?.icon}{" "}
                  {FEATURE_TYPES.find((t) => t.value === drawMode)?.label}
                </span>
                {" — "}
                {isPointType
                  ? "Toca el mapa para colocar"
                  : `Toca el mapa para agregar puntos (${drawPoints.length} pts)`}
              </span>
            </div>
            <div className="flex gap-2">
              <input type="text" value={drawName} onChange={(e) => setDrawName(e.target.value)}
                placeholder="Nombre (opcional)"
                className="h-9 rounded-lg border border-border bg-background px-3 text-sm text-foreground flex-1" />
              {!isPointType && drawPoints.length > 0 && (
                <button onClick={undoLastPoint} className="h-8 px-3 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-xs">Deshacer</button>
              )}
              <button onClick={saveDrawnFeature}
                disabled={drawPoints.length === 0 || (!isPointType && drawPoints.length < 2) || saving}
                className="h-8 px-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 text-xs">
                {saving ? "..." : "Guardar"}
              </button>
              <button onClick={cleanupDraw} className="h-8 px-3 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-xs">Cancelar</button>
            </div>
          </div>
        )}
      </div>

      {/* Draw tools */}
      <div className="rounded-xl border border-border bg-card p-4">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">Dibujar en el mapa</h3>
        <div className="flex flex-wrap gap-2">
          {FEATURE_TYPES.map((ft) => (
            <button key={ft.value}
              onClick={() => {
                if (drawMode === ft.value) { cleanupDraw(); }
                else { cleanupDraw(); setDrawMode(ft.value); }
              }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border ${
                drawMode === ft.value
                  ? "bg-emerald-600/20 border-emerald-500/50 text-emerald-400"
                  : "bg-zinc-800/80 border-zinc-700/50 text-zinc-400 hover:border-zinc-600"
              }`}>
              {ft.icon} {ft.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Padrones list */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Padrones ({padrones.length})
          </h3>
          {padrones.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Busca y agrega padrones para verlos en el mapa</p>
          ) : (
            <div className="space-y-2">
              {padrones.map((p, i) => (
                <div key={p.id} className="bg-zinc-800/40 rounded-lg p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <button onClick={() => focusPadron(p)} className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: PADRON_COLORS[i % PADRON_COLORS.length] }} />
                      <span className="font-medium text-sm">{p.padron_code}</span>
                      <span className="text-xs text-zinc-500">{p.department_name}</span>
                      {p.area_m2 && <span className="text-xs text-zinc-500">{Math.round(p.area_m2 / 10000 * 10) / 10} ha</span>}
                    </button>
                    <div className="flex gap-2">
                      <button onClick={() => {
                        setShowSubdivide(showSubdivide === p.id ? null : p.id);
                        setSubName(`${p.padron_code} `);
                        setSubColor(SECTION_COLORS[(p.sections?.length || 0) % SECTION_COLORS.length]);
                      }}
                        className="text-xs text-zinc-500 hover:text-emerald-400 transition-colors">
                        + Dividir
                      </button>
                      <button onClick={() => deletePadron(p.id)}
                        className="text-xs text-zinc-600 hover:text-red-400 transition-colors">
                        Quitar
                      </button>
                    </div>
                  </div>

                  {p.sections && p.sections.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 ml-5">
                      {p.sections.map((s) => (
                        <span key={s.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-zinc-800 text-zinc-300">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: s.color }} />
                          {s.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Subdivide form */}
                  {showSubdivide === p.id && (
                    <div className="ml-0 sm:ml-5 space-y-2 bg-zinc-900/60 rounded-lg p-3 border border-zinc-800">
                      <p className="text-xs text-zinc-500">Crear sub-seccion dentro de {p.padron_code}</p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input type="text" value={subName} onChange={(e) => setSubName(e.target.value)}
                          placeholder={`Ej: ${p.padron_code} Norte`}
                          className="h-8 rounded-lg border border-border bg-background px-3 text-xs text-foreground flex-1" />
                        <input type="text" inputMode="decimal"
                          value={subHa} onChange={(e) => setSubHa(e.target.value)}
                          placeholder="Ha" className="h-8 rounded-lg border border-border bg-background px-3 text-xs text-foreground w-20" />
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs text-zinc-500">Color:</span>
                        <div className="flex gap-1">
                          {SECTION_COLORS.map((c) => (
                            <button key={c} onClick={() => setSubColor(c)}
                              className={`w-5 h-5 rounded-full border-2 transition-all ${subColor === c ? "border-white scale-110" : "border-zinc-700"}`}
                              style={{ backgroundColor: c }} />
                          ))}
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => { setPlacingArea(!placingArea); focusPadron(p); }}
                          className={`text-xs px-2 py-1 rounded border transition-colors ${
                            subPoints.length >= 3
                              ? "border-emerald-500/50 text-emerald-400 bg-emerald-500/10"
                              : placingArea
                                ? "border-amber-500/50 text-amber-400 bg-amber-500/10 animate-pulse"
                                : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                          }`}>
                          {subPoints.length >= 3 ? `Area marcada (${subPoints.length} pts)` : placingArea ? `Dibujando... (${subPoints.length} pts)` : "Dibujar area en mapa"}
                        </button>
                        {placingArea && subPoints.length > 0 && (
                          <button onClick={undoSubPoint} className="h-8 px-3 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-xs">Deshacer</button>
                        )}
                        <div className="flex-1" />
                        <button onClick={() => addSubsection(p.id)} disabled={!subName.trim() || saving}
                          className="h-8 px-3 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 disabled:opacity-50 text-xs">
                          {saving ? "..." : "Crear seccion"}
                        </button>
                        <button onClick={cleanupSubdivide} className="h-8 px-3 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted text-xs">Cancelar</button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Map features list */}
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            Infraestructura ({mapFeatures.length})
          </h3>
          {mapFeatures.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Usa los botones de dibujo para agregar caminos, porteras, etc.</p>
          ) : (
            <div className="space-y-1.5">
              {mapFeatures.map((f) => {
                const ft = FEATURE_TYPES.find((t) => t.value === f.type);
                return (
                  <div key={f.id} className="flex items-center justify-between bg-zinc-800/40 rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span>{ft?.icon || "📍"}</span>
                      <span className="text-sm">{f.name || ft?.label || f.type}</span>
                    </div>
                    <button onClick={() => deleteFeature(f.id)}
                      className="text-xs text-zinc-600 hover:text-red-400 transition-colors">
                      Quitar
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
