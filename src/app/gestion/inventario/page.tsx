"use client";

import { useState, useEffect, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { Input } from "@/components/Input";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";

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

const CATEGORIES = [
  { value: "alimento", label: "🥩 Alimento" },
  { value: "semilla", label: "🌱 Semilla" },
  { value: "fertilizante", label: "🧴 Fertilizante" },
  { value: "agroquímico", label: "🧪 Agroquímico" },
  { value: "medicamento", label: "💊 Medicamento" },
  { value: "combustible", label: "⛽ Combustible" },
  { value: "otro", label: "📦 Otro" },
];

const UNITS = ["kg", "L", "dosis", "unidad"];

const CATEGORY_EMOJI: Record<string, string> = {
  alimento: "🥩",
  semilla: "🌱",
  fertilizante: "🧴",
  "agroquímico": "🧪",
  medicamento: "💊",
  combustible: "⛽",
  otro: "📦",
};

// ─── Select Component ───────────────────────

function Select({ label, value, onChange, options, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; options: string[][]; placeholder?: string;
}) {
  return (
    <div>
      <label className="input-label">{label}</label>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="input-field">
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(([val, lbl]) => (
          <option key={val} value={val}>{lbl}</option>
        ))}
      </select>
    </div>
  );
}

// ─── Status helpers ─────────────────────────

function getStockStatus(item: InventoryItem): "bajo" | "justo" | "ok" {
  if (!item.min_stock) return "ok";
  if (item.current_stock < item.min_stock) return "bajo";
  if (item.current_stock < 2 * item.min_stock) return "justo";
  return "ok";
}

function statusTag(status: "bajo" | "justo" | "ok") {
  if (status === "bajo") return <span className="tag tag-red text-xs">Bajo</span>;
  if (status === "justo") return <span className="tag tag-amber text-xs">Justo</span>;
  return <span className="tag tag-green text-xs">OK</span>;
}

function stockColor(status: "bajo" | "justo" | "ok") {
  if (status === "bajo") return "text-red-400";
  if (status === "justo") return "text-amber-400";
  return "text-emerald-400";
}

// ─── Page Component ─────────────────────────

export default function InventarioPage() {
  const { sections } = useFarm();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [filterCat, setFilterCat] = useState("todos");
  const [formMode, setFormMode] = useState<"none" | "add-item" | "compra" | "uso">("none");
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

  const loadItems = useCallback(async () => {
    try {
      const res = await fetch("/api/inventory");
      if (res.ok) setItems(await res.json());
    } catch (e) {
      console.error("Load inventory error:", e);
    }
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  function resetItemForm() {
    setItemName(""); setItemCategory("alimento"); setItemUnit("kg");
    setItemMinStock(""); setItemNotes("");
  }

  function resetMovForm() {
    setMovItemId(""); setMovQuantity(""); setMovUnitCost("");
    setMovSectionId(""); setMovDate(""); setMovNotes("");
  }

  function closeForm() {
    setFormMode("none"); resetItemForm(); resetMovForm();
  }

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
    closeForm(); setSaving(false); await loadItems();
  }

  async function saveMovement() {
    if (!movItemId || !movQuantity) return;
    setSaving(true);
    const isUso = formMode === "uso";
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
      alert(err.error || "Error al registrar movimiento");
      setSaving(false);
      return;
    }

    closeForm(); setSaving(false); await loadItems();
  }

  async function deleteItem(id: string) {
    await fetch("/api/inventory", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    await loadItems();
  }

  // ─── Derived data ─────────────────────────

  const lowStockItems = items.filter((i) => i.min_stock && i.current_stock < i.min_stock);
  const filtered = filterCat === "todos" ? items : items.filter((i) => i.category === filterCat);
  const totalValue = items.reduce((sum, i) => sum + i.current_stock * (i.cost_per_unit || 0), 0);

  return (
    <div className="space-y-6">
      {/* Low stock alert */}
      {lowStockItems.length > 0 && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
          <div className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-1">
            ⚠️ Stock bajo ({lowStockItems.length} items)
          </div>
          <div className="flex flex-wrap gap-1.5">
            {lowStockItems.map((i) => (
              <span key={i.id} className="tag tag-red text-xs">
                {CATEGORY_EMOJI[i.category] || "📦"} {i.name}: {i.current_stock} {i.unit} (min {i.min_stock})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Items totales" value={items.length} accent="blue" />
        <StatCard label="Stock bajo" value={lowStockItems.length} accent="red" />
        <StatCard label="Categorias" value={new Set(items.map((i) => i.category)).size} accent="purple" />
        <StatCard label="Valor total" value={`$${totalValue.toLocaleString()}`} accent="emerald" />
      </div>

      {/* Category filter pills */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setFilterCat("todos")}
          className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
            filterCat === "todos"
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
          }`}
        >
          Todos
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.value}
            onClick={() => setFilterCat(cat.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              filterCat === cat.value
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
            }`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Action buttons + inventory table */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">Inventario</h3>
          <div className="flex gap-2">
            <button onClick={() => { resetItemForm(); setFormMode("add-item"); }} className="btn-primary text-xs">
              + Nuevo Item
            </button>
            <button onClick={() => { resetMovForm(); setFormMode("compra"); }} className="btn-primary text-xs">
              📥 Registrar Compra
            </button>
            <button onClick={() => { resetMovForm(); setFormMode("uso"); }} className="btn-primary text-xs">
              📤 Registrar Uso
            </button>
          </div>
        </div>

        {/* New Item Form */}
        {formMode === "add-item" && (
          <div className="card p-4 mb-4 space-y-3 border-emerald-500/20">
            <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">Nuevo item</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Input label="Nombre" value={itemName} onChange={setItemName} placeholder="Ej: Glifosato" />
              <Select label="Categoria" value={itemCategory} onChange={setItemCategory}
                options={CATEGORIES.map((c) => [c.value, c.label])} />
              <Select label="Unidad" value={itemUnit} onChange={setItemUnit}
                options={UNITS.map((u) => [u, u])} />
              <Input label="Stock minimo" value={itemMinStock} onChange={setItemMinStock} type="number" placeholder="10" />
            </div>
            <Input label="Notas" value={itemNotes} onChange={setItemNotes} placeholder="Observaciones..." />
            <div className="flex gap-2">
              <button onClick={saveItem} disabled={saving} className="btn-primary text-sm">
                {saving ? "Guardando..." : "Crear item"}
              </button>
              <button onClick={closeForm} className="btn-ghost text-sm">Cancelar</button>
            </div>
          </div>
        )}

        {/* Compra Form */}
        {formMode === "compra" && (
          <div className="card p-4 mb-4 space-y-3 border-blue-500/20">
            <h4 className="text-xs font-semibold text-blue-400 uppercase tracking-wider">Registrar compra</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Select label="Item" value={movItemId} onChange={setMovItemId}
                options={items.map((i) => [i.id, `${CATEGORY_EMOJI[i.category] || "📦"} ${i.name}`])}
                placeholder="Elegir item..." />
              <Input label="Cantidad" value={movQuantity} onChange={setMovQuantity} type="number" placeholder="100" />
              <Input label="Costo por unidad ($)" value={movUnitCost} onChange={setMovUnitCost} type="number" placeholder="5.50" />
              <Input label="Fecha" value={movDate} onChange={setMovDate} type="date" />
            </div>
            <Input label="Notas" value={movNotes} onChange={setMovNotes} placeholder="Proveedor, factura..." />
            <div className="flex gap-2">
              <button onClick={saveMovement} disabled={saving} className="btn-primary text-sm">
                {saving ? "Guardando..." : "Registrar compra"}
              </button>
              <button onClick={closeForm} className="btn-ghost text-sm">Cancelar</button>
            </div>
          </div>
        )}

        {/* Uso Form */}
        {formMode === "uso" && (
          <div className="card p-4 mb-4 space-y-3 border-amber-500/20">
            <h4 className="text-xs font-semibold text-amber-400 uppercase tracking-wider">Registrar uso</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Select label="Item" value={movItemId} onChange={setMovItemId}
                options={items.map((i) => [i.id, `${CATEGORY_EMOJI[i.category] || "📦"} ${i.name} (${i.current_stock} ${i.unit})`])}
                placeholder="Elegir item..." />
              <Input label="Cantidad" value={movQuantity} onChange={setMovQuantity} type="number" placeholder="10" />
              <Select label="Seccion" value={movSectionId} onChange={setMovSectionId}
                options={sections.map((s) => [s.id, s.name])} placeholder="Elegir seccion..." />
              <Input label="Fecha" value={movDate} onChange={setMovDate} type="date" />
            </div>
            <Input label="Notas" value={movNotes} onChange={setMovNotes} placeholder="Observaciones..." />
            <div className="flex gap-2">
              <button onClick={saveMovement} disabled={saving} className="btn-primary text-sm">
                {saving ? "Guardando..." : "Registrar uso"}
              </button>
              <button onClick={closeForm} className="btn-ghost text-sm">Cancelar</button>
            </div>
          </div>
        )}

        {/* Inventory table */}
        {filtered.length === 0 ? (
          <EmptyState icon="📦" message="Sin items en inventario — Agrega tu primer insumo." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-left text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="pb-2 pr-3">Item</th>
                  <th className="pb-2 pr-3">Stock</th>
                  <th className="pb-2 pr-3">Minimo</th>
                  <th className="pb-2 pr-3">$/unidad</th>
                  <th className="pb-2 pr-3">Estado</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const status = getStockStatus(item);
                  return (
                    <tr key={item.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                      <td className="py-2.5 pr-3">
                        <span className="mr-1.5">{CATEGORY_EMOJI[item.category] || "📦"}</span>
                        <span className="font-medium text-zinc-200">{item.name}</span>
                        {item.notes && <span className="text-zinc-600 text-xs ml-1.5">({item.notes})</span>}
                      </td>
                      <td className={`py-2.5 pr-3 font-mono font-medium ${stockColor(status)}`}>
                        {item.current_stock} {item.unit}
                      </td>
                      <td className="py-2.5 pr-3 text-zinc-500">
                        {item.min_stock != null ? `${item.min_stock} ${item.unit}` : "—"}
                      </td>
                      <td className="py-2.5 pr-3 text-zinc-400">
                        {item.cost_per_unit != null ? `$${item.cost_per_unit}` : "—"}
                      </td>
                      <td className="py-2.5 pr-3">
                        {statusTag(status)}
                      </td>
                      <td className="py-2.5 text-right">
                        <button onClick={() => deleteItem(item.id)} className="text-zinc-600 hover:text-red-400 text-xs transition-colors">
                          Eliminar
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
