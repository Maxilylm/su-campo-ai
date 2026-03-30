"use client";

import { useState, useEffect, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
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
import {
  AlertTriangle, Drumstick, Sprout, FlaskConical, Pill, Fuel, Package,
  Plus, ShoppingCart, ArrowUpFromLine, MoreHorizontal, Trash2, Boxes,
  Layers, DollarSign, type LucideIcon,
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
  notes: string | null;
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

export default function InventarioPage() {
  const { sections } = useFarm();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [filterCat, setFilterCat] = useState("todos");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetMode, setSheetMode] = useState<"add-item" | "compra" | "uso">("add-item");
  const [saving, setSaving] = useState(false);

  // New item form state
  const [itemName, setItemName] = useState("");
  const [itemCategory, setItemCategory] = useState("alimento");
  const [itemUnit, setItemUnit] = useState("kg");
  const [itemMinStock, setItemMinStock] = useState("");
  const [itemNotes, setItemNotes] = useState("");

  // Movement form state
  const [movItemId, setMovItemId] = useState("");
  const [movQuantity, setMovQuantity] = useState("");
  const [movUnitCost, setMovUnitCost] = useState("");
  const [movSectionId, setMovSectionId] = useState("");
  const [movDate, setMovDate] = useState("");
  const [movNotes, setMovNotes] = useState("");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const ROWS_PER_PAGE = 20;

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch("/api/inventory");
      if (res.ok) setItems(await res.json());
    } catch (e) {
      console.error("Load inventory error:", e);
    }
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  function resetItemForm() {
    setItemName(""); setItemCategory("alimento"); setItemUnit("kg");
    setItemMinStock(""); setItemNotes("");
  }

  function resetMovForm() {
    setMovItemId(""); setMovQuantity(""); setMovUnitCost("");
    setMovSectionId(""); setMovDate(""); setMovNotes("");
  }

  function openAddItem() { resetItemForm(); setSheetMode("add-item"); setSheetOpen(true); }
  function openCompra() { resetMovForm(); setSheetMode("compra"); setSheetOpen(true); }
  function openUso() { resetMovForm(); setSheetMode("uso"); setSheetOpen(true); }

  async function saveItem() {
    if (!itemName.trim()) return;
    setSaving(true);
    await fetch("/api/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: itemName,
        category: itemCategory,
        unit: itemUnit,
        minStock: itemMinStock ? Number(itemMinStock) : null,
        notes: itemNotes || null,
      }),
    });
    toast.success("Item creado");
    setSheetOpen(false); setSaving(false); await loadItems();
  }

  async function saveMovement() {
    if (!movItemId || !movQuantity) return;
    setSaving(true);
    const isUso = sheetMode === "uso";
    const qty = isUso ? -Math.abs(Number(movQuantity)) : Math.abs(Number(movQuantity));

    const res = await fetch("/api/inventory/movements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itemId: movItemId,
        type: isUso ? "uso" : "compra",
        quantity: qty,
        unitCost: !isUso && movUnitCost ? Number(movUnitCost) : null,
        sectionId: isUso && movSectionId ? movSectionId : null,
        date: movDate || null,
        notes: movNotes || null,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      toast.error(err.error || "Error al registrar movimiento");
      setSaving(false);
      return;
    }

    toast.success(isUso ? "Uso registrado" : "Compra registrada");
    setSheetOpen(false); setSaving(false); await loadItems();
  }

  async function deleteItem(id: string) {
    await fetch("/api/inventory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    toast.success("Item eliminado");
    await loadItems();
  }

  // ─── Derived data ─────────────────────────

  const lowStockItems = items.filter((i) => i.min_stock && i.current_stock < i.min_stock);
  const filtered = filterCat === "todos" ? items : items.filter((i) => i.category === filterCat);
  const totalValue = items.reduce((sum, i) => sum + i.current_stock * (i.cost_per_unit || 0), 0);

  const totalPages = Math.ceil(filtered.length / ROWS_PER_PAGE);
  const paginatedItems = filtered.slice((currentPage - 1) * ROWS_PER_PAGE, currentPage * ROWS_PER_PAGE);

  // Reset page when filter changes
  useEffect(() => { setCurrentPage(1); }, [filterCat]);

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[{ label: "Gestion", href: "/gestion/inventario" }, { label: "Inventario" }]}
        title="Inventario"
        description="Control de stock, compras y uso de insumos"
        actions={
          <div className="flex gap-2">
            <Button variant="outline" onClick={openAddItem}><Plus className="h-4 w-4 mr-1.5" />Nuevo Item</Button>
            <Button variant="outline" onClick={openCompra}><ShoppingCart className="h-4 w-4 mr-1.5" />Registrar Compra</Button>
            <Button onClick={openUso}><ArrowUpFromLine className="h-4 w-4 mr-1.5" />Registrar Uso</Button>
          </div>
        }
      />

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

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Items totales" value={items.length} accent="blue" icon={Boxes} />
        <StatCard label="Stock bajo" value={lowStockItems.length} accent="red" icon={AlertTriangle} />
        <StatCard label="Categorias" value={new Set(items.map((i) => i.category)).size} accent="purple" icon={Layers} />
        <StatCard label="Valor total" value={`$${totalValue.toLocaleString()}`} accent="emerald" icon={DollarSign} />
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
                      <TableRow key={item.id}>
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
                          {item.cost_per_unit != null ? `$${item.cost_per_unit}` : "—"}
                        </TableCell>
                        <TableCell>{statusBadge(status)}</TableCell>
                        <TableCell>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8"><MoreHorizontal className="h-4 w-4" /></Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
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

      {/* Sheet for forms */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          {sheetMode === "add-item" && (
            <>
              <SheetHeader>
                <SheetTitle>Nuevo item</SheetTitle>
                <SheetDescription>Agrega un nuevo insumo al inventario.</SheetDescription>
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
                <div className="space-y-2"><Label>Stock minimo</Label><Input type="number" value={itemMinStock} onChange={(e) => setItemMinStock(e.target.value)} placeholder="10" /></div>
                <div className="space-y-2"><Label>Notas</Label><Input value={itemNotes} onChange={(e) => setItemNotes(e.target.value)} placeholder="Observaciones..." /></div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
                <Button onClick={saveItem} disabled={!itemName.trim() || saving}>{saving ? "Guardando..." : "Crear item"}</Button>
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
                  <Select value={movItemId} onValueChange={setMovItemId}>
                    <SelectTrigger><SelectValue placeholder="Elegir item..." /></SelectTrigger>
                    <SelectContent>
                      {items.map((i) => (
                        <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Cantidad</Label><Input type="number" value={movQuantity} onChange={(e) => setMovQuantity(e.target.value)} placeholder="100" /></div>
                <div className="space-y-2"><Label>Costo por unidad ($)</Label><Input type="number" value={movUnitCost} onChange={(e) => setMovUnitCost(e.target.value)} placeholder="5.50" /></div>
                <div className="space-y-2"><Label>Fecha</Label><Input type="date" value={movDate} onChange={(e) => setMovDate(e.target.value)} /></div>
                <div className="space-y-2"><Label>Notas</Label><Input value={movNotes} onChange={(e) => setMovNotes(e.target.value)} placeholder="Proveedor, factura..." /></div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
                <Button onClick={saveMovement} disabled={!movItemId || !movQuantity || saving}>{saving ? "Guardando..." : "Registrar compra"}</Button>
              </SheetFooter>
            </>
          )}

          {sheetMode === "uso" && (
            <>
              <SheetHeader>
                <SheetTitle>Registrar uso</SheetTitle>
                <SheetDescription>Descuenta stock del inventario.</SheetDescription>
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
                <div className="space-y-2"><Label>Cantidad</Label><Input type="number" value={movQuantity} onChange={(e) => setMovQuantity(e.target.value)} placeholder="10" /></div>
                <div className="space-y-2">
                  <Label>Seccion</Label>
                  <Select value={movSectionId} onValueChange={setMovSectionId}>
                    <SelectTrigger><SelectValue placeholder="Elegir seccion..." /></SelectTrigger>
                    <SelectContent>
                      {sections.map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2"><Label>Fecha</Label><Input type="date" value={movDate} onChange={(e) => setMovDate(e.target.value)} /></div>
                <div className="space-y-2"><Label>Notas</Label><Input value={movNotes} onChange={(e) => setMovNotes(e.target.value)} placeholder="Observaciones..." /></div>
              </div>
              <SheetFooter>
                <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
                <Button onClick={saveMovement} disabled={!movItemId || !movQuantity || saving}>{saving ? "Guardando..." : "Registrar uso"}</Button>
              </SheetFooter>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
