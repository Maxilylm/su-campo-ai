"use client";

import { useState, useEffect, useCallback } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Printer, RefreshCw } from "lucide-react";
import {
  sumCattleByCategory, totalHead, summarizeFinances, valuateInventory,
  summarizeFinancesBySection,
  type CattleRow, type TxRow, type InvRow,
} from "@/lib/reports";
import { fetchWithTimeout } from "@/lib/fetch";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";

type ReportType = "hacienda" | "finanzas" | "inventario" | "rentabilidad";

const TABS: { value: ReportType; label: string }[] = [
  { value: "hacienda", label: "Inventario de hacienda" },
  { value: "finanzas", label: "Resumen financiero" },
  { value: "inventario", label: "Valuación de inventario" },
  { value: "rentabilidad", label: "Resultado por sección" },
];

const money = (n: number, currency = "USD") => `${currency} ${n.toLocaleString("es-AR")}`;

export default function ReportesPage() {
  const { farm, offlineMode, isOnline } = useFarm();
  const [tab, setTab] = useState<ReportType>("hacienda");
  const [cattle, setCattle] = useState<CattleRow[]>([]);
  const [tx, setTx] = useState<TxRow[]>([]);
  const [inv, setInv] = useState<InvRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (offlineMode || !isOnline) {
      setError("Los reportes requieren conexión.");
      setLoaded(true);
      return;
    }
    setLoaded(false);
    setError(null);
    try {
      const response = await fetchWithTimeout("/api/reports?period=year", {}, 10_000);
      const payload = await response.json().catch(() => null) as { cattle?: unknown; transactions?: unknown; inventory?: unknown; error?: string } | null;
      if (!response.ok) {
        const message = payload && typeof payload.error === "string"
          ? payload.error
          : "No se pudieron cargar todos los reportes.";
        throw new Error(message);
      }
      if (!payload || !Array.isArray(payload.cattle) || !Array.isArray(payload.transactions) || !Array.isArray(payload.inventory)) {
        throw new Error("La respuesta de reportes está incompleta.");
      }
      setCattle(payload.cattle as CattleRow[]);
      setTx(payload.transactions as TxRow[]);
      setInv(payload.inventory as InvRow[]);
    } catch (e) {
      console.error("Load reportes error:", e);
      setError(e instanceof Error ? e.message : "No se pudieron cargar todos los reportes.");
    } finally {
      setLoaded(true);
    }
  }, [isOnline, offlineMode]);

  useEffect(() => { load(); }, [load]);
  useDataChangedRefresh(load, !offlineMode && isOnline);

  async function refreshReports() {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }

  if (!loaded) return <LoadingPage />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader breadcrumbs={[{ label: "Gestion", href: "/gestion/inventario" }, { label: "Reportes" }]} title="Reportes" description="Generá reportes imprimibles para ventas, veterinario o contador." />
        <EmptyState icon={AlertTriangle} title="No se pudieron cargar los reportes" description={error || "Revisá tu conexión e intentá nuevamente."} actionLabel="Reintentar" onAction={load} />
      </div>
    );
  }

  const byCat = sumCattleByCategory(cattle);
  const fin = summarizeFinances(tx);
  const bySection = summarizeFinancesBySection(tx);
  const val = valuateInventory(inv);
  const today = new Date().toLocaleDateString("es-AR", { day: "numeric", month: "long", year: "numeric" });
  const tabEmpty =
    (tab === "hacienda" && byCat.length === 0) ||
    (tab === "finanzas" && tx.length === 0) ||
    (tab === "inventario" && val.rows.length === 0) ||
    (tab === "rentabilidad" && bySection.length === 0);

  return (
    <main className="flex-1 w-full max-w-4xl mx-auto px-6 py-6">
      <div className="no-print">
        <PageHeader
          breadcrumbs={[{ label: "Gestion", href: "/gestion/inventario" }, { label: "Reportes" }]}
          title="Reportes"
          description="Generá reportes imprimibles para ventas, veterinario o contador."
          actions={
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => void refreshReports()} disabled={refreshing}>
                <RefreshCw className={`mr-2 h-4 w-4 ${refreshing ? "animate-spin" : ""}`} /> Actualizar
              </Button>
              <Button onClick={() => window.print()}>
                <Printer className="mr-2 h-4 w-4" /> Imprimir / PDF
              </Button>
            </div>
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
            <div className="space-y-3 mb-6">
              {fin.byCurrency.map((summary) => (
                <div key={summary.currency} className="grid grid-cols-3 gap-4 rounded-lg border border-border/60 p-3">
                  <div><p className="text-xs text-muted-foreground">Ingresos ({summary.currency})</p><p className="text-lg font-semibold text-emerald-600">{money(summary.income, summary.currency)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Egresos ({summary.currency})</p><p className="text-lg font-semibold text-red-600">{money(summary.expense, summary.currency)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Resultado ({summary.currency})</p><p className="text-lg font-semibold">{money(summary.net, summary.currency)}</p></div>
                </div>
              ))}
            </div>
            <table className="w-full text-sm">
              <thead><tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-2">Categoría</th><th className="py-2">Moneda</th><th className="py-2 text-right">Ingresos</th><th className="py-2 text-right">Egresos</th>
              </tr></thead>
              <tbody>
                {fin.byCategory.map((c) => (
                  <tr key={`${c.currency}-${c.category}`} className="border-b border-border/50">
                    <td className="py-2">{c.category.replace(/_/g, " ")}</td>
                    <td className="py-2">{c.currency}</td>
                    <td className="py-2 text-right tabular-nums">{c.income ? money(c.income, c.currency) : "—"}</td>
                    <td className="py-2 text-right tabular-nums">{c.expense ? money(c.expense, c.currency) : "—"}</td>
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
                  <td className="py-2 text-right tabular-nums">{r.cost ? money(r.cost, r.currency) : "—"}</td>
                  <td className="py-2 text-right tabular-nums">{money(r.value, r.currency)}</td>
                </tr>
              ))}
              {val.byCurrency.map((summary) => (
                <tr key={summary.currency} className="font-semibold">
                  <td className="py-2" colSpan={3}>Valor total ({summary.currency})</td>
                  <td className="py-2 text-right tabular-nums">{money(summary.total, summary.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {tab === "rentabilidad" && !tabEmpty && (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Ingresos y egresos del último año agrupados por sección y moneda. Los movimientos sin vínculo aparecen como “Sin asignar”.
            </p>
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left text-muted-foreground">
                <th className="py-2">Sección</th><th className="py-2">Moneda</th><th className="py-2 text-right">Ingresos</th><th className="py-2 text-right">Egresos</th><th className="py-2 text-right">Resultado</th>
              </tr></thead>
              <tbody>
                {bySection.map((row) => (
                  <tr key={`${row.sectionId}-${row.currency}`} className="border-b border-border/50">
                    <td className="py-2">{row.sectionName}</td>
                    <td className="py-2">{row.currency}</td>
                    <td className="py-2 text-right tabular-nums text-emerald-600">{row.income ? money(row.income, row.currency) : "—"}</td>
                    <td className="py-2 text-right tabular-nums text-red-600">{row.expense ? money(row.expense, row.currency) : "—"}</td>
                    <td className={`py-2 text-right tabular-nums font-medium ${row.net >= 0 ? "text-emerald-600" : "text-red-600"}`}>{money(row.net, row.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>
    </main>
  );
}
