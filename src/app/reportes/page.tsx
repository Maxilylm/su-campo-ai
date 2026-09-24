"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useFarm } from "@/contexts/FarmContext";
import { PageHeader } from "@/components/PageHeader";
import { StatStrip } from "@/components/StatCard";
import { EmptyState } from "@/components/EmptyState";
import { LoadingPage } from "@/components/LoadingPage";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Printer, RefreshCw, Sparkles } from "lucide-react";
import {
  sumCattleByCategory, totalHead, summarizeFinances, valuateInventory,
  summarizeFinancesBySection,
  type CattleRow, type TxRow, type InvRow,
} from "@/lib/reports";
import { fetchWithTimeout } from "@/lib/fetch";
import { isOfflineSnapshotFresh, offlineEntitySnapshotKey, parseOfflineEntitySnapshot } from "@/lib/offline";
import { useDataChangedRefresh } from "@/lib/use-data-changed-refresh";
import { useOfflineSnapshotRefresh } from "@/lib/use-offline-snapshot-refresh";
import { aiChatHandoffKey, buildReportChatPrompt } from "@/lib/ai-handoff";
import { useOfflineAwareNavigation } from "@/lib/use-offline-aware-navigation";
import { formatMoney } from "@/lib/format";

type ReportType = "hacienda" | "finanzas" | "inventario" | "rentabilidad";

const TABS: { value: ReportType; label: string }[] = [
  { value: "hacienda", label: "Inventario de hacienda" },
  { value: "finanzas", label: "Resumen financiero" },
  { value: "inventario", label: "Valuación de inventario" },
  { value: "rentabilidad", label: "Resultado por sección" },
];

export default function ReportesPage() {
  const { farm, userId, offlineMode, isOnline } = useFarm();
  const navigate = useOfflineAwareNavigation();
  const [tab, setTab] = useState<ReportType>("hacienda");
  const [cattle, setCattle] = useState<CattleRow[]>([]);
  const [tx, setTx] = useState<TxRow[]>([]);
  const [inv, setInv] = useState<InvRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [offlineReportsSavedAt, setOfflineReportsSavedAt] = useState<string | null>(null);
  const [offlineReportsTruncated, setOfflineReportsTruncated] = useState(false);
  const reportRequestId = useRef(0);
  const reportRequestRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    const currentRequest = ++reportRequestId.current;
    reportRequestRef.current?.abort();
    if (offlineMode || !isOnline) {
      let snapshot = null;
      try {
        snapshot = userId
          ? parseOfflineEntitySnapshot(window.localStorage.getItem(offlineEntitySnapshotKey(userId)))
          : null;
      } catch {
        snapshot = null;
      }
      if (snapshot && isOfflineSnapshotFresh(snapshot.savedAt) && Array.isArray(snapshot.financialTransactions)) {
        setCattle(snapshot.cattle as CattleRow[]);
        setTx(snapshot.financialTransactions as TxRow[]);
        setInv(snapshot.inventory as InvRow[]);
        setOfflineReportsSavedAt(snapshot.savedAt);
        setOfflineReportsTruncated(Boolean(snapshot.cattleTruncated || snapshot.financialTruncated || snapshot.inventoryTruncated));
        setError(null);
      } else {
        setOfflineReportsSavedAt(null);
        setOfflineReportsTruncated(false);
        setError("Sincronizá una copia offline desde Mi campo para generar reportes sin conexión.");
      }
      setLoaded(true);
      return;
    }
    setLoaded(false);
    setError(null);
    setOfflineReportsSavedAt(null);
    setOfflineReportsTruncated(false);
    const controller = new AbortController();
    reportRequestRef.current = controller;
    try {
      const response = await fetchWithTimeout("/api/reports?period=year", { cache: "no-store", signal: controller.signal }, 10_000);
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
      if (currentRequest !== reportRequestId.current || controller.signal.aborted) return;
      setCattle(payload.cattle as CattleRow[]);
      setTx(payload.transactions as TxRow[]);
      setInv(payload.inventory as InvRow[]);
    } catch (e) {
      if (controller.signal.aborted) return;
      console.error("Load reportes error:", e);
      if (currentRequest === reportRequestId.current) {
        setError(e instanceof Error ? e.message : "No se pudieron cargar todos los reportes.");
      }
    } finally {
      if (currentRequest === reportRequestId.current) {
        setLoaded(true);
        if (reportRequestRef.current === controller) reportRequestRef.current = null;
      }
    }
  }, [isOnline, offlineMode, userId]);

  useEffect(() => {
    void load();
    return () => {
      reportRequestId.current += 1;
      reportRequestRef.current?.abort();
    };
  }, [load]);
  useDataChangedRefresh(load, !offlineMode && isOnline);
  useOfflineSnapshotRefresh(load, userId, offlineMode || !isOnline);

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
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
        <PageHeader title="Reportes" description="Generá reportes imprimibles para ventas, veterinario o contador." />
        <EmptyState icon={AlertTriangle} title={offlineMode || !isOnline ? "Reportes no disponibles sin conexión" : "No se pudieron cargar los reportes"} description={error || "Revisá tu conexión e intentá nuevamente."} actionLabel={offlineMode || !isOnline ? undefined : "Reintentar"} onAction={offlineMode || !isOnline ? undefined : load} />
      </main>
    );
  }

  const byCat = sumCattleByCategory(cattle);
  const fin = summarizeFinances(tx);
  const bySection = summarizeFinancesBySection(tx);
  const val = valuateInventory(inv);
  const today = new Date().toLocaleDateString("es-UY", { day: "numeric", month: "long", year: "numeric" });
  const tabEmpty =
    (tab === "hacienda" && byCat.length === 0) ||
    (tab === "finanzas" && tx.length === 0) ||
    (tab === "inventario" && val.rows.length === 0) ||
    (tab === "rentabilidad" && bySection.length === 0);

  const reportTitle = TABS.find((t) => t.value === tab)?.label || "reporte";

  function askCampoAI() {
    if (!userId || offlineMode || !isOnline) return;
    const facts = tab === "hacienda"
      ? [
        ...byCat.map((row) => `${row.category}: ${row.count} cabezas`),
        `Total: ${totalHead(cattle)} cabezas`,
      ]
      : tab === "finanzas"
        ? [
          ...fin.byCurrency.map((row) => `${row.currency}: ingresos ${row.income}, egresos ${row.expense}, resultado ${row.net}`),
          ...fin.byCategory.slice(0, 12).map((row) => `${row.currency} · ${row.category}: ingresos ${row.income}, egresos ${row.expense}`),
        ]
        : tab === "inventario"
          ? [
            ...val.rows.slice(0, 20).map((row) => `${row.name}: ${row.stock} ${row.unit}, costo ${row.cost}, valor ${row.value} ${row.currency}`),
            ...val.byCurrency.map((row) => `Total ${row.currency}: ${row.total}`),
          ]
          : bySection.slice(0, 20).map((row) => `${row.sectionName} · ${row.currency}: ingresos ${row.income}, egresos ${row.expense}, resultado ${row.net}`);
    try {
      window.sessionStorage.setItem(aiChatHandoffKey(userId), buildReportChatPrompt({
        title: reportTitle,
        facts,
        partial: offlineReportsTruncated,
      }));
    } catch {
      // Chat remains available even when session storage is unavailable.
    }
    navigate("/chat?from=reports");
  }


  const th = "px-3 py-2 text-xs font-medium text-muted-foreground first:pl-0 last:pr-0";
  const td = "px-3 py-2 first:pl-0 last:pr-0";
  const num = "figure text-right";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 lg:py-8">
      <div className="no-print">
        <PageHeader
          title="Reportes"
          description="Generá reportes imprimibles para ventas, veterinario o contador."
          actions={
            <>
              <Button variant="ghost" onClick={askCampoAI} disabled={offlineMode || !isOnline} title={offlineMode || !isOnline ? "Necesitás conexión para consultar a CampoAI" : undefined}>
                <Sparkles aria-hidden="true" />Analizar con CampoAI
              </Button>
              <Button variant="outline" onClick={() => void refreshReports()} disabled={refreshing || offlineMode || !isOnline}>
                <RefreshCw className={refreshing ? "animate-spin" : undefined} aria-hidden="true" />Actualizar
              </Button>
              <Button onClick={() => window.print()}>
                <Printer aria-hidden="true" />Imprimir o guardar PDF
              </Button>
            </>
          }
        />
        {offlineReportsSavedAt && (
          <div role="status" className="mb-4 rounded-lg border border-warn-line bg-warn-soft px-3 py-2 text-sm text-foreground">
            Mostrando reportes de la copia sincronizada el {new Date(offlineReportsSavedAt).toLocaleString("es-UY")}. El documento está en modo lectura.
            {offlineReportsTruncated && " Algunos datos están limitados a los registros más recientes."}
          </div>
        )}
        <div className="-mx-1 mb-6 overflow-x-auto px-1 pb-1">
          <div role="group" aria-label="Tipo de reporte" className="inline-flex rounded-md border border-border bg-card p-0.5">
            {TABS.map((t) => (
              <button
                type="button"
                key={t.value}
                aria-pressed={tab === t.value}
                onClick={() => setTab(t.value)}
                className={`shrink-0 whitespace-nowrap rounded-[calc(var(--radius)-3px)] px-3 py-1.5 text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                  tab === t.value ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="print-area max-w-4xl rounded-lg border border-border bg-card p-4 sm:p-6 print:max-w-none print:border-0 print:p-0">
        <div className="mb-6 border-b border-border pb-4">
          <h2 className="text-xl font-semibold">{reportTitle}</h2>
          <p className="text-sm text-muted-foreground">{farm?.name} · {today}</p>
        </div>

        {tabEmpty && (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Todavía no hay datos para este reporte. Cargalos en el módulo correspondiente y volvé a generarlo.
          </p>
        )}

        {tab === "hacienda" && !tabEmpty && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left">
                <th className={th}>Categoría</th><th className={`${th} text-right`}>Cabezas</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {byCat.map((r) => (
                  <tr key={r.category}>
                    <td className={`${td} capitalize`}>{r.category}</td>
                    <td className={`${td} ${num}`}>{r.count}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-border font-semibold"><td className={td}>Total</td><td className={`${td} ${num}`}>{totalHead(cattle)}</td></tr>
              </tbody>
            </table>
          </div>
        )}

        {tab === "finanzas" && !tabEmpty && (
          <>
            <div className="mb-6 space-y-3">
              {fin.byCurrency.map((summary) => (
                <StatStrip
                  key={summary.currency}
                  className="break-inside-avoid"
                  items={[
                    { label: `Ingresos (${summary.currency})`, value: formatMoney(summary.income, summary.currency) },
                    { label: `Egresos (${summary.currency})`, value: formatMoney(summary.expense, summary.currency) },
                    { label: `Resultado (${summary.currency})`, value: formatMoney(summary.net, summary.currency), tone: summary.net < 0 ? "bad" : undefined },
                  ]}
                />
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-left">
                  <th className={th}>Categoría</th><th className={th}>Moneda</th><th className={`${th} text-right`}>Ingresos</th><th className={`${th} text-right`}>Egresos</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {fin.byCategory.map((c) => (
                    <tr key={`${c.currency}-${c.category}`}>
                      <td className={`${td} first-letter:uppercase`}>{c.category.replace(/_/g, " ")}</td>
                      <td className={td}>{c.currency}</td>
                      <td className={`${td} ${num}`}>{c.income ? formatMoney(c.income, c.currency) : "—"}</td>
                      <td className={`${td} ${num}`}>{c.expense ? formatMoney(c.expense, c.currency) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "inventario" && !tabEmpty && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border text-left">
                <th className={th}>Ítem</th><th className={`${th} text-right`}>Stock</th><th className={`${th} text-right`}>Costo unit.</th><th className={`${th} text-right`}>Valor</th>
              </tr></thead>
              <tbody className="divide-y divide-border">
                {val.rows.map((r) => (
                  <tr key={r.name}>
                    <td className={td}>{r.name}</td>
                    <td className={`${td} ${num}`}>{r.stock} <span className="text-xs text-muted-foreground">{r.unit}</span></td>
                    <td className={`${td} ${num}`}>{r.cost ? formatMoney(r.cost, r.currency) : "—"}</td>
                    <td className={`${td} ${num}`}>{formatMoney(r.value, r.currency)}</td>
                  </tr>
                ))}
                {val.byCurrency.map((summary, index) => (
                  <tr key={summary.currency} className={index === 0 ? "border-t-2 border-border font-semibold" : "font-semibold"}>
                    <td className={td} colSpan={3}>Valor total ({summary.currency})</td>
                    <td className={`${td} ${num}`}>{formatMoney(summary.total, summary.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === "rentabilidad" && !tabEmpty && (
          <>
            <p className="mb-4 text-sm text-muted-foreground">
              Ingresos y egresos del último año agrupados por sección y moneda. Los movimientos sin vínculo aparecen como “Sin asignar”.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-border text-left">
                  <th className={th}>Sección</th><th className={th}>Moneda</th><th className={`${th} text-right`}>Ingresos</th><th className={`${th} text-right`}>Egresos</th><th className={`${th} text-right`}>Resultado</th>
                </tr></thead>
                <tbody className="divide-y divide-border">
                  {bySection.map((row) => (
                    <tr key={`${row.sectionId}-${row.currency}`}>
                      <td className={td}>{row.sectionName}</td>
                      <td className={td}>{row.currency}</td>
                      <td className={`${td} ${num}`}>{row.income ? formatMoney(row.income, row.currency) : "—"}</td>
                      <td className={`${td} ${num}`}>{row.expense ? formatMoney(row.expense, row.currency) : "—"}</td>
                      <td className={`${td} ${num} font-semibold ${row.net < 0 ? "text-bad" : ""}`}>{formatMoney(row.net, row.currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
