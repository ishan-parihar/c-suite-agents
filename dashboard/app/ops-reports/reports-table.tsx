"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { formatDate, formatRelative } from "@/lib/formatters";
import { truncate } from "@/lib/utils";

interface ReportRow {
  id: string;
  agentId: string;
  period: string | null;
  summary: string | null;
  metrics: unknown;
  actions: unknown;
  createdAt: Date | null;
  metricsKeys: string[];
  actionsCount: number;
}

const columns: ColumnDef<ReportRow>[] = [
  {
    accessorKey: "agentId",
    header: "Agent",
    cell: ({ row }) => (
      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-elevated text-xs font-mono text-text-secondary">
        {row.original.agentId}
      </span>
    ),
  },
  {
    accessorKey: "period",
    header: "Period",
    cell: ({ row }) => (
      <span className="text-sm text-text-primary">{row.original.period ?? "N/A"}</span>
    ),
  },
  {
    accessorKey: "summary",
    header: "Summary",
    cell: ({ row }) => (
      <div className="max-w-[300px]">
        <p className="text-sm text-text-secondary line-clamp-2">
          {truncate(row.original.summary ?? "", 120)}
        </p>
      </div>
    ),
  },
  {
    accessorKey: "metricsKeys",
    header: "Metrics",
    cell: ({ row }) => (
      <div className="flex flex-wrap gap-1">
        {row.original.metricsKeys.slice(0, 3).map((key) => (
          <span
            key={key}
            className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-elevated text-text-muted"
          >
            {key}
          </span>
        ))}
        {row.original.metricsKeys.length > 3 && (
          <span className="px-1.5 py-0.5 rounded text-[10px] text-text-muted">
            +{row.original.metricsKeys.length - 3}
          </span>
        )}
      </div>
    ),
  },
  {
    accessorKey: "actionsCount",
    header: "Actions",
    cell: ({ row }) => (
      <span className="tabular-nums font-mono text-sm">{row.original.actionsCount}</span>
    ),
  },
  {
    accessorKey: "createdAt",
    header: "Date",
    cell: ({ row }) => (
      <span className="text-xs text-text-secondary">
        {formatDate(row.original.createdAt)}
      </span>
    ),
  },
];

export function ReportsTable({ data }: { data: ReportRow[] }) {
  const agentOptions = Array.from(new Set(data.map((r) => r.agentId)))
    .sort()
    .map((v) => ({ label: v, value: v }));

  return (
    <DataTable
      columns={columns}
      data={data}
      searchKey="period"
      searchPlaceholder="Search reports..."
      filterColumn="agentId"
      filterOptions={agentOptions}
      emptyTitle="No reports found"
      emptyDescription="There are no operational reports matching your criteria."
    />
  );
}
