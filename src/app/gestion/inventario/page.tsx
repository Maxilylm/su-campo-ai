"use client";

import { Suspense, useState, useEffect, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { StatCard } from "@/components/StatCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Sheet, SheetContent, SheetDescription, SheetFooter,
  SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { InventoryImportDialog } from "@/components/InventoryImportDialog";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { fetchWithTimeout } from "@/lib/fetch";
import { filterCropsForSection } from "@/lib/inventory-navigation";
import { signedInventoryQuantity, type InventoryMovementType } from "@/lib/inventory-movement";
import { dateInputValue } from "@/lib/date";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { isOfflineSnapshotFresh, offlineEntitySnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";
import Link from "next/link";
import {
  AlertTriangle, Drumstick, Sprout, FlaskConical, Pill, Fuel, Package,
  Plus, ShoppingCart, ArrowUpFromLine, MoreHorizontal, Trash2, Pencil, Boxes,
  Layers, DollarSign, Printer, SlidersHorizontal, TriangleAlert, type LucideIcon,
} from "lucide-react";

// ─── Types ──────────────────────────────────

interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  current_stock: number;
  min_stock: number | null;
  cost_per_unit: number | null;
  currency?: string | null;
  notes: string | null;
}

interface CropOption {
  id: string;
  crop_type: string;
  section_id: string | null;
}

interface CattleOption {
  id: string;
  category: string;
  breed: string | null;
  count: number;
  section_id: string | null;
}

interface InventoryMovement {
  id: string;
  item_id: string;
  type: "compra" | "uso" | "ajuste" | "pérdida";
  quantity: number;
  date: string;
  section_id: string | null;
  crop_id: string | null;
  cattle_id: string | null;
  notes: string | null;
  inventory_items: { name: string; unit: string } | null;
  sections: { name: string } | null;
  crops: { crop_type: string } | null;
  cattle: { category: string; breed: string | null; count: number } | null;
}

// ─── Constants ──────────────────────────────

const CATEGORY_ICON: Record<string, LucideIcon> = {
  alimento: Drumstick,
  semilla: Sprout,
  fertilizante: FlaskConical,
  "agroquímico": FlaskConical,
  medicamento: Pill,
  combustible: Fuel,
  otro: Package,
};

const CATEGORIES = [
  { value: "alimento", label: "Alimento", icon: Drumstick },
  { value: "semilla", label: "Semilla", icon: Sprout },
  { value: "fertilizante", label: "Fertilizante", icon: FlaskConical },
  { value: "agroquímico", label: "Agroquimico", icon: FlaskConical },
  { value: "medicamento", label: "Medicamento", icon: Pill },
  { value: "combustible", label: "Combustible", icon: Fuel },
  { value: "otro", label: "Otro", icon: Package },
];

const UNITS = ["kg", "L", "dosis", "unidad"];
const CURRENCIES = ["USD", "UYU", "ARS"];

const MOVEMENT_LABELS: Record<InventoryMovement["type"], string> = {
  compra: "Compra",
  uso: "Uso",
  ajuste: "Ajuste",
  "pérdida": "Pérdida",
};

// ─── Status helpers ─────────────────────────

function getStockStatus(item: InventoryItem): "bajo" | "justo" | "ok" {
  if (!item.min_stock) return "ok";
  if (item.current_stock < item.min_stock) return "bajo";
  if (item.current_stock < 2 * item.min_stock) return "justo";
  return "ok";
}

function statusBadge(status: "bajo" | "justo" | "ok") {
  if (status === "bajo") return <Badge variant="outline" className="text-red-600 dark:text-red-400 border-red-500/30">Bajo</Badge>;
  if (status === "justo") return <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-500/30">Justo</Badge>;
  return <Badge variant="outline" className="text-emerald-600 dark:text-emerald-400 border-emerald-500/30">OK</Badge>;
}

function stockColor(status: "bajo" | "justo" | "ok") {
  if (status === "bajo") return "text-red-600 dark:text-red-400";
  if (status === "justo") return "text-amber-600 dark:text-amber-400";
  return "text-emerald-600 dark:text-emerald-400";
}

// ─── Page Component ─────────────────────────

function InventarioPageContent() {
  const { sections, userId, readOnly } = useFarm();
  const router = useRouter();
  const searchParams = useSearchParams();
  const navigationQuery = searchParams.toString();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [itemsTruncated, setItemsTruncated] = useState(false);
  const [crops, setCrops] = useState<CropOption[]>([]);
  const [cattle, setCattle] = useState<CattleOption[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [movementsTruncated, setMovementsTruncated] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [movementLoadError, setMovementLoadError] = useState(false);
  const [movementsLoaded, setMovementsLoaded] = useState(false);
  const [offlineInventorySavedAt, setOfflineInventorySavedAt] = useState<string | null>(null);
  const [filterCat, setFilterCat] = useState("todos");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<"add-item" | "edit-item" | "compra" | "uso" | "ajuste" | "pérdida">("add-item");
  const [saving, setSaving] = useState(false);
  const handledNavigationQueryRef = useRef<string | null>(null);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [focusedMovementId, setFocusedMovementId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);

  // New item form state
  const [itemName, setItemName] = useState("");
  const [itemCategory, setItemCategory] = useState("alimento");
  const [itemUnit, setItemUnit] = useState("kg");
  const [itemCurrency, setItemCurrency] = useState("USD");
  const [itemMinStock, setItemMinStock] = useState("");
  const [itemNotes, setItemNotes] = useState("");

  // Movement form state
  const [movItemId, setMovItemId] = useState("");
  const [movQuantity, setMovQuantity] = useState("");
  const [movUnitCost, setMovUnitCost] = useState("");
  const [movCurrency, setMovCurrency] = useState("USD");
  const [movSectionId, setMovSectionId] = useState("");
  const [movCropId, setMovCropId] = useState("");
  const [movCattleId, setMovCattleId] = useState("");
  const [movDate, setMovDate] = useState("");
  const [movNotes, setMovNotes] = useState("");
  const itemAttempt = useRef<{ key: string; signature: string } | null>(null);
  const movementAttempt = useRef<{ key: string; signature: string } | null>(null);
  const itemsRequestRef = useRef<AbortController | null>(null);
  const movementsRequestRef = useRef<AbortController | null>(null);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const ROWS_PER_PAGE = 20;

  const loadItems = useCallback(async () => {
    itemsRequestRef.current?.abort();
    if (readOnly) {
      let snapshot = null;
      try {
        snapshot = userId
          ? parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)))
          : null;
      } catch {
        snapshot = null;
      }
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
  }, [readOnly, userId]);

  useEffect(() => {
    void loadItems();
    return () => itemsRequestRef.current?.abort();
  }, [loadItems]);

  const loadCrops = useCallback(async () => {
    try {
      const res = await fetchWithTimeout("/api/crops", {}, 8000);
      if (!res.ok) return;
      const data = await res.json();
      setCrops(Array.isArray(data) ? data : []);
    } catch {
      // Crop linkage is optional; inventory remains usable if this lookup fails.
    }
  }, []);

  useEffect(() => { void loadCrops(); }, [loadCrops]);

  const loadCattle = useCallback(async () => {
    try {
      const res = await fetchWithTimeout("/api/cattle", {}, 8000);
      if (!res.ok) return;
      const data = await res.json();
      setCattle(Array.isArray(data) ? data : []);
    } catch {
      // Cattle linkage is optional; inventory remains usable if this lookup fails.
    }
  }, []);

  useEffect(() => { void loadCattle(); }, [loadCattle]);

  const loadMovements = useCallback(async () => {
    movementsRequestRef.current?.abort();
    if (readOnly) {
      let snapshot = null;
      try {
        snapshot = userId
          ? parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)))
          : null;
      } catch {
        snapshot = null;
      }
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
  }, [readOnly, userId]);

  const refreshInventoryData = useCallback(async () => {
    await Promise.all([loadItems(), loadMovements(), loadCrops(), loadCattle()]);
  }, [loadCattle, loadCrops, loadItems, loadMovements]);

  useEffect(() => {
    void loadMovements();
    return () => movementsRequestRef.current?.abort();
  }, [loadMovements]);
  useDataChangedRefresh(refreshInventoryData, !readOnly);
  useOfflineSnapshotRefresh(refreshInventoryData, userId, readOnly);

  useEffect(() => {
    if (!loaded || !movementsLoaded || handledNavigationQueryRef.current === navigationQuery) return;
    const params = new URLSearchParams(navigationQuery);
    const itemId = params.get("itemId");
    const movementId = params.get("movementId");
    const useCropId = params.get("cropId");
    const useCattleId = params.get("cattleId");
    const suggestedItem = params.get("itemName")
      ? items.find((candidate) => candidate.name.trim().toLocaleLowerCase() === params.get("itemName")?.trim().toLocaleLowerCase())
      : null;
    if (params.get("use") === "1") {
      setMovItemId(itemId || suggestedItem?.id || "");
      setMovQuantity("");
      setMovUnitCost("");
      setMovCurrency("USD");
      setMovSectionId(params.get("sectionId") || "");
      setMovCropId(useCropId || "");
      setMovCattleId(useCattleId || "");
      setMovDate(params.get("date") || dateInputValue());
      setMovNotes(params.get("notes") || "");
      setSheetMode("uso");
      setSheetOpen(true);
    }
    if (itemId && params.get("use") !== "1") {
      const itemIndex = items.findIndex((candidate) => candidate.id === itemId);
      const item = itemIndex >= 0 ? items[itemIndex] : null;
      if (item) {
        if (params.get("buy") === "1") {
          setMovItemId(item.id);
          setMovQuantity("");
          setMovUnitCost("");
          setMovCurrency(item.currency || "USD");
          setMovSectionId("");
          setMovCropId("");
          setMovDate(params.get("date") || dateInputValue());
          setMovNotes("");
          setSheetMode("compra");
          setSheetOpen(true);
        } else {
          setFilterCat("todos");
          setCurrentPage(Math.floor(itemIndex / ROWS_PER_PAGE) + 1);
          setFocusedItemId(item.id);
        }
      }
    }
    if (movementId && movements.some((movement) => movement.id === movementId)) {
      setFocusedMovementId(movementId);
    }
    handledNavigationQueryRef.current = navigationQuery;
    if (navigationQuery) router.replace(window.location.pathname, { scroll: false });
  }, [items, loaded, movements, movementsLoaded, navigationQuery, router]);

  function resetItemForm() {
    itemAttempt.current = null;
    setItemName(""); setItemCategory("alimento"); setItemUnit("kg"); setItemCurrency("USD");
    setItemMinStock(""); setItemNotes("");
    setEditId(null);
  }

  function resetMovForm() {
    movementAttempt.current = null;
    setMovItemId(""); setMovQuantity(""); setMovUnitCost(""); setMovCurrency("USD");
    setMovSectionId(""); setMovCropId(""); setMovDate(dateInputValue()); setMovNotes("");
    setMovCattleId("");
  }

  function openAddItem() { resetItemForm(); setSheetMode("add-item"); setSheetOpen(true); }
  function openEditItem(item: InventoryItem) {
    setEditId(item.id);
    setItemName(item.name);
    setItemCategory(item.category);
    setItemUnit(item.unit);
    setItemCurrency(item.currency || "USD");
    setItemMinStock(item.min_stock == null ? "" : String(item.min_stock));
    setItemNotes(item.notes || "");
    setSheetMode("edit-item");
    setSheetOpen(true);
  }
  function openCompra() { resetMovForm(); setSheetMode("compra"); setSheetOpen(true); }
  function openUso() { resetMovForm(); setSheetMode("uso"); setSheetOpen(true); }

  function selectMovementCrop(id: string) {
    setMovCropId(id);
    if (!id) return;
    const crop = crops.find((candidate) => candidate.id === id);
    if (crop?.section_id && crop.section_id !== movSectionId) {
      setMovSectionId(crop.section_id);
      const cattleRelation = cattle.find((candidate) => candidate.id === movCattleId);
      if (cattleRelation?.section_id && cattleRelation.section_id !== crop.section_id) setMovCattleId("");
    }
  }

  function selectMovementSection(id: string) {
    const nextSectionId = id === "none" ? "" : id;
    setMovSectionId(nextSectionId);
    const crop = crops.find((candidate) => candidate.id === movCropId);
    const cattleRelation = cattle.find((candidate) => candidate.id === movCattleId);
    if (nextSectionId && crop?.section_id && crop.section_id !== nextSectionId) setMovCropId("");
    if (nextSectionId && cattleRelation?.section_id && cattleRelation.section_id !== nextSectionId) setMovCattleId("");
  }

  function selectMovementCattle(id: string) {
    const nextCattleId = id === "none" ? "" : id;
    setMovCattleId(nextCattleId);
    const cattleRelation = cattle.find((candidate) => candidate.id === nextCattleId);
    if (!cattleRelation?.section_id || cattleRelation.section_id === movSectionId) return;
    setMovSectionId(cattleRelation.section_id);
    const crop = crops.find((candidate) => candidate.id === movCropId);
    if (crop?.section_id && crop.section_id !== cattleRelation.section_id) setMovCropId("");
  }

  async function saveItem() {
    if (readOnly || !itemName.trim()) return;
    setSaving(true);
    const editing = sheetMode === "edit-item" && editId;
    const payload = {
      ...(editing ? { id: editId } : {}),
      name: itemName,
      category: itemCategory,
      unit: itemUnit,
      currency: itemCurrency,
      minStock: itemMinStock ? Number(itemMinStock) : null,
      notes: itemNotes || null,
    };
    const creating = !editing;
    const signature = JSON.stringify(payload);
    if (creating && (!itemAttempt.current || itemAttempt.current.signature !== signature)) {
      itemAttempt.current = { key: createIdempotencyKey(), signature };
    }
    const result = await sendJsonResult("/api/inventory", editing ? "PUT" : "POST", payload, creating && itemAttempt.current
      ? { idempotencyKey: itemAttempt.current.key }
      : undefined);
    if (result.ok) {
      if (creating) itemAttempt.current = null;
      toast.success(editing ? "Item actualizado" : "Item creado");
      setSheetOpen(false);
      resetItemForm();
      await loadItems();
    } else {
      toast.error(result.error || (editing ? "No se pudo actualizar el item" : "No se pudo crear el item"));
    }
    setSaving(false);
  }

  function selectMovementItem(id: string) {
    setMovItemId(id);
    const item = items.find((candidate) => candidate.id === id);
    if (item?.currency) setMovCurrency(item.currency);
  }

  async function saveMovement() {
    if (readOnly || !movItemId || !movQuantity) return;
    setSaving(true);
    const movementType = (sheetMode === "compra" ? "compra" : sheetMode) as InventoryMovementType;
    const qty = signedInventoryQuantity(movementType, Number(movQuantity));
    const signature = JSON.stringify({
      itemId: movItemId,
      type: movementType,
      quantity: qty,
      unitCost: sheetMode === "compra" && movUnitCost ? Number(movUnitCost) : null,
      currency: sheetMode === "compra" ? movCurrency : undefined,
      sectionId: sheetMode !== "compra" && movSectionId ? movSectionId : null,
      cropId: sheetMode !== "compra" && movCropId ? movCropId : null,
      cattleId: sheetMode !== "compra" && movCattleId ? movCattleId : null,
      date: movDate || null,
      notes: movNotes || null,
    });
    if (!movementAttempt.current || movementAttempt.current.signature !== signature) {
      movementAttempt.current = { key: createIdempotencyKey(), signature };
    }

    const result = await sendJsonResult("/api/inventory/movements", "POST", {
      itemId: movItemId,
      type: movementType,
      quantity: qty,
      unitCost: sheetMode === "compra" && movUnitCost ? Number(movUnitCost) : null,
      currency: sheetMode === "compra" ? movCurrency : undefined,
      sectionId: sheetMode !== "compra" && movSectionId ? movSectionId : null,
      cropId: sheetMode !== "compra" && movCropId ? movCropId : null,
      cattleId: sheetMode !== "compra" && movCattleId ? movCattleId : null,
      date: movDate || null,
      notes: movNotes || null,
    }, { idempotencyKey: movementAttempt.current.key });
    if (!result.ok) {
      if (result.code === "purchase_migration_required" || result.code === "purchase_transaction_unavailable" || result.code === "idempotency_migration_required") {
        toast.error(result.error || "La compra requiere revisar la configuración de Supabase.", {
          action: { label: "Abrir diagnóstico", onClick: () => router.push("/gestion/campo") },
        });
      } else {
        toast.error(result.error || "Error al registrar movimiento");
      }
    } else {
      movementAttempt.current = null;
      toast.success(`${MOVEMENT_LABELS[movementType as InventoryMovement["type"]]} registrado`);
      setSheetOpen(false);
      await Promise.all([loadItems(), loadMovements()]);
    }
    setSaving(false);
  }

  async function deleteItem(id: string) {
    if (readOnly) return;
    const result = await sendJsonResult("/api/inventory", "DELETE", { id });
    if (result.ok) { toast.success("Item eliminado"); await Promise.all([loadItems(), loadMovements()]); }
    else toast.error(result.error || "No se pudo eliminar el item");
  }

  // ─── Derived data ─────────────────────────

  const lowStockItems = items.filter((i) => i.min_stock && i.current_stock < i.min_stock);
  const filtered = filterCat === "todos" ? items : items.filter((i) => i.category === filterCat);
  const totalValueByCurrency = items.reduce<Record<string, number>>((totals, item) => {
    const currency = item.currency || "USD";
    totals[currency] = (totals[currency] || 0) + item.current_stock * (item.cost_per_unit || 0);
    return totals;
  }, {});
  const totalValueLabel = Object.entries(totalValueByCurrency)
    .map(([currency, value]) => `${currency} ${value.toLocaleString()}`)
    .join(" · ") || "—";

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const paginatedItems = filtered.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);
  const availableMovementCrops = filterCropsForSection(crops, movSectionId, movCropId);
  const availableMovementCattle = movSectionId
    ? cattle.filter((row) => !row.section_id || row.section_id === movSectionId || row.id === movCattleId)
    : cattle;

  // Reset page when filter changes
  useEffect(() => { setCurrentPage(1); }, [filterCat]);
  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!focusedItemId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`inventory-item-${focusedItemId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [currentPage, filterCat, focusedItemId, items.length]);

  useEffect(() => {
    if (!focusedMovementId) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(`inventory-movement-${focusedMovementId}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    const timer = window.setTimeout(() => setFocusedMovementId(null), 4000);
    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timer);
    };
  }, [focusedMovementId, movements.length]);

  if (!loaded) return <LoadingPage />;
  if (loadError) return <LoadErrorState title={readOnly ? "No hay una copia local de Inventario" : "No se pudo cargar Inventario"} description={readOnly ? "Sincronizá Inventario cuando recuperes la conexión para consultarlo sin conexión." : undefined} onRetry={loadItems} />;

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[{ label: "Gestion", href: "/gestion/inventario" }, { label: "Inventario" }]}
        title="Inventario"
        description="Control de stock, compras, usos y ajustes de insumos"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" asChild><Link href="/reportes"><Printer className="h-4 w-4 mr-1.5" />Reportes</Link></Button>
            <InventoryImportDialog readOnly={readOnly} onImported={refreshInventoryData} />
            <Button variant="outline" onClick={openAddItem} disabled={readOnly}><Plus className="h-4 w-4 mr-1.5" />Nuevo Item</Button>
            <Button variant="outline" onClick={openCompra} disabled={readOnly}><ShoppingCart className="h-4 w-4 mr-1.5" />Registrar Compra</Button>
            <Button onClick={openUso} disabled={readOnly}><ArrowUpFromLine className="h-4 w-4 mr-1.5" />Registrar Uso</Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" disabled={readOnly}><MoreHorizontal className="h-4 w-4 mr-1.5" />Otros movimientos</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => { resetMovForm(); setSheetMode("ajuste"); setSheetOpen(true); }}>
                  <SlidersHorizontal className="mr-2 h-4 w-4" />Ajustar stock
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => { resetMovForm(); setSheetMode("pérdida"); setSheetOpen(true); }}>
                  <TriangleAlert className="mr-2 h-4 w-4" />Registrar pérdida
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {offlineInventorySavedAt && <Alert role="status">
        <AlertTitle>Inventario en modo lectura</AlertTitle>
        <AlertDescription>Mostrando la copia sincronizada el {new Date(offlineInventorySavedAt).toLocaleString("es-UY")}. Las compras, usos y ajustes se habilitarán al recuperar la conexión.</AlertDescription>
      </Alert>}

      {/* Low stock alert */}
      {lowStockItems.length > 0 && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Stock bajo ({lowStockItems.length} items)</AlertTitle>
          <AlertDescription>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {lowStockItems.map((i) => {
                const Icon = CATEGORY_ICON[i.category] || Package;
                return (
                  <Badge key={i.id} variant="outline" className="text-red-600 dark:text-red-400 border-red-500/30">
                    <Icon className="h-3 w-3 mr-1" />
                    {i.name}: {i.current_stock} {i.unit} (min {i.min_stock})
                  </Badge>
                );
              })}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {itemsTruncated && (
        <Alert>
          <AlertDescription>
            Se muestran solo los primeros 1.000 insumos. Para consultar el inventario completo, descargá Inventario CSV: <a href="/api/export?format=csv&table=inventory_items" className="font-medium text-primary underline-offset-2 hover:underline">Descargar Inventario CSV</a>
          </AlertDescription>
        </Alert>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Items totales" value={items.length} accent="blue" icon={Boxes} />
        <StatCard label="Stock bajo" value={lowStockItems.length} accent="red" icon={AlertTriangle} />
        <StatCard label="Categorias" value={new Set(items.map((i) => i.category)).size} accent="purple" icon={Layers} />
        <StatCard label="Valor total" value={totalValueLabel} accent="emerald" icon={DollarSign} />
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant={filterCat === "todos" ? "secondary" : "outline"}
          size="sm"
          onClick={() => setFilterCat("todos")}
        >
          Todos
        </Button>
        {CATEGORIES.map((cat) => {
          const Icon = cat.icon;
          return (
            <Button
              key={cat.value}
              variant={filterCat === cat.value ? "secondary" : "outline"}
              size="sm"
              onClick={() => setFilterCat(cat.value)}
            >
              <Icon className="h-3.5 w-3.5 mr-1.5" />
              {cat.label}
            </Button>
          );
        })}
      </div>

      {/* Inventory table */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Inventario</h2>
          <span className="text-xs text-muted-foreground">{filtered.length} items</span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState icon={Package} title="Sin items en inventario" description="Agrega tu primer insumo para empezar." actionLabel="Nuevo item" onAction={openAddItem} />
        ) : (
          <>
            <div className="rounded-xl border border-border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Item</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead className="text-right">Minimo</TableHead>
                    <TableHead className="text-right">$/unidad</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedItems.map((item) => {
                    const status = getStockStatus(item);
                    const Icon = CATEGORY_ICON[item.category] || Package;
                    return (
                      <TableRow id={`inventory-item-${item.id}`} key={item.id} className={focusedItemId === item.id ? "bg-accent" : undefined}>
                        <TableCell>
                          <span className="flex items-center gap-2">
                            <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                            <span className="font-medium">{item.name}</span>
                            {item.notes && <span className="text-muted-foreground text-xs">({item.notes})</span>}
                          </span>
                        </TableCell>
                        <TableCell className={`text-right tabular-nums font-medium font-mono ${stockColor(status)}`}>
                          {item.current_stock} {item.unit}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {item.min_stock != null ? `${item.min_stock} ${item.unit}` : "—"}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-muted-foreground">
                          {item.cost_per_unit != null ? `${item.currency || "USD"} ${item.cost_per_unit}` : "—"}
                        </TableCell>
                        <TableCell>{statusBadge(status)}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" aria-label="Acciones" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuItem onClick={() => openEditItem(item)}>
                                <Pencil className="mr-2 h-4 w-4" />Editar
                              </DropdownMenuItem>
                              <ConfirmDialog
                                trigger={
                                  <DropdownMenuItem onSelect={(e) => e.preventDefault()} className="text-destructive">
                                    <Trash2 className="mr-2 h-4 w-4" />Eliminar
                                  </DropdownMenuItem>
                                }
                                title="Eliminar item"
                                description={`Esto eliminara "${item.name}" del inventario. Esta accion no se puede deshacer.`}
                                onConfirm={() => deleteItem(item.id)}
                              />
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {totalPages > 1 && (
              <div className="flex items-center justify-between mt-4 text-xs text-muted-foreground">
                <span>Pagina {currentPage} de {totalPages}</span>
                <div className="flex gap-1">
                  <Button variant="outline" size="sm" disabled={currentPage === 1} onClick={() => setCurrentPage((p) => p - 1)}>Anterior</Button>
                  <Button variant="outline" size="sm" disabled={currentPage === totalPages} onClick={() => setCurrentPage((p) => p + 1)}>Siguiente</Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <section aria-labelledby="inventory-movements-title">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 id="inventory-movements-title" className="text-lg font-medium">Movimientos recientes</h2>
            <p className="text-xs text-muted-foreground">Compras, usos, ajustes y pérdidas que explican el stock actual.</p>
          </div>
          <span className="text-xs text-muted-foreground">{movementsTruncated ? `${movements.length}+ registros visibles` : `${movements.length} registros`}</span>
        </div>
        {movementsTruncated && (
          <Alert className="mb-4">
            <AlertDescription>
              Se muestran solo los 100 movimientos más recientes. Para consultar el historial completo, descargá Movimientos CSV: <a href="/api/export?format=csv&table=inventory_movements" className="font-medium text-primary underline-offset-2 hover:underline">Descargar Movimientos CSV</a>
            </AlertDescription>
          </Alert>
        )}
        {movementLoadError ? (
          <div role={readOnly ? "status" : "alert"} className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/25 bg-card p-4 text-sm">
            <span className="text-muted-foreground">{readOnly ? "No hay una copia local del historial de movimientos. Sincronizá Inventario desde Mi campo cuando recuperes la conexión." : "No se pudo cargar el historial."}</span>
            {!readOnly && <Button variant="outline" size="sm" onClick={() => void loadMovements()}>Reintentar</Button>}
          </div>
        ) : movements.length === 0 ? (
          <div className="rounded-xl border border-border bg-card">
            <EmptyState icon={ArrowUpFromLine} title="Sin movimientos" description="Las compras, usos y ajustes aparecerán aquí cuando registres el primer movimiento." />
          </div>
        ) : (
          <div className="rounded-xl border border-border overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Movimiento</TableHead>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead>Contexto</TableHead>
                  <TableHead>Notas</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {movements.map((movement) => {
                  const quantity = Number(movement.quantity);
                  const positive = quantity > 0;
                  return (
                    <TableRow id={`inventory-movement-${movement.id}`} key={movement.id} className={focusedMovementId === movement.id ? "bg-accent" : undefined}>
                      <TableCell className="text-xs text-muted-foreground">{new Date(`${movement.date}T12:00:00`).toLocaleDateString("es-UY")}</TableCell>
                      <TableCell><Badge variant="outline" className={positive ? "border-emerald-500/30 text-emerald-600 dark:text-emerald-400" : "border-amber-500/30 text-amber-600 dark:text-amber-400"}>{MOVEMENT_LABELS[movement.type] || movement.type}</Badge></TableCell>
                      <TableCell className="font-medium">{movement.inventory_items?.name || "Item eliminado"}</TableCell>
                      <TableCell className={`text-right tabular-nums font-mono ${positive ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}>{positive ? "+" : ""}{quantity} {movement.inventory_items?.unit || ""}</TableCell>
                      <TableCell className="max-w-[220px] text-xs">
                        <div className="flex flex-wrap gap-x-2 gap-y-1">
                          {movement.sections?.name && movement.section_id && (
                            <Link href={`/produccion/hacienda?sectionId=${encodeURIComponent(movement.section_id)}`} className="text-primary hover:underline">
                              Sección: {movement.sections.name}
                            </Link>
                          )}
                          {movement.crops?.crop_type && movement.crop_id && (
                            <Link href={`/produccion/agricultura?cropId=${encodeURIComponent(movement.crop_id)}`} className="text-primary hover:underline">
                              Cultivo: {movement.crops.crop_type}
                            </Link>
                          )}
                          {movement.cattle?.category && movement.cattle_id && (
                            <Link href={`/produccion/hacienda?cattleId=${encodeURIComponent(movement.cattle_id)}`} className="text-primary hover:underline">
                              Lote: {movement.cattle.category}
                            </Link>
                          )}
                          {!movement.section_id && !movement.crop_id && !movement.cattle_id && <span className="text-muted-foreground">Sin asignar</span>}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[240px] truncate text-xs text-muted-foreground">{movement.notes || "—"}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </section>

      {/* Sheet for forms */}
      <Sheet open={sheetOpen} onOpenChange={(open) => { if (!open && saving) return; setSheetOpen(open); }}>
        <SheetContent className="overflow-y-auto">
          {(sheetMode === "add-item" || sheetMode === "edit-item") && (
            <>
              <SheetHeader>
                <SheetTitle>{sheetMode === "edit-item" ? "Editar item" : "Nuevo item"}</SheetTitle>
                <SheetDescription>{sheetMode === "edit-item" ? "Actualiza los datos del insumo sin perder sus movimientos." : "Agrega un nuevo insumo al inventario."}</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="space-y-2"><Label>Nombre</Label><Input value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Ej: Glifosato" /></div>
                <div className="space-y-2">
                  <Label>Categoria</Label>
                  <Select value={itemCategory} onValueChange={setItemCategory}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CATEGORIES.map((c) => (
                        <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Unidad</Label>
                  <Select value={itemUnit} onValueChange={setItemUnit}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {UNITS.map((u) => (
                        <SelectItem key={u} value={u}>{u}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Moneda</Label>
                  <Select value={itemCurrency} onValueChange={setItemCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Stock minimo</Label><Input type="number" value={itemMinStock} onChange={(e) => setItemMinStock(e.target.value)} placeholder="10" /></div>
                <div className="space-y-2"><Label>Notas</Label><Input value={itemNotes} onChange={(e) => setItemNotes(e.target.value)} placeholder="Observaciones..." /></div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>Cancelar</Button>
                <Button onClick={saveItem} disabled={readOnly || !itemName.trim() || saving}>{saving ? "Guardando..." : sheetMode === "edit-item" ? "Guardar cambios" : "Crear item"}</Button>
              </SheetFooter>
            </>
          )}

          {sheetMode === "compra" && (
            <>
              <SheetHeader>
                <SheetTitle>Registrar compra</SheetTitle>
                <SheetDescription>Ingresa stock al inventario.</SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="space-y-2">
                  <Label>Item</Label>
                  <Select value={movItemId} onValueChange={selectMovementItem}>
                    <SelectTrigger><SelectValue placeholder="Elegir item..." /></SelectTrigger>
                    <SelectContent>
                      {items.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Cantidad</Label><Input type="number" value={movQuantity} onChange={(e) => setMovQuantity(e.target.value)} placeholder="100" /></div>
                <div className="space-y-2"><Label>Costo por unidad ({movCurrency})</Label><Input type="number" value={movUnitCost} onChange={(e) => setMovUnitCost(e.target.value)} placeholder="5.50" /></div>
                <div className="space-y-2">
                  <Label>Moneda de la compra</Label>
                  <Select value={movCurrency} onValueChange={setMovCurrency}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CURRENCIES.map((currency) => <SelectItem key={currency} value={currency}>{currency}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Fecha</Label><Input type="date" value={movDate} onChange={(e) => setMovDate(e.target.value)} /></div>
                <div className="space-y-2"><Label>Notas</Label><Input value={movNotes} onChange={(e) => setMovNotes(e.target.value)} placeholder="Proveedor, factura..." /></div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>Cancelar</Button>
                <Button onClick={saveMovement} disabled={readOnly || !movItemId || !movQuantity || saving}>{saving ? "Guardando..." : "Registrar compra"}</Button>
              </SheetFooter>
            </>
          )}

          {(sheetMode === "uso" || sheetMode === "ajuste" || sheetMode === "pérdida") && (
            <>
              <SheetHeader>
                <SheetTitle>{MOVEMENT_LABELS[sheetMode]}</SheetTitle>
                <SheetDescription>
                  {sheetMode === "ajuste"
                    ? "Corrige el stock. Usa un valor positivo para sumar o negativo para descontar."
                    : sheetMode === "pérdida"
                      ? "Registra una merma o pérdida y descuenta stock automáticamente."
                      : "Descuenta stock del inventario."}
                </SheetDescription>
              </SheetHeader>
              <div className="space-y-4 py-6">
                <div className="space-y-2">
                  <Label>Item</Label>
                  <Select value={movItemId} onValueChange={setMovItemId}>
                    <SelectTrigger><SelectValue placeholder="Elegir item..." /></SelectTrigger>
                    <SelectContent>
                      {items.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name} ({i.current_stock} {i.unit})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>{sheetMode === "ajuste" ? "Cambio de stock (+/-)" : "Cantidad"}</Label>
                  <Input type="number" value={movQuantity} onChange={(e) => setMovQuantity(e.target.value)} placeholder={sheetMode === "ajuste" ? "Ej: -3 o 10" : "10"} />
                </div>
                <div className="space-y-2">
                  <Label>Seccion <span className="text-muted-foreground">(opcional)</span></Label>
                  <Select value={movSectionId || "none"} onValueChange={selectMovementSection}>
                    <SelectTrigger><SelectValue placeholder="Sin sección" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin sección</SelectItem>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Cultivo <span className="text-muted-foreground">(opcional)</span></Label>
                  <Select value={movCropId || "none"} onValueChange={(value) => selectMovementCrop(value === "none" ? "" : value)}>
                    <SelectTrigger><SelectValue placeholder="Sin cultivo" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin cultivo</SelectItem>
                      {availableMovementCrops.map((crop) => (
                        <SelectItem key={crop.id} value={crop.id}>{crop.crop_type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Hacienda <span className="text-muted-foreground">(opcional)</span></Label>
                  <Select value={movCattleId || "none"} onValueChange={selectMovementCattle}>
                    <SelectTrigger><SelectValue placeholder="Sin hacienda" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Sin hacienda</SelectItem>
                      {availableMovementCattle.map((row) => (
                        <SelectItem key={row.id} value={row.id}>{row.category}{row.breed ? ` · ${row.breed}` : ""} · {row.count} cab.</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Fecha</Label><Input type="date" value={movDate} onChange={(e) => setMovDate(e.target.value)} /></div>
                <div className="space-y-2"><Label>Notas</Label><Input value={movNotes} onChange={(e) => setMovNotes(e.target.value)} placeholder="Observaciones..." /></div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={() => setSheetOpen(false)} disabled={saving}>Cancelar</Button>
                <Button onClick={saveMovement} disabled={readOnly || !movItemId || !movQuantity || saving}>{saving ? "Guardando..." : `Registrar ${MOVEMENT_LABELS[sheetMode].toLocaleLowerCase()}`}</Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

export default function InventarioPage() {
  return <Suspense fallback={<LoadingPage />}><InventarioPageContent /></Suspense>;
}
