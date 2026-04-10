"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { ChartCard } from "@/components/ui/chart-card";

interface ToolUsageChartProps {
  data: { toolName: string; count: number }[];
}

export function ToolUsageChart({ data }: ToolUsageChartProps) {
  if (data.length === 0) {
    return (
      <ChartCard title="Tool Usage" subtitle="No tool calls recorded">
        <div className="py-8 text-center text-sm text-text-muted">
          No tool usage data available for this session
        </div>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Tool Usage" subtitle="Tool call frequency by name">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ left: 20, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              type="number"
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
            />
            <YAxis
              type="category"
              dataKey="toolName"
              tick={{ fill: "var(--text-secondary)", fontSize: 11 }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              width={120}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--bg-elevated)",
                border: "1px solid var(--border-default)",
                borderRadius: "6px",
                color: "var(--text-primary)",
                fontSize: "12px",
              }}
              cursor={{ fill: "rgba(255,255,255,0.04)" }}
            />
            <Bar
              dataKey="count"
              fill="var(--accent-secondary)"
              radius={[0, 4, 4, 0]}
              maxBarSize={24}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
