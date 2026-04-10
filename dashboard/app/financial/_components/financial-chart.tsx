"use client";

import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Line,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { formatCurrency } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard } from "@/components/ui/chart-card";

const categoryColors = [
  "#10B981",
  "#3B82F6",
  "#F59E0B",
  "#EF4444",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
  "#84CC16",
  "#F97316",
  "#6366F1",
];

interface FinancialChartProps {
  monthlyTrend: { month: string; income: number; expenses: number; net: number }[];
  categoryBreakdown: { category: string; total: number; count: number }[];
}

function FinancialChartInner({ monthlyTrend, categoryBreakdown }: FinancialChartProps) {
  const totalCategory = categoryBreakdown.reduce((sum, c) => sum + c.total, 0);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <div className="lg:col-span-2">
        <ResponsiveContainer width="100%" height={320}>
          <AreaChart data={monthlyTrend.slice(-12)}>
            <defs>
              <linearGradient id="incomeGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="expensesGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#EF4444" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#EF4444" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis
              dataKey="month"
              tick={{ fill: "#71717A", fontSize: 12, fontFamily: "var(--font-fira-code)" }}
              axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
              tickLine={false}
            />
            <YAxis
              tick={{ fill: "#71717A", fontSize: 12, fontFamily: "var(--font-fira-code)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => formatCurrency(v)}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1A1A2E",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "8px",
                fontFamily: "var(--font-fira-code)",
                fontSize: "12px",
              }}
              formatter={(value: unknown) => [formatCurrency(Number(value)), ""]}
            />
            <Legend
              wrapperStyle={{ fontFamily: "var(--font-fira-code)", fontSize: "12px" }}
            />
            <Area
              type="monotone"
              dataKey="income"
              name="Income"
              stroke="#10B981"
              strokeWidth={2}
              fill="url(#incomeGradient)"
            />
            <Area
              type="monotone"
              dataKey="expenses"
              name="Expenses"
              stroke="#EF4444"
              strokeWidth={2}
              fill="url(#expensesGradient)"
            />
            <Line
              type="monotone"
              dataKey="net"
              name="Net"
              stroke="#3B82F6"
              strokeWidth={2}
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div>
        <ResponsiveContainer width="100%" height={320}>
          <PieChart>
            <Pie
              data={categoryBreakdown}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={100}
              paddingAngle={2}
              dataKey="total"
              nameKey="category"
            >
              {categoryBreakdown.map((_entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={categoryColors[index % categoryColors.length]}
                  stroke="none"
                />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                backgroundColor: "#1A1A2E",
                border: "1px solid rgba(255,255,255,0.08)",
                borderRadius: "8px",
                fontFamily: "var(--font-fira-code)",
                fontSize: "12px",
              }}
              formatter={(value: unknown, _name: unknown, props: any) => {
                const num = Number(value);
                const pct = totalCategory > 0 ? ((num / totalCategory) * 100).toFixed(1) : "0";
                return [`${formatCurrency(num)} (${pct}%)`, props.payload.category];
              }}
            />
            <Legend
              wrapperStyle={{ fontFamily: "var(--font-fira-code)", fontSize: "11px" }}
              formatter={(value: string) => value}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function FinancialChartClient(props: FinancialChartProps) {
  return <FinancialChartInner {...props} />;
}

export function FinancialChartSkeleton() {
  return (
    <ChartCard title="Income vs Expenses" subtitle="Last 12 months">
      <Skeleton variant="chart" />
    </ChartCard>
  );
}

export default FinancialChartInner;
