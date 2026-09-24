"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatAmount } from "@/lib/format";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import {
  EXPENSE_COLOR, INCOME_COLOR, NET_COLOR, axisTick, cursorFill, gridStroke, tooltipStyle,
} from "./chart-theme";

export interface FlowChartRow {
  label: string;
  /** Tooltip heading, e.g. "Semana del 21/9". */
  title: string;
  income: number;
  expenses: number;
  net: number;
}

// Axis ticks: "8 k", "1,2 M" — Intl compact mixes "k" and "K" in es-UY.
function compactAmount(value: number): string {
  const abs = Math.abs(value);
  const text = abs >= 1_000_000 ? `${formatAmount(Math.round(abs / 100_000) / 10)} M` : abs >= 1_000 ? `${formatAmount(Math.round(abs / 100) / 10)} k` : formatAmount(abs);
  return value < 0 ? `−${text}` : text;
}
const signed = (value: number) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${formatAmount(Math.abs(value))}`;

function FlowTooltip({ active, payload, currency }: {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: FlowChartRow }>;
  currency: string;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const lines = [
    { label: "Ingresos", value: formatAmount(row.income), key: <span className="h-2.5 w-2.5 rounded-sm" style={{ background: INCOME_COLOR }} /> },
    { label: "Egresos", value: formatAmount(row.expenses), key: <span className="h-2.5 w-2.5 rounded-sm" style={{ background: EXPENSE_COLOR }} /> },
    { label: "Resultado", value: signed(row.net), key: <span className="h-0.5 w-2.5 rounded-full" style={{ background: NET_COLOR }} /> },
  ];
  return (
    <div style={tooltipStyle} className="px-3 py-2">
      <p className="mb-1.5 text-muted-foreground">{row.title}</p>
      <dl className="space-y-1">
        {lines.map((line) => (
          <div key={line.label} className="flex items-center gap-2">
            <span aria-hidden="true" className="flex w-2.5 justify-center">{line.key}</span>
            <dt className="flex-1 pr-4">{line.label}</dt>
            <dd className="figure text-right font-medium">{line.value} <span className="font-normal text-muted-foreground">{currency}</span></dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Income above zero, expenses below it, and the net result as a line — one
 * axis, one currency. Rendered client-only; the text alternative lives with the caller. */
export default function FlowChart({ rows, currency, height = 232 }: { rows: FlowChartRow[]; currency: string; height?: number }) {
  const reducedMotion = usePrefersReducedMotion();
  const data = rows.map((row) => ({ ...row, expensesBelow: -row.expenses }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <ComposedChart data={data} stackOffset="sign" margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="24%">
        <CartesianGrid vertical={false} stroke={gridStroke} />
        <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
        <YAxis
          tick={axisTick}
          axisLine={false}
          tickLine={false}
          width={48}
          tickFormatter={compactAmount}
        />
        <ReferenceLine y={0} stroke="var(--muted-foreground)" strokeOpacity={0.6} />
        <Tooltip content={<FlowTooltip currency={currency} />} cursor={cursorFill} isAnimationActive={!reducedMotion} />
        <Bar dataKey="income" name="Ingresos" stackId="flow" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={!reducedMotion} />
        <Bar dataKey="expensesBelow" name="Egresos" stackId="flow" fill={EXPENSE_COLOR} radius={[0, 0, 4, 4]} maxBarSize={24} isAnimationActive={!reducedMotion} />
        <Line
          dataKey="net"
          name="Resultado"
          type="linear"
          stroke={NET_COLOR}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          dot={{ r: 4, fill: NET_COLOR, stroke: "var(--card)", strokeWidth: 2 }}
          activeDot={{ r: 5, fill: NET_COLOR, stroke: "var(--card)", strokeWidth: 2 }}
          isAnimationActive={!reducedMotion}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
