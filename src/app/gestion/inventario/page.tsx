"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpFromLine, MoreHorizontal, Plus, Printer, ShoppingCart, SlidersHorizontal, TriangleAlert } from "lucide-react";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { LoadingPage } from "@/components/LoadingPage";
import { LoadErrorState } from "@/components/LoadErrorState";
import { UnsavedChangesDialog } from "@/components/UnsavedChangesDialog";
import { StatStrip } from "@/components/StatCard";
import { AuthenticatedDownloadLink } from "@/components/AuthenticatedDownloadLink";
import { CampoAIButton } from "@/components/CampoAIButton";
import { InventoryImportDialog } from "@/components/InventoryImportDialog";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Notice } from "@/components/gestion/Notice";
import { InventoryItemsTable } from "@/components/gestion/InventoryItemsTable";
import { InventoryMovementsTable } from "@/components/gestion/InventoryMovementsTable";
import { InventorySheet } from "@/components/gestion/InventorySheet";
import { useInventoryData } from "@/components/gestion/useInventoryData";
import {
  EMPTY_ITEM_FORM, MOVEMENT_LABELS, emptyMovementForm,
  type InventoryItem, type InventoryMovement, type ItemFormState, type MovementFormState,
} from "@/components/gestion/inventory-types";
import { createIdempotencyKey, sendJsonResult } from "@/lib/mutate";
import { filterCropsForSection } from "@/lib/inventory-navigation";
import { signedInventoryQuantity, type InventoryMovementType } from "@/lib/inventory-movement";
import { inventoryFormSignature, inventoryValueByCurrency, type InventorySheetMode } from "@/lib/inventory-stock";
import { dateInputValue } from "@/lib/date";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";
import { useUnsavedChangesWarning } from "@/lib/use-unsaved-changes-warning";
import { useOfflineAwareNavigation, useOfflineAwareReplace } from "@/lib/use-offline-aware-navigation";
import { formatAmount, formatMoney } from "@/lib/format";
import { parseLocalizedNumber } from "@/lib/number";

const ROWS_PER_PAGE = 20;

function formSignature(mode: InventorySheetMode, editId: string | null, item: ItemFormState, movement: MovementFormState) {
  return inventoryFormSignature({
    mode, editId,
    itemName: item.name, itemCategory: item.category, itemUnit: item.unit, itemCurrency: item.currency,
    itemMinStock: item.minStock, itemNotes: item.notes,
    movItemId: movement.itemId, movQuantity: movement.quantity, movUnitCost: movement.unitCost, movCurrency: movement.currency,
    movSectionId: movement.sectionId, movCropId: movement.cropId, movCattleId: movement.cattleId,
    movDate: movement.date, movNotes: movement.notes,
  });
}

function InventarioPageContent() {
  const { farm, sections, userId, readOnly, offlineMode, isOnline } = useFarm();
  const offlineReadOnly = offlineMode || !isOnline;
  const navigate = useOfflineAwareNavigation();
  const replace = useOfflineAwareReplace();
  const searchParams = useSearchParams();
  const navigationQuery = searchParams.toString();
  const {
    items, itemsTruncated, crops, cattle, movements, movementsTruncated,
    loaded, loadError, movementLoadError, movementsLoaded, offlineInventorySavedAt,
    loadItems, loadMovements, refreshInventoryData,
  } = useInventoryData({ farmId: farm?.id, userId, offlineReadOnly });
  const [filterCat, setFilterCat] = useState("todos");
  const [currentPage, setCurrentPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<InventorySheetMode>("add-item");
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const handledNavigationQueryRef = useRef<string | null>(null);
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [focusedMovementId, setFocusedMovementId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [itemForm, setItemForm] = useState<ItemFormState>(EMPTY_ITEM_FORM);
  const [movForm, setMovForm] = useState<MovementFormState>(() => emptyMovementForm(""));
  const itemAttempt = useRef<{ key: string; signature: string } | null>(null);
  const movementAttempt = useRef<{ key: string; signature: string } | null>(null);
  const formBaselineRef = useRef<string | null>(null);

  const updateItemForm = (patch: Partial<ItemFormState>) => setItemForm((current) => ({ ...current, ...patch }));
  const updateMovForm = (patch: Partial<MovementFormState>) => setMovForm((current) => ({ ...current, ...patch }));
  const currentFormSignature = () => formSignature(sheetMode, editId, itemForm, movForm);

  useUnsavedChangesWarning(sheetOpen && hasUnsavedChanges(formBaselineRef.current, currentFormSignature()));

  /** Opens a movement sheet with `movement` as both the form and its clean baseline. */
  function openMovementSheet(mode: Exclude<InventorySheetMode, "add-item" | "edit-item">, movement: MovementFormState) {
    setMovForm(movement);
    setSheetMode(mode);
    formBaselineRef.current = formSignature(mode, null, EMPTY_ITEM_FORM, movement);
    setSheetOpen(true);
  }

  useEffect(() => {
    if (!loaded || !movementsLoaded || handledNavigationQueryRef.current === navigationQuery) return;
    const params = new URLSearchParams(navigationQuery);
    const itemId = params.get("itemId");
    const movementId = params.get("movementId");
    const suggestedItem = params.get("itemName")
      ? items.find((candidate) => candidate.name.trim().toLocaleLowerCase() === params.get("itemName")?.trim().toLocaleLowerCase())
      : null;
    const requestedItemMissing = Boolean(itemId && params.get("use") !== "1" && !items.some((item) => item.id === itemId));
    const requestedMovementMissing = Boolean(movementId && !movements.some((movement) => movement.id === movementId));
    if (requestedItemMissing || requestedMovementMissing) return;
    if (params.get("use") === "1") {
      openMovementSheet("uso", {
        itemId: itemId || suggestedItem?.id || "",
        quantity: "", unitCost: "", currency: "USD",
        sectionId: params.get("sectionId") || "",
        cropId: params.get("cropId") || "",
        cattleId: params.get("cattleId") || "",
        date: params.get("date") || dateInputValue(),
        notes: params.get("notes") || "",
      });
    }
    if (itemId && params.get("use") !== "1") {
      const itemIndex = items.findIndex((candidate) => candidate.id === itemId);
      const item = itemIndex >= 0 ? items[itemIndex] : null;
      if (item) {
        if (params.get("buy") === "1") {
          openMovementSheet("compra", { ...emptyMovementForm(params.get("date") || dateInputValue()), itemId: item.id, currency: item.currency || "USD" });
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
    if (navigationQuery) replace(window.location.pathname, { scroll: false });
  }, [items, loaded, movements, movementsLoaded, navigationQuery, replace]);

  function resetItemForm() {
    itemAttempt.current = null;
    setItemForm(EMPTY_ITEM_FORM);
    setEditId(null);
    formBaselineRef.current = null;
  }

  function resetMovForm() {
    movementAttempt.current = null;
    setMovForm(emptyMovementForm(dateInputValue()));
    formBaselineRef.current = null;
  }

  function openAddItem() {
    resetItemForm();
    setSheetMode("add-item");
    formBaselineRef.current = formSignature("add-item", null, EMPTY_ITEM_FORM, movForm);
    setSheetOpen(true);
  }

  function openEditItem(item: InventoryItem) {
    const next: ItemFormState = {
      name: item.name,
      category: item.category,
      unit: item.unit,
      currency: item.currency || "USD",
      minStock: item.min_stock == null ? "" : String(item.min_stock),
      notes: item.notes || "",
    };
    setEditId(item.id);
    setItemForm(next);
    setSheetMode("edit-item");
    formBaselineRef.current = formSignature("edit-item", item.id, next, movForm);
    setSheetOpen(true);
  }

  function openMovement(mode: "compra" | "uso" | "ajuste" | "pérdida") {
    movementAttempt.current = null;
    openMovementSheet(mode, emptyMovementForm(dateInputValue()));
  }

  function closeSheet() {
    setSheetOpen(false);
    resetItemForm();
    resetMovForm();
    setSheetMode("add-item");
  }

  function discardFormChanges() {
    setDiscardDialogOpen(false);
    closeSheet();
  }

  function requestSheetClose() {
    if (saving) return;
    if (hasUnsavedChanges(formBaselineRef.current, currentFormSignature())) {
      setDiscardDialogOpen(true);
      return;
    }
    closeSheet();
  }

  function selectMovementItem(id: string) {
    const item = items.find((candidate) => candidate.id === id);
    updateMovForm(item?.currency ? { itemId: id, currency: item.currency } : { itemId: id });
  }

  function selectMovementCrop(id: string) {
    if (!id) { updateMovForm({ cropId: id }); return; }
    const crop = crops.find((candidate) => candidate.id === id);
    const patch: Partial<MovementFormState> = { cropId: id };
    if (crop?.section_id && crop.section_id !== movForm.sectionId) {
      patch.sectionId = crop.section_id;
      const cattleRelation = cattle.find((candidate) => candidate.id === movForm.cattleId);
      if (cattleRelation?.section_id && cattleRelation.section_id !== crop.section_id) patch.cattleId = "";
    }
    updateMovForm(patch);
  }

  function selectMovementSection(id: string) {
    const nextSectionId = id === "none" ? "" : id;
    const patch: Partial<MovementFormState> = { sectionId: nextSectionId };
    const crop = crops.find((candidate) => candidate.id === movForm.cropId);
    const cattleRelation = cattle.find((candidate) => candidate.id === movForm.cattleId);
    if (nextSectionId && crop?.section_id && crop.section_id !== nextSectionId) patch.cropId = "";
    if (nextSectionId && cattleRelation?.section_id && cattleRelation.section_id !== nextSectionId) patch.cattleId = "";
    updateMovForm(patch);
  }

  function selectMovementCattle(id: string) {
    const nextCattleId = id === "none" ? "" : id;
    const patch: Partial<MovementFormState> = { cattleId: nextCattleId };
    const cattleRelation = cattle.find((candidate) => candidate.id === nextCattleId);
    if (cattleRelation?.section_id && cattleRelation.section_id !== movForm.sectionId) {
      patch.sectionId = cattleRelation.section_id;
      const crop = crops.find((candidate) => candidate.id === movForm.cropId);
      if (crop?.section_id && crop.section_id !== cattleRelation.section_id) patch.cropId = "";
    }
    updateMovForm(patch);
  }

  async function saveItem() {
    if (readOnly || !itemForm.name.trim()) return;
    setSaving(true);
    const editing = sheetMode === "edit-item" && editId;
    try {
      const payload = {
        ...(editing ? { id: editId } : {}),
        name: itemForm.name,
        category: itemForm.category,
        unit: itemForm.unit,
        currency: itemForm.currency,
        minStock: itemForm.minStock ? parseLocalizedNumber(itemForm.minStock) : null,
        notes: itemForm.notes || null,
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
        toast.success(editing ? "Insumo actualizado" : "Insumo creado");
        setSheetOpen(false);
        resetItemForm();
        await loadItems();
      } else {
        toast.error(result.error || (editing ? "No se pudo actualizar el insumo. Revisá los datos e intentá de nuevo." : "No se pudo crear el insumo. Revisá los datos e intentá de nuevo."));
      }
    } catch {
      toast.error(editing ? "No se pudo actualizar el insumo. Revisá tu conexión e intentá de nuevo." : "No se pudo crear el insumo. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function saveMovement() {
    if (readOnly || !movForm.itemId || !movForm.quantity) return;
    setSaving(true);
    try {
      const movementType = (sheetMode === "compra" ? "compra" : sheetMode) as InventoryMovementType;
      const payload = {
        itemId: movForm.itemId,
        type: movementType,
        quantity: signedInventoryQuantity(movementType, parseLocalizedNumber(movForm.quantity)),
        unitCost: sheetMode === "compra" && movForm.unitCost ? parseLocalizedNumber(movForm.unitCost) : null,
        currency: sheetMode === "compra" ? movForm.currency : undefined,
        sectionId: sheetMode !== "compra" && movForm.sectionId ? movForm.sectionId : null,
        cropId: sheetMode !== "compra" && movForm.cropId ? movForm.cropId : null,
        cattleId: sheetMode !== "compra" && movForm.cattleId ? movForm.cattleId : null,
        date: movForm.date || null,
        notes: movForm.notes || null,
      };
      const signature = JSON.stringify(payload);
      if (!movementAttempt.current || movementAttempt.current.signature !== signature) {
        movementAttempt.current = { key: createIdempotencyKey(), signature };
      }

      const result = await sendJsonResult("/api/inventory/movements", "POST", payload, { idempotencyKey: movementAttempt.current.key });
      if (!result.ok) {
        if (result.code === "purchase_migration_required" || result.code === "purchase_transaction_unavailable" || result.code === "idempotency_migration_required") {
          toast.error(result.error || "La compra requiere revisar la configuración de Supabase.", {
            action: { label: "Abrir diagnóstico", onClick: () => navigate("/gestion/campo") },
          });
        } else {
          toast.error(result.error || "No se pudo registrar el movimiento. Revisá los datos e intentá de nuevo.");
        }
      } else {
        movementAttempt.current = null;
        toast.success(`${MOVEMENT_LABELS[movementType as InventoryMovement["type"]]} registrado`);
        setSheetOpen(false);
        resetMovForm();
        await Promise.all([loadItems(), loadMovements()]);
      }
    } catch {
      toast.error("No se pudo registrar el movimiento. Revisá tu conexión e intentá de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteItem(id: string) {
    if (readOnly) return;
    const result = await sendJsonResult("/api/inventory", "DELETE", { id });
    if (result.ok) { toast.success("Insumo eliminado"); await Promise.all([loadItems(), loadMovements()]); }
    else toast.error(result.error || "No se pudo eliminar el insumo. Intentá de nuevo.");
  }

  // ─── Derived data ─────────────────────────

  const lowStockItems = items.filter((i) => i.min_stock && i.current_stock < i.min_stock);
  const filtered = filterCat === "todos" ? items : items.filter((i) => i.category === filterCat);
  const valueEntries = Object.entries(inventoryValueByCurrency(items));
  const totalValueLabel = valueEntries.map(([currency, value]) => formatMoney(value, currency)).join(" · ") || "—";

  const inventoryAIFacts = [
    `Items visibles: ${filtered.length}${itemsTruncated ? "+" : ""}`,
    `Stock bajo: ${lowStockItems.length}`,
    `Valor estimado del inventario: ${totalValueLabel}`,
    ...filtered.slice(0, 30).map((item) => `${item.name}: ${item.current_stock} ${item.unit}${item.min_stock ? ` (mínimo ${item.min_stock})` : ""}`),
    ...movements.slice(0, 20).map((movement) => `${movement.date}: ${MOVEMENT_LABELS[movement.type]} ${movement.inventory_items?.name || movement.item_id}, cantidad ${movement.quantity}`),
  ];

  const totalPages = Math.max(1, Math.ceil(filtered.length / ROWS_PER_PAGE));
  const paginatedItems = filtered.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);
  const availableMovementCrops = filterCropsForSection(crops, movForm.sectionId, movForm.cropId);
  const availableMovementCattle = movForm.sectionId
    ? cattle.filter((row) => !row.section_id || row.section_id === movForm.sectionId || row.id === movForm.cattleId)
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
  if (loadError) return <LoadErrorState title={offlineReadOnly ? "No hay una copia local de Inventario" : "No se pudo cargar Inventario"} description={offlineReadOnly ? "Sincronizá Inventario cuando recuperes la conexión para consultarlo sin conexión." : undefined} onRetry={offlineReadOnly ? undefined : loadItems} />;

  const [primaryValue, ...otherValues] = valueEntries;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Inventario"
        description="Stock de insumos, con las compras, usos y ajustes que lo mueven."
        actions={
          <>
            <CampoAIButton
              title="Inventario"
              facts={inventoryAIFacts}
              partial={itemsTruncated || movementsTruncated || !movementsLoaded || movementLoadError}
              instruction="Priorizá quiebres de stock, consumos anómalos y compras que convenga planificar; para compras con costo mantené vinculados inventario y finanzas."
              disabled={items.length === 0}
            />
            <InventoryImportDialog readOnly={readOnly} onImported={refreshInventoryData} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" aria-label="Más acciones"><MoreHorizontal className="h-4 w-4" />Más</Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={openAddItem} disabled={readOnly}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />Nuevo insumo
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openMovement("ajuste")} disabled={readOnly}>
                  <SlidersHorizontal className="mr-2 h-4 w-4" aria-hidden="true" />Ajustar stock
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openMovement("pérdida")} disabled={readOnly}>
                  <TriangleAlert className="mr-2 h-4 w-4" aria-hidden="true" />Registrar pérdida
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem asChild>
                  <Link href="/reportes"><Printer className="mr-2 h-4 w-4" aria-hidden="true" />Reportes</Link>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="outline" onClick={() => openMovement("compra")} disabled={readOnly}><ShoppingCart className="h-4 w-4" aria-hidden="true" />Registrar compra</Button>
            <Button onClick={() => openMovement("uso")} disabled={readOnly}><ArrowUpFromLine className="h-4 w-4" aria-hidden="true" />Registrar uso</Button>
          </>
        }
      />

      {(offlineInventorySavedAt || itemsTruncated || lowStockItems.length > 0) && (
        <div className="space-y-3">
          {offlineInventorySavedAt && (
            <Notice title="Inventario en modo lectura">
              Mostrando la copia sincronizada el {new Date(offlineInventorySavedAt).toLocaleString("es-UY")}. Las compras, usos y ajustes se habilitan al recuperar la conexión.
            </Notice>
          )}
          {lowStockItems.length > 0 && (
            <Notice tone="bad" icon={AlertTriangle} role="alert" title={`Stock bajo en ${lowStockItems.length} ${lowStockItems.length === 1 ? "insumo" : "insumos"}`}>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {lowStockItems.map((i) => (
                  <li key={i.id}>
                    <span className="font-medium">{i.name}</span>{" "}
                    <span className="figure">{i.current_stock}</span> {i.unit}
                    <span className="opacity-80"> (mínimo <span className="figure">{i.min_stock}</span>)</span>
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          {itemsTruncated && (
            <Notice>
              Se muestran los primeros 1.000 insumos. Para ver el inventario completo,{" "}
              <AuthenticatedDownloadLink href="/api/export?format=csv&table=inventory_items" filename="campoai-inventario.csv" className="font-medium text-primary underline-offset-2 hover:underline">descargá el inventario (CSV)</AuthenticatedDownloadLink>.
            </Notice>
          )}
        </div>
      )}

      <StatStrip
        items={[
          { label: "Insumos", value: items.length },
          { label: "Stock bajo", value: lowStockItems.length, tone: lowStockItems.length > 0 ? "bad" : undefined },
          { label: "Categorías", value: new Set(items.map((i) => i.category)).size },
          primaryValue
            ? {
              label: "Valor estimado",
              value: formatAmount(primaryValue[1]),
              unit: primaryValue[0],
              hint: otherValues.length > 0 ? `y ${otherValues.map(([currency, value]) => formatMoney(value, currency)).join(" · ")}` : undefined,
            }
            : { label: "Valor estimado", value: "—" },
        ]}
      />

      <InventoryItemsTable
        items={paginatedItems}
        filteredCount={filtered.length}
        filterCat={filterCat}
        onFilterChange={setFilterCat}
        currentPage={currentPage}
        totalPages={totalPages}
        onPageChange={setCurrentPage}
        focusedItemId={focusedItemId}
        onAddItem={openAddItem}
        onEditItem={openEditItem}
        onDeleteItem={deleteItem}
      />

      <InventoryMovementsTable
        movements={movements}
        truncated={movementsTruncated}
        loadError={movementLoadError}
        offlineReadOnly={offlineReadOnly}
        focusedMovementId={focusedMovementId}
        onRetry={() => void loadMovements()}
      />

      <InventorySheet
        open={sheetOpen}
        onOpen={() => setSheetOpen(true)}
        onRequestClose={requestSheetClose}
        mode={sheetMode}
        readOnly={readOnly}
        saving={saving}
        item={itemForm}
        onItemChange={updateItemForm}
        onSaveItem={saveItem}
        movement={movForm}
        onMovementChange={updateMovForm}
        onSaveMovement={saveMovement}
        onSelectItem={selectMovementItem}
        onSelectSection={selectMovementSection}
        onSelectCrop={selectMovementCrop}
        onSelectCattle={selectMovementCattle}
        items={items}
        sections={sections}
        crops={availableMovementCrops}
        cattle={availableMovementCattle}
      />
      <UnsavedChangesDialog
        open={discardDialogOpen}
        onOpenChange={setDiscardDialogOpen}
        onDiscard={discardFormChanges}
      />
    </div>
  );
}

export default function InventarioPage() {
  return <Suspense fallback={<LoadingPage />}><InventarioPageContent /></Suspense>;
}
