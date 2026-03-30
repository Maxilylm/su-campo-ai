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
import {
  Sheet, SheetContent, SheetDescription, SheetFooter,
  SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  TrendingUp, TrendingDown, BarChart3, DollarSign, Plus,
  MoreHorizontal, Trash2,
} from "lucide-react";

// ─── Types ──────────────────────────────────

interface Transaction {
  id: string;
  type: "ingreso" | "egreso";
  category: string;
  description: string | null;
  amount: number;
  currency: string;
  date: string;
  section_id: string | null;
  crop_id: string | null;
  cattle_id: string | null;
  notes: string | null;
  sections: { name: string } | null;
  crops: { crop_type: string } | null;
  cattle: { category: string; breed: string | null } | null;
}

interface CattleBatch {
  id: string;
  category: string;
  breed: string | null;
  count: number;
}

interface Crop {
  id: string;
  crop_type: string;
  planted_hectares: number | null;
}

// ─── Constants ──────────────────────────────

const PERIODS = [
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
  { value: "90d", label: "90d" },
  { value: "year", label: "Ano" },
];

const CATEGORIES = [
  { value: "venta_ganado", label: "Venta ganado" },
  { value: "venta_cosecha", label: "Venta cosecha" },
  { value: "compra_insumo", label: "Compra insumo" },
  { value: "servicio", label: "Servicio" },
  { value: "mano_obra", label: "Mano de obra" },
  { value: "transporte", label: "Transporte" },
  { value: "veterinario", label: "Veterinario" },
  { value: "maquinaria", label: "Maquinaria" },
  { value: "otro", label: "Otro" },
];

const CATEGORY_LABELS: Record<string, string> = {
  venta_ganado: "Venta ganado",
  venta_cosecha: "Venta cosecha",
  compra_insumo: "Compra insumo",
  servicio: "Servicio",
  mano_obra: "Mano de obra",
  transporte: "Transporte",
  veterinario: "Veterinario",
  maquinaria: "Maquinaria",
  otro: "Otro",
};

const CURRENCIES = ["USD", "UYU", "ARS"];

// ─── Page Component ─────────────────────────

export default function FinanzasPage() {
  const { sections } = useFarm();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cattle, setCattle] = useState<CattleBatch[]>([]);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [period, setPeriod] = useState("30d");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form state
  const [fType, setFType] = useState<"ingreso" | "egreso">("egreso");
  const [fCategory, setFCategory] = useState("otro");
  const [fDescription, setFDescription] = useState("");
  const [fAmount, setFAmount] = useState("");
  const [fCurrency, setFCurrency] = useState("USD");
  const [fDate, setFDate] = useState("");
  const [fSectionId, setFSectionId] = useState("");
  const [fCropId, setFCropId] = useState("");
  const [fCattleId, setFCattleId] = useState("");
  const [fNotes, setFNotes] = useState("");

  const loadTransactions = useCallback(async () => {
    try {
      const res = await fetch(`/api/financial?period=${period}`);
      if (res.ok) setTransactions(await res.json());
    } catch (e) {
      console.error("Load financial error:", e);
    }
  }, [period]);

  const loadCattle = useCallback(async () => {
    try {
      const res = await fetch("/api/cattle");
      if (res.ok) setCattle(await res.json());
    } catch (e) {
      console.error("Load cattle error:", e);
    }
  }, []);

  const loadCrops = useCallback(async () => {
    try {
      const res = await fetch("/api/crops");
      if (res.ok) setCrops(await res.json());
    } catch (e) {
      console.error("Load crops error:", e);
    }
  }, []);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);
  useEffect(() => { loadCattle(); loadCrops(); }, [loadCattle, loadCrops]);

  function resetForm() {
    setFType("egreso"); setFCategory("otro"); setFDescription("");
    setFAmount(""); setFCurrency("USD"); setFDate("");
    setFSectionId(""); setFCropId(""); setFCattleId(""); setFNotes("");
  }

  function openNewTransaction() { resetForm(); setSheetOpen(true); }

  async function saveTransaction() {
    if (!fAmount || Number(fAmount) <= 0) return;
    setSaving(true);
    await fetch("/api/financial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: fType,
        category: fCategory,
        description: fDescription || null,
        amount: Number(fAmount),
        currency: fCurrency,
        date: fDate || null,
        sectionId: fSectionId || null,
        cropId: fCropId || null,
        cattleId: fCattleId || null,
        notes: fNotes || null,
      }),
    });
    toast.success("Transaccion guardada");
    setSheetOpen(false); resetForm(); setSaving(false);
    await loadTransactions();
  }

  async function deleteTransaction(id: string) {
    await fetch("/api/financial", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    toast.success("Transaccion eliminada");
    await loadTransactions();
  }

  // ─── Derived data ─────────────────────────

  const income = transactions
    .filter((t) => t.type === "ingreso")
    .reduce((s, t) => s + t.amount, 0);
  const expenses = transactions
    .filter((t) => t.type === "egreso")
    .reduce((s, t) => s + t.amount, 0);
  const result = income - expenses;

  // Cost-per-unit: cattle
  const cattleCosts = cattle.map((batch) => {
    const allocated = transactions
      .filter((t) => t.type === "egreso" && t.cattle_id === batch.id)
      .reduce((s, t) => s + t.amount, 0);
    return {
      label: `${batch.category}${batch.breed ? ` (${batch.breed})` : ""}`,
      totalCost: allocated,
      perUnit: batch.count > 0 ? allocated / batch.count : 0,
      unit: "cabeza",
      count: batch.count,
    };
  }).filter((c) => c.totalCost > 0);

  // Cost-per-unit: crops
  const cropCosts = crops.map((crop) => {
    const allocated = transactions
      .filter((t) => t.type === "egreso" && t.crop_id === crop.id)
      .reduce((s, t) => s + t.amount, 0);
    return {
      label: crop.crop_type,
      totalCost: allocated,
      perUnit: crop.planted_hectares && crop.planted_hectares > 0
        ? allocated / crop.planted_hectares
        : 0,
      unit: "ha",
      count: crop.planted_hectares || 0,
    };
  }).filter((c) => c.totalCost > 0);

  const allCostUnits = [...cattleCosts, ...cropCosts];

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={[{ label: "Gestion", href: "/gestion/inventario" }, { label: "Finanzas" }]}
        title="Finanzas"
        description="Ingresos, egresos y analisis de costos"
        actions={
          <Button onClick={openNewTransaction}><Plus className="h-4 w-4 mr-1.5" />Nueva Transaccion</Button>
        }
      />

      {/* Period selector */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <Button
            key={p.value}
            variant={period === p.value ? "secondary" : "outline"}
            size="sm"
            onClick={() => setPeriod(p.value)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Ingresos" value={`$${income.toLocaleString()}`} accent="emerald" icon={TrendingUp} />
        <StatCard label="Egresos" value={`$${expenses.toLocaleString()}`} accent="red" icon={TrendingDown} />
        <StatCard label="Resultado" value={`${result >= 0 ? "+" : ""}$${result.toLocaleString()}`} accent="amber" icon={BarChart3} />
      </div>

      {/* Cost-per-unit breakdown */}
      {allCostUnits.length > 0 && (
        <div>
          <h2 className="text-lg font-medium mb-4">Costo por unidad</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allCostUnits.map((item, i) => (
              <div key={i} className="rounded-xl bg-card border border-border p-5">
                <div className="text-sm font-medium mb-1">{item.label}</div>
                <div className="text-xs text-muted-foreground mb-3">
                  {item.count} {item.unit}{item.count !== 1 ? "s" : ""}
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-muted-foreground">Total</span>
                  <span className="text-sm font-mono text-red-600 dark:text-red-400">
                    ${item.totalCost.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-xs text-muted-foreground">Por {item.unit}</span>
                  <span className="text-sm font-mono text-amber-600 dark:text-amber-400">
                    ${item.perUnit.toFixed(2)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Transactions list */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-medium">Transacciones</h2>
          <span className="text-xs text-muted-foreground">{transactions.length} registros</span>
        </div>

        {transactions.length === 0 ? (
          <EmptyState
            icon={DollarSign}
            title="Sin transacciones"
            description="Registra tu primer movimiento financiero."
            actionLabel="Nueva transaccion"
            onAction={openNewTransaction}
          />
        ) : (
          <div className="space-y-2">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between rounded-xl bg-card border border-border px-4 py-3 hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {tx.type === "ingreso" ? (
                    <TrendingUp className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  ) : (
                    <TrendingDown className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">
                      {tx.description || CATEGORY_LABELS[tx.category] || tx.category}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className="text-xs">
                        {CATEGORY_LABELS[tx.category] || tx.category}
                      </Badge>
                      <span className="text-xs text-muted-foreground">{tx.date}</span>
                      {tx.sections?.name && (
                        <span className="text-xs text-muted-foreground">{tx.sections.name}</span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`text-sm font-mono font-medium ${
                      tx.type === "ingreso"
                        ? "text-emerald-600 dark:text-emerald-400"
                        : "text-red-600 dark:text-red-400"
                    }`}
                  >
                    {tx.type === "ingreso" ? "+" : "-"}${tx.amount.toLocaleString()} {tx.currency}
                  </span>
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
                        title="Eliminar transaccion"
                        description="Esta accion no se puede deshacer."
                        onConfirm={() => deleteTransaction(tx.id)}
                      />
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Sheet for new transaction */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent className="overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Nueva transaccion</SheetTitle>
            <SheetDescription>Registra un ingreso o egreso.</SheetDescription>
          </SheetHeader>
          <div className="space-y-4 py-6">
            {/* Type radio */}
            <div className="space-y-2">
              <Label>Tipo</Label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="txType"
                    checked={fType === "ingreso"}
                    onChange={() => setFType("ingreso")}
                    className="accent-emerald-500"
                  />
                  <span className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">Ingreso</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="txType"
                    checked={fType === "egreso"}
                    onChange={() => setFType("egreso")}
                    className="accent-red-500"
                  />
                  <span className="text-sm text-red-600 dark:text-red-400 font-medium">Egreso</span>
                </label>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Categoria</Label>
              <Select value={fCategory} onValueChange={setFCategory}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2"><Label>Descripcion</Label><Input value={fDescription} onChange={(e) => setFDescription(e.target.value)} placeholder="Ej: Venta de novillos" /></div>
            <div className="space-y-2"><Label>Monto</Label><Input type="number" value={fAmount} onChange={(e) => setFAmount(e.target.value)} placeholder="1000" /></div>

            <div className="space-y-2">
              <Label>Moneda</Label>
              <Select value={fCurrency} onValueChange={setFCurrency}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2"><Label>Fecha</Label><Input type="date" value={fDate} onChange={(e) => setFDate(e.target.value)} /></div>

            <div className="space-y-2">
              <Label>Seccion (opcional)</Label>
              <Select value={fSectionId} onValueChange={setFSectionId}>
                <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                <SelectContent>
                  {sections.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Cultivo (opcional)</Label>
              <Select value={fCropId} onValueChange={setFCropId}>
                <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                <SelectContent>
                  {crops.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.crop_type}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Hacienda (opcional)</Label>
              <Select value={fCattleId} onValueChange={setFCattleId}>
                <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                <SelectContent>
                  {cattle.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.category}{c.breed ? ` (${c.breed})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2"><Label>Notas</Label><Input value={fNotes} onChange={(e) => setFNotes(e.target.value)} placeholder="Observaciones..." /></div>
          </div>
          <SheetFooter>
            <Button variant="outline" onClick={() => setSheetOpen(false)}>Cancelar</Button>
            <Button onClick={saveTransaction} disabled={!fAmount || Number(fAmount) <= 0 || saving}>{saving ? "Guardando..." : "Guardar"}</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
