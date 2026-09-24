"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { axisLine, axisTick, cursorStroke, gridStroke, tooltipItemStyle, tooltipLabelStyle, tooltipStyle } from "./chart-theme";

export default function WeightLineChart({ data }: { data: { date: string; peso: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 5, right: 10, left: -10, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={gridStroke} />
        <XAxis dataKey="date" tick={axisTick} axisLine={axisLine} tickLine={false} />
        <YAxis tick={axisTick} axisLine={false} tickLine={false} domain={["auto", "auto"]} unit=" kg" width={64} />
        <Tooltip
          contentStyle={tooltipStyle}
          labelStyle={tooltipLabelStyle}
          itemStyle={tooltipItemStyle}
          cursor={cursorStroke}
          formatter={(value) => [`${value} kg`, "Peso"]}
        />
        <Line
          type="monotone"
          dataKey="peso"
          name="Peso"
          stroke="var(--primary)"
          strokeWidth={2}
          dot={{ r: 3, fill: "var(--primary)", stroke: "var(--card)", strokeWidth: 1.5 }}
          activeDot={{ r: 5, fill: "var(--primary)", stroke: "var(--card)", strokeWidth: 2 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
