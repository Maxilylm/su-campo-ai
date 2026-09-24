"use client";

import { useMemo, useState } from "react";
import { BarList, DivergingBarList } from "@/components/charts/BarLists";
import { EXPENSE_COLOR } from "@/components/charts/chart-theme";
import { ChartNote, ChartPanel } from "@/components/charts/ChartPanel";
import { FlowPanel } from "@/components/charts/FlowPanel";
import {
  OTHERS_KEY, UNASSIGNED_KEY, chartCurrencies, expensesByCategory, financeFlowSeries, flowGranularity, resultByDimension,
  type ChartTransaction,
} from "@/lib/finance-charts";
import { financialPeriodStart } from "@/lib/finance-period";
import { dateInputValue } from "@/lib/date";
import { formatAmount } from "@/lib/format";
import { Money } from "./Figures";
import { SegmentedControl } from "./SegmentedControl";
import { financeCategoryLabel, type FinanceCrop, type FinancePeriod } from "./finance-types";

const percent = new Intl.NumberFormat("es-UY", { style: "percent", maximumFractionDigits: 0 });
const sign = (value: number) => (value > 0 ? "+" : value < 0 ? "-" : undefined);

const DIMENSIONS = [
  { value: "section", label: "Sección" },
  { value: "crop", label: "Cultivo" },
] as const;

/** Flujo, gasto por categoría and resultado por sección/cultivo for the
 * movements already filtered by the page — one currency at a time. */
export function FinanceCharts({ transactions, currencyFilter, period, sections, crops }: {
  transactions: ChartTransaction[];
  currencyFilter: string;
  period: FinancePeriod;
  sections: { id: string; name: string }[];
  crops: FinanceCrop[];
}) {
  const [selectedCurrency, setSelectedCurrency] = useState("USD");
  const [dimension, setDimension] = useState<"section" | "crop">("section");
  const currencies = useMemo(() => chartCurrencies(transactions), [transactions]);
  const currency = currencyFilter !== "all"
    ? currencyFilter
    : currencies.includes(selectedCurrency) ? selectedCurrency : currencies[0];

  const today = dateInputValue();
  const granularity = flowGranularity(period);
  const flow = useMemo(
    () => currency ? financeFlowSeries(transactions, currency, financialPeriodStart(period, today), today, granularity) : [],
    [currency, granularity, period, today, transactions],
  );
  const categories = useMemo(() => currency ? expensesByCategory(transactions, currency) : { rows: [], total: 0 }, [currency, transactions]);
  const names = useMemo(() => Object.fromEntries([
    ...sections.map((section) => [section.id, section.name]),
    ...crops.map((crop) => [crop.id, crop.crop_type]),
  ]), [crops, sections]);
  const results = useMemo(
    () => currency ? resultByDimension(transactions, currency, dimension, names) : [],
    [currency, dimension, names, transactions],
  );

  if (!currency) return null;

  const assignedResults = results.filter((row) => row.key !== UNASSIGNED_KEY);
  const dimensionName = dimension === "section" ? "sección" : "cultivo";

  return (
    <section aria-labelledby="finance-charts-title" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="finance-charts-title" className="text-base font-semibold">Análisis del período</h2>
        {currencyFilter === "all" && currencies.length > 1 && (
          <SegmentedControl
            label="Moneda de los gráficos"
            options={currencies.map((code) => ({ value: code, label: code }))}
            value={currency}
            onChange={setSelectedCurrency}
          />
        )}
      </div>

      <FlowPanel
        points={flow}
        granularity={granularity}
        currency={currency}
        titleId="finance-flow-title"
        emptyHint={`No hay movimientos en ${currency} en este período. Registrá ingresos y egresos para ver cómo evoluciona el resultado.`}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartPanel
          titleId="finance-categories-title"
          title={<>Gasto por categoría <span className="font-normal text-muted-foreground">({currency})</span></>}
          description={categories.total > 0
            ? <>Total <Money amount={categories.total} currency={currency} className="text-foreground" /> en el período.</>
            : "Egresos del período según su categoría."}
        >
          {categories.rows.length === 0 ? (
            <ChartNote>No hay egresos en {currency} en este período. Registrá egresos con su categoría para ver en qué se va el gasto.</ChartNote>
          ) : categories.rows.length === 1 ? (
            <ChartNote>
              Todo el gasto es de <span className="text-foreground">{financeCategoryLabel(categories.rows[0].key)}</span>:{" "}
              <Money amount={categories.rows[0].amount} currency={currency} className="font-semibold text-foreground" />.
            </ChartNote>
          ) : (
            <BarList
              label={`Gasto por categoría en ${currency}`}
              color={EXPENSE_COLOR}
              rows={categories.rows.map((row) => ({
                key: row.key,
                label: row.key === OTHERS_KEY ? "Otras categorías" : financeCategoryLabel(row.key),
                value: row.amount,
                valueText: <Money amount={row.amount} currency={currency} />,
                aside: percent.format(row.share),
              }))}
            />
          )}
        </ChartPanel>

        <ChartPanel
          titleId="finance-results-title"
          title={<>Resultado por {dimensionName} <span className="font-normal text-muted-foreground">({currency})</span></>}
          description="Ingresos menos egresos vinculados. Ganancia a la derecha, pérdida a la izquierda."
          aside={<SegmentedControl label="Agrupar resultado por" options={DIMENSIONS} value={dimension} onChange={setDimension} />}
        >
          {assignedResults.length === 0 ? (
            <ChartNote>
              Ningún movimiento en {currency} está vinculado a {dimension === "section" ? "una sección" : "un cultivo"}.
              Al registrar un movimiento, elegí {dimension === "section" ? "la sección" : "el cultivo"} para ver cuánto deja cada uno.
            </ChartNote>
          ) : results.length === 1 ? (
            <ChartNote>
              Todos los movimientos son de <span className="text-foreground">{results[0].label}</span>: resultado{" "}
              <Money amount={Math.abs(results[0].net)} currency={currency} sign={sign(results[0].net)} className="font-semibold text-foreground" />.
            </ChartNote>
          ) : (
            <DivergingBarList
              label={`Resultado por ${dimensionName} en ${currency}`}
              rows={results.map((row) => ({
                key: row.key,
                label: row.label,
                value: row.net,
                valueText: <Money amount={Math.abs(row.net)} currency={currency} sign={sign(row.net)} className="font-medium" />,
                detail: <>Ingresos <span className="figure">{formatAmount(row.income)}</span> · Egresos <span className="figure">{formatAmount(row.expenses)}</span></>,
              }))}
            />
          )}
        </ChartPanel>
      </div>
    </section>
  );
}
