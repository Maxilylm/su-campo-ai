"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import L from "leaflet";
import { fetchWithTimeout } from "@/lib/fetch";
import { createIdempotencyKey, notifySectionsChanged, sendJsonResult } from "@/lib/mutate";
import { DEPARTMENTS, SEARCH_RESULT_COLOR } from "./constants";

interface PadronSearchOptions {
  mapRef: RefObject<L.Map | null>;
  readOnly: boolean;
  /** Pending searches are abandoned when connectivity or the user changes. */
  offlineReadOnly: boolean;
  userId: string | null;
  clearActionError: () => void;
  setActionError: (message: string) => void;
  setPadronMigrationRequired: (required: boolean) => void;
}

/** SNIG padrón lookup (with its dashed preview on the map) and "agregar al campo". */
export function usePadronSearch({ mapRef, readOnly, offlineReadOnly, userId, clearActionError, setActionError, setPadronMigrationRequired }: PadronSearchOptions) {
  const [searchDept, setSearchDept] = useState("D");
  const [searchNum, setSearchNum] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResult, setSearchResult] = useState<GeoJSON.FeatureCollection | null>(null);
  const [adding, setAdding] = useState(false);
  const searchLayerRef = useRef<L.GeoJSON | null>(null);
  const padronAttempt = useRef<{ key: string; signature: string } | null>(null);
  const searchRequestId = useRef(0);
  const searchRequestRef = useRef<AbortController | null>(null);

  useEffect(() => () => {
    searchRequestId.current += 1;
    searchRequestRef.current?.abort();
  }, [offlineReadOnly, userId]);

  async function searchPadron() {
    if (readOnly || !searchNum.trim()) return;
    const currentRequest = ++searchRequestId.current;
    searchRequestRef.current?.abort();
    const controller = new AbortController();
    searchRequestRef.current = controller;
    setSearching(true);
    clearActionError();
    setSearchResult(null);

    try {
      const code = `${searchDept}-${searchNum.trim()}`;
      const res = await fetchWithTimeout(`/api/padrones/search?code=${encodeURIComponent(code)}`, { cache: "no-store", signal: controller.signal }, 15000);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "No se pudo consultar SNIG");
      if (controller.signal.aborted || currentRequest !== searchRequestId.current) return;

      if (data.features && data.features.length > 0) {
        setSearchResult(data);
        const map = mapRef.current;
        if (map) {
          if (searchLayerRef.current) map.removeLayer(searchLayerRef.current);
          searchLayerRef.current = L.geoJSON(data, {
            style: { color: SEARCH_RESULT_COLOR, weight: 3, fillColor: SEARCH_RESULT_COLOR, fillOpacity: 0.2, dashArray: "6 4" },
          }).addTo(map);
          map.fitBounds(searchLayerRef.current.getBounds(), { padding: [60, 60], maxZoom: 16 });
        }
      } else {
        setSearchResult({ type: "FeatureCollection", features: [] });
      }
    } catch (error) {
      if (controller.signal.aborted || currentRequest !== searchRequestId.current) return;
      setActionError(error instanceof Error && error.name === "AbortError"
        ? "La consulta al SNIG tardó demasiado. Intentá nuevamente."
        : error instanceof Error ? error.message : "No se pudo consultar el padrón.");
      setSearchResult({ type: "FeatureCollection", features: [] });
    } finally {
      if (currentRequest === searchRequestId.current) {
        setSearching(false);
        if (searchRequestRef.current === controller) searchRequestRef.current = null;
      }
    }
  }

  async function addPadron() {
    if (readOnly || !searchResult || searchResult.features.length === 0) return;
    setAdding(true);
    clearActionError();
    const feature = searchResult.features[0];
    const props = feature.properties || {};
    const code = `${searchDept}-${searchNum.trim()}`;
    const payload = {
      padronCode: code,
      padronNumber: parseInt(searchNum),
      departmentCode: searchDept,
      departmentName: props.nomDepto || DEPARTMENTS.find(([c]) => c === searchDept)?.[1] || "",
      areaM2: props["SHAPE.STArea()"] || null,
      geometry: feature.geometry,
    };
    const signature = JSON.stringify(payload);
    if (!padronAttempt.current || padronAttempt.current.signature !== signature) {
      padronAttempt.current = { key: createIdempotencyKey(), signature };
    }

    const result = await sendJsonResult("/api/padrones", "POST", payload, { idempotencyKey: padronAttempt.current.key });
    if (!result.ok) {
      setActionError(result.error || "No se pudo agregar el padrón.");
      setPadronMigrationRequired(result.code === "padron_idempotency_migration_required");
      setAdding(false);
      return;
    }
    padronAttempt.current = null;
    setPadronMigrationRequired(false);
    if (mapRef.current && searchLayerRef.current) {
      mapRef.current.removeLayer(searchLayerRef.current);
      searchLayerRef.current = null;
    }
    setSearchResult(null);
    setSearchNum("");
    notifySectionsChanged();
    setAdding(false);
  }

  return { searchDept, setSearchDept, searchNum, setSearchNum, searching, searchResult, adding, searchPadron, addPadron };
}
