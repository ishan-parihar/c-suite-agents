"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { ChartCard } from "@/components/ui/chart-card";

interface BalanceChartProps {
  data: Array<{ month: string; net: number }>;
}

export function BalanceChart({ data }: BalanceChartProps) {
  if (data.length === 0) {
    return (
      <ChartCard title="Balance Trend" subtitle="No data available">
        <div className="h-48 flex items-center justify-center text-sm text-text-muted">
          No transaction data to display
        </div>
      </ChartCard>
    );
  }

  return (
    <ChartCard title="Balance Trend" subtitle="Net cash flow per month">
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border-default)" />
            <XAxis
              dataKey="month"
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border-default)" }}
            />
            <YAxis
              tick={{ fill: "var(--text-muted)", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "var(--border-default)" }}
              tickFormatter={(v) => `${v >= 0 ? "" : "-"}\u20B9${Math.abs(v).toLocaleString("en-IN")}`}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "var(--bg-elevated)",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-md)",
                color: "var(--text-primary)",
              }}
              formatter={(value) => [`\u20B9${Number(value).toLocaleString("en-IN")}`, "Net Flow"]}
            />
            <Line
              type="monotone"
              dataKey="net"
              stroke="var(--accent-secondary)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: "var(--accent-secondary)" }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
