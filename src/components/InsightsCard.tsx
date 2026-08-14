"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sparkles, RefreshCw } from "lucide-react";

interface InsightResp { summary?: string | null; generated_at?: string | null }

export function InsightsCard() {
  const [summary, setSummary] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/insights")
      .then((r) => {
        if (!r.ok) throw new Error("Insights request failed");
        return r.json();
      })
      .then((d: InsightResp) => { if (active) { setSummary(d.summary ?? null); setGeneratedAt(d.generated_at ?? null); } })
      .catch(() => active && setError(true))
      .finally(() => active && setLoading(false));
    return () => { active = false; };
  }, []);

  async function refresh() {
    setRefreshing(true);
    setError(false);
    try {
      const r = await fetch("/api/insights", { method: "POST" });
      if (!r.ok) throw new Error("Insight generation failed");
      const d: InsightResp = await r.json();
      setSummary(d.summary ?? null);
      setGeneratedAt(d.generated_at ?? null);
    } catch { setError(true); }
    setRefreshing(false);
  }

  if (loading) {
    return <div className="mb-8 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">Generando resumen…</div>;
  }
  if (!summary && error) {
    return (
      <div className="mb-8 rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground flex items-center justify-between gap-3">
        <span>No se pudo generar el resumen del campo.</span>
        <button onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-1.5 hover:text-foreground disabled:opacity-50">
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Reintentar
        </button>
      </div>
    );
  }
  if (!summary) {
    return (
      <div className="mb-8 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
              <Sparkles className="h-4 w-4" /> Resumen del campo
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">Analizá alertas, producción y finanzas cuando quieras.</p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh} disabled={refreshing}>
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {refreshing ? "Generando…" : "Generar resumen"}
          </Button>
        </div>
        {error && <p className="mt-3 text-xs text-destructive">No se pudo generar el resumen. Intentá nuevamente.</p>}
      </div>
    );
  }

  const when = generatedAt
    ? new Date(generatedAt).toLocaleDateString("es-AR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
    : "";

  return (
    <div className="mb-8 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5">
      <div className="flex items-center justify-between gap-3 mb-2">
        <h2 className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
          <Sparkles className="h-4 w-4" /> Resumen del campo
        </h2>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} /> Actualizar
        </button>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-line">{summary}</p>
      {when && <p className="mt-3 text-xs text-muted-foreground">Generado {when}</p>}
    </div>
  );
}
