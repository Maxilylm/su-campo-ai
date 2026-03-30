"use client";

import { useState, useEffect, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { Input } from "@/components/Input";
import { StatCard } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";

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

// ─── Select Component ───────────────────────

function Select({
  label,
  value,
  onChange,
  options,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[][];
  placeholder?: string;
}) {
  return (
    <div>
      <label className="input-label">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="input-field"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(([val, lbl]) => (
          <option key={val} value={val}>
            {lbl}
          </option>
        ))}
      </select>
    </div>
  );
}

// ─── Page Component ─────────────────────────

export default function FinanzasPage() {
  const { sections } = useFarm();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [cattle, setCattle] = useState<CattleBatch[]>([]);
  const [crops, setCrops] = useState<Crop[]>([]);
  const [period, setPeriod] = useState("30d");
  const [showForm, setShowForm] = useState(false);
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

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  useEffect(() => {
    loadCattle();
    loadCrops();
  }, [loadCattle, loadCrops]);

  function resetForm() {
    setFType("egreso");
    setFCategory("otro");
    setFDescription("");
    setFAmount("");
    setFCurrency("USD");
    setFDate("");
    setFSectionId("");
    setFCropId("");
    setFCattleId("");
    setFNotes("");
  }

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
    setShowForm(false);
    resetForm();
    setSaving(false);
    await loadTransactions();
  }

  async function deleteTransaction(id: string) {
    await fetch("/api/financial", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
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
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex flex-wrap gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => setPeriod(p.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              period === p.value
                ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <StatCard
          label="Ingresos"
          value={`$${income.toLocaleString()}`}
          accent="emerald"
        />
        <StatCard
          label="Egresos"
          value={`$${expenses.toLocaleString()}`}
          accent="red"
        />
        <StatCard
          label="Resultado"
          value={`${result >= 0 ? "+" : ""}$${result.toLocaleString()}`}
          accent="amber"
        />
      </div>

      {/* Cost-per-unit breakdown */}
      {allCostUnits.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Costo por unidad
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {allCostUnits.map((item, i) => (
              <div
                key={i}
                className="rounded-xl border border-zinc-700 bg-zinc-900/50 p-3"
              >
                <div className="text-sm font-medium text-zinc-200 mb-1">
                  {item.label}
                </div>
                <div className="text-xs text-zinc-500 mb-2">
                  {item.count} {item.unit}
                  {item.count !== 1 ? "s" : ""}
                </div>
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-zinc-500">Total</span>
                  <span className="text-sm font-mono text-red-400">
                    ${item.totalCost.toLocaleString()}
                  </span>
                </div>
                <div className="flex items-baseline justify-between mt-1">
                  <span className="text-xs text-zinc-500">
                    Por {item.unit}
                  </span>
                  <span className="text-sm font-mono text-amber-400">
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
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider">
            Transacciones
          </h3>
          <button
            onClick={() => {
              resetForm();
              setShowForm(true);
            }}
            className="btn-primary text-xs"
          >
            + Nueva Transaccion
          </button>
        </div>

        {/* New transaction form */}
        {showForm && (
          <div className="card p-4 mb-4 space-y-3 border-emerald-500/20">
            <h4 className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
              Nueva transaccion
            </h4>

            {/* Type radio */}
            <div className="flex gap-3">
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="txType"
                  checked={fType === "ingreso"}
                  onChange={() => setFType("ingreso")}
                  className="accent-emerald-500"
                />
                <span className="text-sm text-emerald-400">Ingreso</span>
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="radio"
                  name="txType"
                  checked={fType === "egreso"}
                  onChange={() => setFType("egreso")}
                  className="accent-red-500"
                />
                <span className="text-sm text-red-400">Egreso</span>
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              <Select
                label="Categoria"
                value={fCategory}
                onChange={setFCategory}
                options={CATEGORIES.map((c) => [c.value, c.label])}
              />
              <Input
                label="Descripcion"
                value={fDescription}
                onChange={setFDescription}
                placeholder="Ej: Venta de novillos"
              />
              <Input
                label="Monto"
                value={fAmount}
                onChange={setFAmount}
                type="number"
                placeholder="1000"
              />
              <Select
                label="Moneda"
                value={fCurrency}
                onChange={setFCurrency}
                options={CURRENCIES.map((c) => [c, c])}
              />
              <Input
                label="Fecha"
                value={fDate}
                onChange={setFDate}
                type="date"
              />
              <Select
                label="Seccion (opcional)"
                value={fSectionId}
                onChange={setFSectionId}
                options={sections.map((s) => [s.id, s.name])}
                placeholder="Sin asignar"
              />
              <Select
                label="Cultivo (opcional)"
                value={fCropId}
                onChange={setFCropId}
                options={crops.map((c) => [c.id, c.crop_type])}
                placeholder="Sin asignar"
              />
              <Select
                label="Hacienda (opcional)"
                value={fCattleId}
                onChange={setFCattleId}
                options={cattle.map((c) => [
                  c.id,
                  `${c.category}${c.breed ? ` (${c.breed})` : ""}`,
                ])}
                placeholder="Sin asignar"
              />
            </div>
            <Input
              label="Notas"
              value={fNotes}
              onChange={setFNotes}
              placeholder="Observaciones..."
            />
            <div className="flex gap-2">
              <button
                onClick={saveTransaction}
                disabled={saving}
                className="btn-primary text-sm"
              >
                {saving ? "Guardando..." : "Guardar"}
              </button>
              <button
                onClick={() => {
                  setShowForm(false);
                  resetForm();
                }}
                className="btn-ghost text-sm"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {/* Transaction rows */}
        {transactions.length === 0 ? (
          <EmptyState
            icon="💰"
            message="Sin transacciones en este periodo — Registra tu primer movimiento."
          />
        ) : (
          <div className="space-y-2">
            {transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/50 px-3 py-2.5 hover:bg-zinc-800/30 transition-colors"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className={`text-lg ${
                      tx.type === "ingreso"
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    {tx.type === "ingreso" ? "▲" : "▼"}
                  </span>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-zinc-200 truncate">
                      {tx.description || CATEGORY_LABELS[tx.category] || tx.category}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="tag tag-zinc text-xs">
                        {CATEGORY_LABELS[tx.category] || tx.category}
                      </span>
                      <span className="text-xs text-zinc-600">
                        {tx.date}
                      </span>
                      {tx.sections?.name && (
                        <span className="text-xs text-zinc-600">
                          {tx.sections.name}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span
                    className={`text-sm font-mono font-medium ${
                      tx.type === "ingreso"
                        ? "text-emerald-400"
                        : "text-red-400"
                    }`}
                  >
                    {tx.type === "ingreso" ? "+" : "-"}${tx.amount.toLocaleString()}{" "}
                    {tx.currency}
                  </span>
                  <button
                    onClick={() => deleteTransaction(tx.id)}
                    className="text-zinc-600 hover:text-red-400 text-xs transition-colors"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
