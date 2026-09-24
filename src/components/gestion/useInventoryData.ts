"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { fetchWithTimeout } from "@/lib/fetch";
import { isOfflineSnapshotFresh, offlineEntitySnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import type { InventoryCattleOption, InventoryCropOption, InventoryItem, InventoryMovement } from "./inventory-types";

function readEntitySnapshot(userId: string | null | undefined) {
  try {
    return userId ? parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId))) : null;
  } catch {
    return null;
  }
}

/** Items, movements and the crop/cattle lookups for Inventario — online from
 * the API, offline from the synced entity snapshot. */
export function useInventoryData({ farmId, userId, offlineReadOnly }: {
  farmId: string | undefined;
  userId: string | null;
  offlineReadOnly: boolean;
}) {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemsTruncated, setItemsTruncated] = useState(false);
  const [crops, setCrops] = useState<InventoryCropOption[]>([]);
  const [cattle, setCattle] = useState<InventoryCattleOption[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [movementsTruncated, setMovementsTruncated] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [movementLoadError, setMovementLoadError] = useState(false);
  const [movementsLoaded, setMovementsLoaded] = useState(false);
  const [offlineInventorySavedAt, setOfflineInventorySavedAt] = useState<string | null>(null);
  const itemsRequestRef = useRef<AbortController | null>(null);
  const cropsRequestRef = useRef<AbortController | null>(null);
  const cattleRequestRef = useRef<AbortController | null>(null);
  const movementsRequestRef = useRef<AbortController | null>(null);

  const loadItems = useCallback(async () => {
    itemsRequestRef.current?.abort();
    if (offlineReadOnly) {
      const snapshot = readEntitySnapshot(userId);
      if (snapshot && isOfflineSnapshotFresh(snapshot.savedAt)) {
        setItems(snapshot.inventory as InventoryItem[]);
        setOfflineInventorySavedAt(snapshot.savedAt);
        setLoadError(false);
      } else {
        setItems([]);
        setOfflineInventorySavedAt(null);
        setLoadError(true);
      }
      setItemsTruncated(snapshot?.inventoryTruncated === true);
      setLoaded(true);
      return;
    }
    const controller = new AbortController();
    itemsRequestRef.current = controller;
    setOfflineInventorySavedAt(null);
    setLoadError(false);
    setItemsTruncated(false);
    try {
      const res = await fetchWithTimeout("/api/inventory", { cache: "no-store", signal: controller.signal }, 8000);
      if (!res.ok) throw new Error("inventory request failed");
      const nextItems = await res.json();
      if (controller.signal.aborted || itemsRequestRef.current !== controller) return;
      setItemsTruncated(res.headers.get("X-CampoAI-Inventory-Truncated") === "true");
      setItems(Array.isArray(nextItems) ? nextItems : []);
    } catch (e) {
      if (controller.signal.aborted || (e instanceof Error && e.name === "AbortError")) return;
      console.error("Load inventory error:", e);
      setLoadError(true);
    } finally {
      if (itemsRequestRef.current === controller) {
        itemsRequestRef.current = null;
        setLoaded(true);
      }
    }
  }, [offlineReadOnly, userId]);

  useEffect(() => {
    void loadItems();
    return () => itemsRequestRef.current?.abort();
  }, [loadItems]);

  const loadCrops = useCallback(async () => {
    cropsRequestRef.current?.abort();
    if (!farmId) {
      setCrops([]);
      return;
    }
    if (offlineReadOnly) {
      const snapshot = readEntitySnapshot(userId);
      setCrops(snapshot && isOfflineSnapshotFresh(snapshot.savedAt) ? snapshot.crops as InventoryCropOption[] : []);
      return;
    }
    const controller = new AbortController();
    cropsRequestRef.current = controller;
    setCrops([]);
    try {
      const res = await fetchWithTimeout("/api/crops", { cache: "no-store", signal: controller.signal }, 8000);
      if (!res.ok) return;
      const data = await res.json();
      if (controller.signal.aborted || cropsRequestRef.current !== controller) return;
      setCrops(Array.isArray(data) ? data : []);
    } catch {
      // Crop linkage is optional; inventory remains usable if this lookup fails.
    } finally {
      if (cropsRequestRef.current === controller) cropsRequestRef.current = null;
    }
  }, [farmId, offlineReadOnly, userId]);

  useEffect(() => {
    void loadCrops();
    return () => cropsRequestRef.current?.abort();
  }, [loadCrops]);

  const loadCattle = useCallback(async () => {
    cattleRequestRef.current?.abort();
    if (!farmId) {
      setCattle([]);
      return;
    }
    if (offlineReadOnly) {
      const snapshot = readEntitySnapshot(userId);
      setCattle(snapshot && isOfflineSnapshotFresh(snapshot.savedAt) ? snapshot.cattle as InventoryCattleOption[] : []);
      return;
    }
    const controller = new AbortController();
    cattleRequestRef.current = controller;
    setCattle([]);
    try {
      const res = await fetchWithTimeout("/api/cattle", { cache: "no-store", signal: controller.signal }, 8000);
      if (!res.ok) return;
      const data = await res.json();
      if (controller.signal.aborted || cattleRequestRef.current !== controller) return;
      setCattle(Array.isArray(data) ? data : []);
    } catch {
      // Cattle linkage is optional; inventory remains usable if this lookup fails.
    } finally {
      if (cattleRequestRef.current === controller) cattleRequestRef.current = null;
    }
  }, [farmId, offlineReadOnly, userId]);

  useEffect(() => {
    void loadCattle();
    return () => cattleRequestRef.current?.abort();
  }, [loadCattle]);

  const loadMovements = useCallback(async () => {
    movementsRequestRef.current?.abort();
    if (offlineReadOnly) {
      const snapshot = readEntitySnapshot(userId);
      if (snapshot && isOfflineSnapshotFresh(snapshot.savedAt) && Array.isArray(snapshot.inventoryMovements)) {
        setMovements(snapshot.inventoryMovements as InventoryMovement[]);
        setMovementsTruncated(snapshot.inventoryMovementsTruncated === true);
        setMovementLoadError(false);
      } else {
        setMovements([]);
        setMovementsTruncated(false);
        setMovementLoadError(true);
      }
      setMovementsLoaded(true);
      return;
    }
    const controller = new AbortController();
    movementsRequestRef.current = controller;
    setMovementLoadError(false);
    setMovementsTruncated(false);
    try {
      const res = await fetchWithTimeout("/api/inventory/movements", { cache: "no-store", signal: controller.signal }, 8000);
      if (!res.ok) throw new Error("inventory movements request failed");
      const data = await res.json();
      if (controller.signal.aborted || movementsRequestRef.current !== controller) return;
      setMovementsTruncated(res.headers.get("X-CampoAI-Movements-Truncated") === "true");
      setMovements(Array.isArray(data) ? data : []);
    } catch (error) {
      if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) return;
      setMovementLoadError(true);
    } finally {
      if (movementsRequestRef.current === controller) {
        movementsRequestRef.current = null;
        setMovementsLoaded(true);
      }
    }
  }, [offlineReadOnly, userId]);

  const refreshInventoryData = useCallback(async () => {
    await Promise.all([loadItems(), loadMovements(), loadCrops(), loadCattle()]);
  }, [loadCattle, loadCrops, loadItems, loadMovements]);

  useEffect(() => {
    void loadMovements();
    return () => movementsRequestRef.current?.abort();
  }, [loadMovements]);
  useDataChangedRefresh(refreshInventoryData, !offlineReadOnly);
  useOfflineSnapshotRefresh(refreshInventoryData, userId, offlineReadOnly);

  return {
    items, itemsTruncated, crops, cattle, movements, movementsTruncated,
    loaded, loadError, movementLoadError, movementsLoaded, offlineInventorySavedAt,
    loadItems, loadMovements, refreshInventoryData,
  };
}
