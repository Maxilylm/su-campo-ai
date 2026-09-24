"use client";

import dynamic from "next/dynamic";
import { Money } from "@/components/gestion/Figures";
import { activeFlowPoints, flowBucketLabel, type FlowGranularity, type FlowPoint } from "@/lib/finance-charts";
import { formatAmount } from "@/lib/format";
import { ChartLegend, ChartNote, ChartPanel } from "./ChartPanel";
import { EXPENSE_COLOR, INCOME_COLOR, NET_COLOR } from "./chart-theme";
import type { FlowChartRow } from "./FlowChart";

const FlowChart = dynamic(() => import("./FlowChart"), {
  ssr: false,
  loading: () => <div className="h-[232px] animate-pulse rounded-md bg-muted" />,
});

const UNIT: Record<FlowGranularity, { one: string; other: string; by: string }> = {
  day: { one: "día", other: "otro día", by: "por día" },
  week: { one: "semana", other: "otra semana", by: "por semana" },
  month: { one: "mes", other: "otro mes", by: "por mes" },
};

function bucketTitle(key: string, granularity: FlowGranularity): string {
  const label = flowBucketLabel(key, granularity);
  return granularity === "week" ? `Semana del ${label}` : label;
}

/** "del 5/9", "de la semana del 21/9", "de sep 26". */
function bucketPhrase(key: string, granularity: FlowGranularity): string {
  const label = flowBucketLabel(key, granularity);
  if (granularity === "day") return `del ${label}`;
  if (granularity === "week") return `de la semana del ${label}`;
  return `de ${label}`;
}

const signed =(value: number) => (value > 0 ? "+" : value < 0 ? "-" : undefined);

/** Flujo: income vs expenses per bucket with the net result, for one currency.
 * Fewer than two buckets with movements shows the numbers instead of a chart. */
export function FlowPanel({ points, granularity, currency, titleId, emptyHint }: {
  points: FlowPoint[];
  granularity: FlowGranularity;
  currency: string;
  titleId: string;
  /** What to record to see the chart, e.g. "Registrá ingresos y egresos…". */
  emptyHint: string;
}) {
  const unit = UNIT[granularity];
  const active = points.filter((point) => point.count > 0);
  const rows: FlowChartRow[] = points.map((point) => ({
    label: flowBucketLabel(point.key, granularity),
    title: bucketTitle(point.key, granularity),
    income: point.income,
    expenses: point.expenses,
    net: point.net,
  }));
  const best = active.reduce<FlowPoint | null>((top, point) => (!top || point.net > top.net ? point : top), null);
  const worst = active.reduce<FlowPoint | null>((low, point) => (!low || point.net < low.net ? point : low), null);
  const enough = activeFlowPoints(points) >= 2;

  return (
    <ChartPanel
      titleId={titleId}
      title={<>Flujo {unit.by} <span className="font-normal text-muted-foreground">({currency})</span></>}
      description="Ingresos arriba de cero, egresos abajo y el resultado de cada período."
      aside={enough ? (
        <ChartLegend items={[
          { label: "Ingresos", color: INCOME_COLOR },
          { label: "Egresos", color: EXPENSE_COLOR },
          { label: "Resultado", color: NET_COLOR, shape: "line" },
        ]} />
      ) : undefined}
    >
      {active.length === 0 ? (
        <ChartNote>{emptyHint}</ChartNote>
      ) : !enough ? (
        <ChartNote>
          <p>
            Todos los movimientos en {currency} son {bucketPhrase(active[0].key, granularity)}: resultado <Money amount={Math.abs(active[0].net)} currency={currency} sign={signed(active[0].net)} className="font-semibold text-foreground" />.
          </p>
          <p className="mt-1">Cuando haya movimientos en {unit.other} vas a ver la evolución.</p>
        </ChartNote>
      ) : (
        <>
          <div aria-hidden="true">
            <FlowChart rows={rows} currency={currency} />
          </div>
          {best && worst && best !== worst && (
            <p className="mt-3 text-xs text-muted-foreground">
              Mejor {unit.one}: <span className="text-foreground">{flowBucketLabel(best.key, granularity)}</span>{" "}
              <Money amount={Math.abs(best.net)} currency={currency} sign={signed(best.net)} className="text-foreground" />
              <span aria-hidden="true"> · </span>
              Peor: <span className="text-foreground">{flowBucketLabel(worst.key, granularity)}</span>{" "}
              <Money amount={Math.abs(worst.net)} currency={currency} sign={signed(worst.net)} className="text-foreground" />
            </p>
          )}
          <table className="sr-only">
            <caption>Flujo {unit.by} en {currency}</caption>
            <thead>
              <tr><th scope="col">Período</th><th scope="col">Ingresos</th><th scope="col">Egresos</th><th scope="col">Resultado</th></tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.title}>
                  <th scope="row">{row.title}</th>
                  <td>{formatAmount(row.income)} {currency}</td>
                  <td>{formatAmount(row.expenses)} {currency}</td>
                  <td>{row.net < 0 ? "−" : ""}{formatAmount(Math.abs(row.net))} {currency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </ChartPanel>
  );
}
