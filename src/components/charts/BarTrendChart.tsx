"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisLine, axisTick, cursorFill, gridStroke, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "./chart-theme";

export interface BarSeries {
  dataKey: string;
  /** Any CSS color; prefer a token such as "var(--ok)" or "var(--bad)". */
  fill: string;
}

export default function BarTrendChart({ data, xKey, bars, height = 200 }: {
  data: Record<string, unknown>[];
  xKey: string;
  bars: BarSeries[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={gridStroke} />
        <XAxis dataKey={xKey} tick={axisTick} axisLine={axisLine} tickLine={false} />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} />
        <Tooltip contentStyle={tooltipStyle} labelStyle={tooltipLabelStyle} itemStyle={tooltipItemStyle} cursor={cursorFill} />
        {bars.map((bar) => (
          <Bar key={bar.dataKey} dataKey={bar.dataKey} fill={bar.fill} radius={[3, 3, 0, 0]} maxBarSize={32} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
