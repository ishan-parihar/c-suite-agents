"use client";

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip } from "recharts";
import type { KanbanColumn as KanbanColumnType, KanbanCard as KanbanCardType } from "@/lib/server/kanban";

interface CardDistributionChartProps {
  columns: KanbanColumnType[];
  cards: KanbanCardType[];
}

export default function CardDistributionChart({ columns, cards }: CardDistributionChartProps) {
  const data = columns.map((col) => ({
    name: col.name,
    count: cards.filter((c) => c.columnId === col.id).length,
  }));

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data}>
          <XAxis
            dataKey="name"
            tick={{ fill: "#A1A1AA", fontSize: 11 }}
            axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: "#A1A1AA", fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#1A1A2E",
              border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: "8px",
              color: "#FFFFFF",
            }}
          />
          <Bar
            dataKey="count"
            fill="#3B82F6"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
