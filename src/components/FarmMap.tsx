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
  sections?: { id: string; name: string; color: string }[];
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

export default function FarmMap() {
  const mapRef = useRef<L.Map | null>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const padronLayersRef = useRef<Map<string, L.GeoJSON>>(new Map());
  const featureLayersRef = useRef<Map<string, L.Layer>>(new Map());
  const searchLayerRef = useRef<L.GeoJSON | null>(null);
  const drawPointsRef = useRef<L.LatLng[]>([]);
  const drawPreviewRef = useRef<L.Polyline | null>(null);

  const [padrones, setPadrones] = useState<Padron[]>([]);
  const [mapFeatures, setMapFeatures] = useState<MapFeature[]>([]);
  const [searchDept, setSearchDept] = useState("D");
  const [searchNum, setSearchNum] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<GeoJSON.FeatureCollection | null>(null);
  const [adding, setAdding] = useState(false);
  const [drawMode, setDrawMode] = useState<string | null>(null); // null or feature type
  const [drawName, setDrawName] = useState("");
  const [saving, setSaving] = useState(false);
  const [showSubdivide, setShowSubdivide] = useState<string | null>(null); // padron id
  const [subName, setSubName] = useState("");
  const [subHa, setSubHa] = useState("");

  // ── Init map ──
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [-33.0, -56.0],
      zoom: 7,
      zoomControl: false,
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    // Satellite layer
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      attribution: "ESRI",
      maxZoom: 19,
    }).addTo(map);

    // Labels overlay
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

    // Clear existing
    padronLayersRef.current.forEach((layer) => map.removeLayer(layer));
    padronLayersRef.current.clear();

    padrones.forEach((p, i) => {
      const color = PADRON_COLORS[i % PADRON_COLORS.length];
      const layer = L.geoJSON(p.geometry as GeoJSON.GeoJsonObject, {
        style: {
          color,
          weight: 3,
          fillColor: color,
          fillOpacity: 0.15,
        },
      });

      // Label
      const center = layer.getBounds().getCenter();
      const sectionNames = p.sections?.map((s) => s.name).join(", ") || p.padron_code;
      const label = L.marker(center, {
        icon: L.divIcon({
          className: "padron-label",
          html: `<div style="background:${color}22;border:1px solid ${color};border-radius:6px;padding:2px 8px;font-size:11px;color:white;white-space:nowrap;font-weight:600;text-shadow:0 1px 2px rgba(0,0,0,0.8)">${sectionNames}</div>`,
          iconAnchor: [0, 0],
        }),
      });

      layer.addTo(map);
      label.addTo(map);
      padronLayersRef.current.set(p.id, layer);
    });

    // Fit bounds to all padrones
    if (padrones.length > 0) {
      const allBounds = L.featureGroup(
        Array.from(padronLayersRef.current.values())
      ).getBounds();
      if (allBounds.isValid()) {
        map.fitBounds(allBounds, { padding: [40, 40], maxZoom: 15 });
      }
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
          color,
          weight: f.type === "road" ? 4 : 2.5,
          dashArray: dash || undefined,
          opacity: 0.9,
        });

        if (f.name) {
          line.bindTooltip(f.name, {
            permanent: false,
            direction: "center",
            className: "feature-tooltip",
          });
        }

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

  // ── Drawing mode handler ──
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!drawMode) {
      map.off("click");
      if (drawPreviewRef.current) {
        map.removeLayer(drawPreviewRef.current);
        drawPreviewRef.current = null;
      }
      drawPointsRef.current = [];
      return;
    }

    const featureType = FEATURE_TYPES.find((t) => t.value === drawMode);
    const color = featureType?.color || "#ffffff";
    const isPointType = drawMode === "aguada" || drawMode === "portera";

    function onClick(e: L.LeafletMouseEvent) {
      if (isPointType) {
        // Single click places a point
        drawPointsRef.current = [e.latlng];
        return;
      }

      drawPointsRef.current.push(e.latlng);

      if (drawPreviewRef.current) map!.removeLayer(drawPreviewRef.current);
      drawPreviewRef.current = L.polyline(drawPointsRef.current, {
        color,
        weight: 3,
        dashArray: "6 4",
        opacity: 0.8,
      }).addTo(map!);
    }

    map.on("click", onClick);

    return () => { map.off("click", onClick); };
  }, [drawMode]);

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

        // Show on map
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

  // ── Add padron ──
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
        // Clear search
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

  // ── Delete padron ──
  async function deletePadron(id: string) {
    await fetch("/api/padrones", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await loadPadrones();
  }

  // ── Add sub-section ──
  async function addSubsection(padronId: string) {
    if (!subName.trim()) return;
    setSaving(true);
    await fetch("/api/padrones", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        padronId,
        name: subName,
        sizeHectares: subHa ? Number(subHa) : null,
      }),
    });
    setShowSubdivide(null);
    setSubName("");
    setSubHa("");
    setSaving(false);
    await loadPadrones();
  }

  // ── Save drawn feature ──
  async function saveDrawnFeature() {
    const points = drawPointsRef.current;
    if (points.length === 0) return;
    setSaving(true);

    const isPointType = drawMode === "aguada" || drawMode === "portera";
    const geometry: GeoJSON.Geometry = isPointType
      ? { type: "Point", coordinates: [points[0].lng, points[0].lat] }
      : { type: "LineString", coordinates: points.map((p) => [p.lng, p.lat]) };

    try {
      await fetch("/api/map-features", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: drawMode, name: drawName || null, geometry }),
      });

      // Cleanup
      if (mapRef.current && drawPreviewRef.current) {
        mapRef.current.removeLayer(drawPreviewRef.current);
        drawPreviewRef.current = null;
      }
      drawPointsRef.current = [];
      setDrawMode(null);
      setDrawName("");
      await loadFeatures();
    } catch { /* ignore */ }
    setSaving(false);
  }

  // ── Delete map feature ──
  async function deleteFeature(id: string) {
    await fetch("/api/map-features", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await loadFeatures();
  }

  function cancelDraw() {
    if (mapRef.current && drawPreviewRef.current) {
      mapRef.current.removeLayer(drawPreviewRef.current);
      drawPreviewRef.current = null;
    }
    drawPointsRef.current = [];
    setDrawMode(null);
    setDrawName("");
  }

  function focusPadron(p: Padron) {
    const layer = padronLayersRef.current.get(p.id);
    if (layer && mapRef.current) {
      mapRef.current.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 16 });
    }
  }

  return (
    <div className="space-y-4">
      {/* Search bar */}
      <div className="card p-4">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Buscar Padron</h3>
        <div className="flex flex-col sm:flex-row gap-2">
          <select value={searchDept} onChange={(e) => setSearchDept(e.target.value)}
            className="input-field sm:w-48">
            {DEPARTMENTS.map(([code, name]) => (
              <option key={code} value={code}>{code} — {name}</option>
            ))}
          </select>
          <input type="number" value={searchNum} onChange={(e) => setSearchNum(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && searchPadron()}
            placeholder="Nro de padron (ej: 995)"
            className="input-field flex-1" />
          <button onClick={searchPadron} disabled={!searchNum.trim() || searching}
            className="btn-primary text-sm whitespace-nowrap">
            {searching ? "Buscando..." : "Buscar"}
          </button>
        </div>

        {/* Search result */}
        {searchResult && searchResult.features.length === 0 && (
          <p className="text-sm text-red-400 mt-2">No se encontro padron {searchDept}-{searchNum}</p>
        )}
        {searchResult && searchResult.features.length > 0 && (
          <div className="mt-3 flex items-center justify-between bg-zinc-800/60 rounded-lg p-3">
            <div>
              <span className="text-sm font-medium text-emerald-400">{searchDept}-{searchNum}</span>
              <span className="text-xs text-zinc-500 ml-2">
                {searchResult.features[0].properties?.nomDepto}
                {searchResult.features[0].properties?.["SHAPE.STArea()"] &&
                  ` · ${Math.round(searchResult.features[0].properties["SHAPE.STArea()"] / 10000 * 10) / 10} ha`}
              </span>
            </div>
            <button onClick={addPadron} disabled={adding} className="btn-primary text-xs">
              {adding ? "Agregando..." : "+ Agregar al campo"}
            </button>
          </div>
        )}
      </div>

      {/* Map */}
      <div className="card overflow-hidden relative">
        <div ref={mapContainerRef} style={{ height: "min(500px, 55vh)" }} className="w-full" />

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
                {(drawMode === "aguada" || drawMode === "portera")
                  ? "Hacé click en el mapa para colocar"
                  : "Hacé click en el mapa para dibujar puntos"}
              </span>
            </div>
            <div className="flex gap-2">
              <input type="text" value={drawName} onChange={(e) => setDrawName(e.target.value)}
                placeholder="Nombre (opcional)"
                className="input-field text-sm flex-1" />
              <button onClick={saveDrawnFeature} disabled={drawPointsRef.current.length === 0 || saving}
                className="btn-primary text-xs">
                {saving ? "..." : "Guardar"}
              </button>
              <button onClick={cancelDraw} className="btn-ghost text-xs">Cancelar</button>
            </div>
          </div>
        )}
      </div>

      {/* Draw tools */}
      <div className="card p-4">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">Dibujar en el mapa</h3>
        <div className="flex flex-wrap gap-2">
          {FEATURE_TYPES.map((ft) => (
            <button key={ft.value}
              onClick={() => { setDrawMode(drawMode === ft.value ? null : ft.value); drawPointsRef.current = []; }}
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
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Padrones ({padrones.length})
          </h3>
          {padrones.length === 0 ? (
            <p className="text-sm text-zinc-600 py-4 text-center">Busca y agrega padrones para verlos en el mapa</p>
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
                      <button onClick={() => { setShowSubdivide(showSubdivide === p.id ? null : p.id); setSubName(`${p.padron_code} `); }}
                        className="text-xs text-zinc-500 hover:text-emerald-400 transition-colors">
                        Dividir
                      </button>
                      <button onClick={() => deletePadron(p.id)}
                        className="text-xs text-zinc-600 hover:text-red-400 transition-colors">
                        Quitar
                      </button>
                    </div>
                  </div>

                  {/* Sections linked to this padron */}
                  {p.sections && p.sections.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 ml-5">
                      {p.sections.map((s) => (
                        <span key={s.id} className="tag text-xs" style={{ borderColor: s.color + "50" }}>
                          {s.name}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Subdivide form */}
                  {showSubdivide === p.id && (
                    <div className="flex gap-2 mt-1 ml-5">
                      <input type="text" value={subName} onChange={(e) => setSubName(e.target.value)}
                        placeholder={`Ej: ${p.padron_code} Norte`}
                        className="input-field text-xs flex-1" />
                      <input type="number" value={subHa} onChange={(e) => setSubHa(e.target.value)}
                        placeholder="Ha" className="input-field text-xs w-20" />
                      <button onClick={() => addSubsection(p.id)} disabled={!subName.trim() || saving}
                        className="btn-primary text-xs">
                        {saving ? "..." : "Crear"}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Map features list */}
        <div className="card p-4">
          <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Infraestructura ({mapFeatures.length})
          </h3>
          {mapFeatures.length === 0 ? (
            <p className="text-sm text-zinc-600 py-4 text-center">Usa los botones de dibujo para agregar caminos, porteras, etc.</p>
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
