"use client";

import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { DivergingBarList } from "@/components/charts/BarLists";
import { ChartNote, ChartPanel } from "@/components/charts/ChartPanel";
import { FlowPanel } from "@/components/charts/FlowPanel";
import { SegmentedControl } from "@/components/gestion/SegmentedControl";
import { Quantity } from "@/components/gestion/Figures";
import { flowBucketKeys, flowBucketLabel, monthlyFlowFromTrend } from "@/lib/finance-charts";
import { financialPeriodStart } from "@/lib/finance-period";
import { dateInputValue } from "@/lib/date";
import type { BatchWeightGain } from "@/lib/weight";
import type { MetricsData } from "./metrics-types";

const BarTrendChart = dynamic(() => import("@/components/charts/BarTrendChart"), {
  ssr: false,
  loading: () => <div className="h-[200px] animate-pulse rounded-md bg-muted" />,
});

const kgPerDay = (value: number) => value.toLocaleString("es-UY", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Income vs expenses per month for one currency at a time — the currencies
 * are never added together. */
export function MetricsFinanceTrend({ data, period }: { data: MetricsData; period: string }) {
  const currencies = data.snapshot.financialByCurrency.map((row) => row.currency);
  const [selected, setSelected] = useState(data.snapshot.primaryCurrency);
  const currency = currencies.includes(selected) ? selected : data.snapshot.primaryCurrency;
  const today = dateInputValue();
  const points = useMemo(
    () => monthlyFlowFromTrend(data.trends.financial, currency, financialPeriodStart(period, today), today),
    [currency, data.trends.financial, period, today],
  );
  return (
    <div className="space-y-3">
      {currencies.length > 1 && (
        <SegmentedControl
          label="Moneda del gráfico"
          options={currencies.map((code) => ({ value: code, label: code }))}
          value={currency}
          onChange={setSelected}
        />
      )}
      <FlowPanel
        points={points}
        granularity="month"
        currency={currency}
        titleId="metricas-flujo"
        emptyHint={`No hay movimientos en ${currency} en este período. Registralos en Finanzas para ver cómo evoluciona el resultado.`}
      />
    </div>
  );
}

/** Sanidad: are problems (illness, injury, death) going up or down? */
export function MetricsHealthTrend({ data, period }: { data: MetricsData; period: string }) {
  const today = dateInputValue();
  const months = flowBucketKeys(financialPeriodStart(period, today), today, "month");
  const rows = months.map((month) => {
    const row = data.trends.health.find((item) => item.month === month);
    return { label: flowBucketLabel(month, "month"), casos: row?.count ?? 0, deaths: row?.deaths ?? 0 };
  });
  const total = rows.reduce((sum, row) => sum + row.casos, 0);
  const deaths = rows.reduce((sum, row) => sum + row.deaths, 0);
  const activeMonths = rows.filter((row) => row.casos > 0).length;

  return (
    <ChartPanel
      titleId="metricas-sanidad"
      title="Casos sanitarios por mes"
      description="Enfermedades, lesiones y muertes registradas en Sanidad."
    >
      {total === 0 ? (
        <ChartNote>No hay enfermedades, lesiones ni muertes registradas en este período.</ChartNote>
      ) : (
        <>
          <p className="mb-3 text-sm">
            <Quantity value={total} unit={total === 1 ? "caso" : "casos"} className="font-semibold" /> en el período
            {deaths > 0 && <>, <Quantity value={deaths} unit={deaths === 1 ? "muerte" : "muertes"} className="font-semibold text-bad" /></>}.
          </p>
          {activeMonths >= 2 ? (
            <>
              <div aria-hidden="true">
                <BarTrendChart data={rows} xKey="label" bars={[{ dataKey: "casos", name: "Casos" }]} />
              </div>
              <table className="sr-only">
                <caption>Casos sanitarios por mes</caption>
                <thead><tr><th scope="col">Mes</th><th scope="col">Casos</th><th scope="col">Muertes</th></tr></thead>
                <tbody>
                  {rows.map((row) => <tr key={row.label}><th scope="row">{row.label}</th><td>{row.casos}</td><td>{row.deaths}</td></tr>)}
                </tbody>
              </table>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Todos los casos son del mismo mes; con casos en otro mes vas a ver la evolución.</p>
          )}
        </>
      )}
    </ChartPanel>
  );
}

/** Producción: which batches are gaining weight, which are losing it. */
export function MetricsWeightGain({ rows }: { rows: BatchWeightGain[] | undefined }) {
  const gains = rows ?? [];
  return (
    <ChartPanel
      titleId="metricas-ganancia"
      title="Ganancia diaria por lote"
      description="Kilos por día entre el primer y el último pesaje del período."
    >
      {gains.length === 0 ? (
        <ChartNote>
          Ningún lote tiene dos pesajes en este período. Registrá pesajes en Producción (o elegí un período más largo) para ver cuánto gana cada lote.
        </ChartNote>
      ) : gains.length === 1 ? (
        <ChartNote>
          <span className="text-foreground">{gains[0].label}</span>:{" "}
          <Quantity value={`${gains[0].adg > 0 ? "+" : gains[0].adg < 0 ? "−" : ""}${kgPerDay(Math.abs(gains[0].adg))}`} unit="kg/día" className="font-semibold text-foreground" />{" "}
          en <span className="figure">{gains[0].days}</span> días. Con pesajes de otro lote vas a poder compararlos.
        </ChartNote>
      ) : (
        <DivergingBarList
          label="Ganancia diaria por lote"
          rows={gains.map((row) => ({
            key: row.id,
            label: row.label,
            value: row.adg,
            valueText: <Quantity value={`${row.adg > 0 ? "+" : row.adg < 0 ? "−" : ""}${kgPerDay(Math.abs(row.adg))}`} unit="kg/día" className="font-medium" />,
            detail: <><span className="figure">{row.weighings}</span> pesajes en <span className="figure">{row.days}</span> días · último <span className="figure">{row.lastWeight.toLocaleString("es-UY", { maximumFractionDigits: 1 })}</span> kg</>,
          }))}
        />
      )}
    </ChartPanel>
  );
}
