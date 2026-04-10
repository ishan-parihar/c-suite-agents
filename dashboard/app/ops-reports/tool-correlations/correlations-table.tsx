"use client";

import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { formatDate } from "@/lib/formatters";
import { truncate } from "@/lib/utils";

interface CorrelationRow {
  id: string;
  tool: string;
  argsHash: string;
  result: string | null;
  createdAt: Date | null;
  frequencyCount: number;
}

const columns: ColumnDef<CorrelationRow>[] = [
  {
    accessorKey: "tool",
    header: "Tool Name",
    cell: ({ row }) => (
      <span className="font-mono text-sm text-accent-secondary font-medium">
        {row.original.tool}
      </span>
    ),
  },
  {
    accessorKey: "argsHash",
    header: "Args Hash",
    cell: ({ row }) => (
      <span className="font-mono text-xs text-text-secondary" title={row.original.argsHash}>
        {truncate(row.original.argsHash, 32)}
      </span>
    ),
  },
  {
    accessorKey: "result",
    header: "Result Pattern",
    cell: ({ row }) => (
      <span className="text-xs text-text-muted" title={row.original.result ?? undefined}>
        {truncate(row.original.result ?? "N/A", 60)}
      </span>
    ),
  },
  {
    accessorKey: "frequencyCount",
    header: ({ column }) => (
      <button
        onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
        className="flex items-center gap-1"
      >
        Frequency
      </button>
    ),
    cell: ({ row }) => (
      <span className="tabular-nums font-mono text-sm font-semibold text-text-primary">
        {row.original.frequencyCount}
      </span>
    ),
    sortingFn: "basic",
  },
  {
    accessorKey: "createdAt",
    header: "First Seen",
    cell: ({ row }) => (
      <span className="text-xs text-text-muted">
        {formatDate(row.original.createdAt, "yyyy-MM-dd HH:mm")}
      </span>
    ),
  },
];

export function CorrelationsTable({ data }: { data: CorrelationRow[] }) {
  return (
    <DataTable
      columns={columns}
      data={data}
      searchKey="tool"
      searchPlaceholder="Search tools..."
      emptyTitle="No correlations found"
      emptyDescription="There are no tool correlations to display."
    />
  );
}
