"use client";

import { useEffect, type RefObject } from "react";
import L from "leaflet";
import type { FieldGraph } from "@/lib/field-graph";
import { buildLinderosLayer, buildRouteLayer } from "./layers";

/** Draws the linderos network (when toggled on) and the route of a move
 * being planned (whenever there is one), each as its own Leaflet layer. */
export function useLinderosLayer(
  mapRef: RefObject<L.Map | null>,
  mapReady: boolean,
  graph: FieldGraph | null,
  showLinderos: boolean,
  routePath: string[] | null,
) {
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !graph || !showLinderos || graph.edges.length === 0) return;
    const layer = buildLinderosLayer(graph).addTo(map);
    return () => { map.removeLayer(layer); };
  }, [graph, mapReady, mapRef, showLinderos]);

  const routeKey = routePath?.join(">") ?? "";
  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !graph || !routeKey) return;
    const layer = buildRouteLayer(graph, routeKey.split(">"));
    if (!layer) return;
    layer.addTo(map);
    return () => { map.removeLayer(layer); };
  }, [graph, mapReady, mapRef, routeKey]);
}
