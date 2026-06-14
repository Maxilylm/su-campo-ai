"use client";

import { useState, useEffect, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { LoadingPage } from "@/components/LoadingPage";
import { Button } from "@/components/ui/button";
import { Printer } from "lucide-react";
import {
  sumCattleByCategory, totalHead, summarizeFinances, valuateInventory,
  type CattleRow, type TxRow, type InvRow,
} from "@/lib/reports";

type ReportType = "hacienda" | "finanzas" | "inventario";

const TABS: { value: ReportType; label: string }[] = [
  { value: "hacienda", label: "Inventario de hacienda" },
  { value: "finanzas", label: "Resumen financiero" },
  { value: "inventario", label: "Valuación de inventario" },
];

const money = (n: number) => `$${n.toLocaleString("es-AR")}`;

export default function ReportesPage() {
  const { farm } = useFarm();
  const [tab, setTab] = useState<ReportType>("hacienda");
  const [cattle, setCattle] = useState<CattleRow[]>([]);
  const [tx, setTx] = useState<TxRow[]>([]);
  const [inv, setInv] = useState<InvRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [secRes, finRes, invRes] = await Promise.all([
        fetch("/api/sections").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/financial?period=year").then((r) => (r.ok ? r.json() : [])),
        fetch("/api/inventory").then((r) => (r.ok ? r.json() : [])),
      ]);
      const flatCattle = (Array.isArray(secRes) ? secRes : []).flatMap(
        (s: { cattle?: CattleRow[] }) => s.cattle || []
      );
      setCattle(flatCattle);
      setTx(Array.isArray(finRes) ? finRes : []);
      setInv(Array.isArray(invRes) ? invRes : []);
    } catch (e) {
      console.error("Load reportes error:", e);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!loaded) return <LoadingPage />;

  const byCat = sumCattleByCategory(cattle);
  const fin = summarizeFinances(tx);
  const val = valuateInventory(inv);
  const today = new Date().toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
  const tabEmpty =
    (tab === "hacienda" && byCat.length === 0) ||
    (tab === "finanzas" && tx.length === 0) ||
    (tab === "inventario" && val.rows.length === 0);

  return (
    <main className="flex-1 w-full max-w-4xl mx-auto px-6 py-6">
      <div className="no-print">
        <PageHeader
          breadcrumbs={[{ label: "Gestion", href: "/gestion/inventario" }, { label: "Reportes" }]}
          title="Reportes"
          description="Generá reportes imprimibles para ventas, veterinario o contador."
          actions={
            <Button onClick={() => window.print()}>
              <Printer className="mr-2 h-4 w-4" /> Imprimir / PDF
            </Button>
          }
        />
        <div className="flex gap-2 mb-6 flex-wrap">
          {TABS.map((t) => (
            <button
              key={t.value}
              onClick={() => setTab(t.value)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                tab === t.value ? "border-primary bg-primary/10 text-primary" : "border-border hover:bg-accent"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="print-area rounded-xl border border-border bg-card p-6 print:border-0 print:p-0">
        <div className="mb-6 border-b border-border pb-4">
          <h2 className="text-xl font-semibold">{TABS.find((t) => t.value === tab)?.label}</h2>
          <p className="text-sm text-muted-foreground">{farm?.name} · {today}</p>
        </div>

        {tabEmpty && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No hay datos para este reporte todavía.
          </p>
        )}

        {tab === "hacienda" && !tabEmpty && (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2">Categoría</th><th className="py-2 text-right">Cabezas</th>
            </tr></thead>
            <tbody>
              {byCat.map((r) => (
                <tr key={r.category} className="border-b border-border/50">
                  <td className="py-2 capitalize">{r.category}</td>
                  <td className="py-2 text-right tabular-nums">{r.count}</td>
                </tr>
              ))}
              <tr className="font-semibold"><td className="py-2">Total</td><td className="py-2 text-right tabular-nums">{totalHead(cattle)}</td></tr>
            </tbody>
          </table>
        )}

        {tab === "finanzas" && !tabEmpty && (
          <>
            <div className="grid grid-cols-3 gap-4 mb-6">
              <div><p className="text-xs text-muted-foreground">Ingresos</p><p className="text-lg font-semibold text-emerald-600">{money(fin.income)}</p></div>
              <div><p className="text-xs text-muted-foreground">Egresos</p><p className="text-lg font-semibold text-red-600">{money(fin.expense)}</p></div>
              <div><p className="text-xs text-muted-foreground">Resultado</p><p className="text-lg font-semibold">{money(fin.net)}</p></div>
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2">Categoría</th><th className="py-2 text-right">Ingresos</th><th className="py-2 text-right">Egresos</th>
              </tr></thead>
              <tbody>
                {fin.byCategory.map((c) => (
                  <tr key={c.category} className="border-b border-border/50">
                    <td className="py-2">{c.category.replace(/_/g, " ")}</td>
                    <td className="py-2 text-right tabular-nums">{c.income ? money(c.income) : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{c.expense ? money(c.expense) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}

        {tab === "inventario" && !tabEmpty && (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-muted-foreground border-b border-border">
              <th className="py-2">Ítem</th><th className="py-2 text-right">Stock</th><th className="py-2 text-right">Costo unit.</th><th className="py-2 text-right">Valor</th>
            </tr></thead>
            <tbody>
              {val.rows.map((r) => (
                <tr key={r.name} className="border-b border-border/50">
                  <td className="py-2">{r.name}</td>
                  <td className="py-2 text-right tabular-nums">{r.stock} {r.unit}</td>
                  <td className="py-2 text-right tabular-nums">{r.cost ? money(r.cost) : "—"}</td>
                  <td className="py-2 text-right tabular-nums">{money(r.value)}</td>
                </tr>
              ))}
              <tr className="font-semibold"><td className="py-2" colSpan={3}>Valor total</td><td className="py-2 text-right tabular-nums">{money(val.total)}</td></tr>
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
