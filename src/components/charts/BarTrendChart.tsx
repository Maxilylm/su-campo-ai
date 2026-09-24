"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { usePrefersReducedMotion } from "@/lib/use-prefers-reduced-motion";
import { SERIES_COLOR, axisLine, axisTick, cursorFill, gridStroke, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "./chart-theme";

export interface BarSeries {
  dataKey: string;
  /** Tooltip name of the series, e.g. "Casos". */
  name?: string;
  /** Any CSS color; prefer a token. Defaults to the single-series color. */
  fill?: string;
}

/** Columns over time. Callers render the text alternative next to it. */
export default function BarTrendChart({ data, xKey, bars, height = 200 }: {
  data: Record<string, unknown>[];
  xKey: string;
  bars: BarSeries[];
  height?: number;
}) {
  const reducedMotion = usePrefersReducedMotion();
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={gridStroke} />
        <XAxis dataKey={xKey} tick={axisTick} axisLine={axisLine} tickLine={false} interval="preserveStartEnd" minTickGap={12} />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          itemStyle={tooltipItemStyle}
          cursor={cursorFill}
          isAnimationActive={!reducedMotion}
        />
        {bars.map((bar) => (
          <Bar
            key={bar.dataKey}
            dataKey={bar.dataKey}
            name={bar.name}
            fill={bar.fill ?? SERIES_COLOR}
            radius={[4, 4, 0, 0]}
            maxBarSize={24}
            isAnimationActive={!reducedMotion}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
