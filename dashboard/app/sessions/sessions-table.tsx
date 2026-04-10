"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { formatDate, formatRelative } from "@/lib/formatters";
import type { StatusKey } from "@/lib/constants";

interface SessionRow {
  id: string;
  agentId: string;
  chatId: string;
  sessionId: string | null;
  title: string | null;
  workspacePath: string | null;
  createdAt: Date | null;
  lastUsed: Date | null;
  messageCount: number | null;
  compactionCount: number | null;
  previousSummary: string | null;
  hasRealConversation: boolean | null;
  status: string;
}

const sessionStatusMap: Record<string, StatusKey> = {
  active: "healthy",
  idle: "warning",
  compacted: "neutral",
};

const columns: ColumnDef<SessionRow>[] = [
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
    accessorKey: "title",
    header: "Title",
    cell: ({ row }) => {
      const title = row.original.title ?? "Untitled";
      return (
        <Link
          href={`/sessions/${row.original.id}`}
          className="text-accent-secondary hover:underline font-medium"
        >
          {title}
        </Link>
      );
    },
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge status={sessionStatusMap[row.original.status] ?? "neutral"}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "messageCount",
    header: "Messages",
    cell: ({ row }) => (
      <span className="tabular-nums font-mono">{row.original.messageCount ?? 0}</span>
    ),
  },
  {
    accessorKey: "lastUsed",
    header: "Last Used",
    cell: ({ row }) => (
      <span className="text-text-secondary text-xs">
        {formatRelative(row.original.lastUsed)}
      </span>
    ),
  },
  {
    accessorKey: "hasRealConversation",
    header: "Real Conv.",
    cell: ({ row }) => (
      <span
        className={`text-xs font-medium ${
          row.original.hasRealConversation ? "text-healthy" : "text-text-muted"
        }`}
      >
        {row.original.hasRealConversation ? "yes" : "no"}
      </span>
    ),
  },
];

function getUniqueValues(data: SessionRow[], key: keyof SessionRow): { label: string; value: string }[] {
  const set = new Set<string>();
  data.forEach((r) => {
    const v = r[key];
    if (v != null) set.add(String(v));
  });
  return Array.from(set).sort().map((v) => ({ label: v, value: v }));
}

export function SessionsTable({ data }: { data: SessionRow[] }) {
  const agentOptions = getUniqueValues(data, "agentId");
  const statusOptions = getUniqueValues(data, "status");

  return (
    <DataTable
      columns={columns}
      data={data}
      searchKey="title"
      searchPlaceholder="Search sessions..."
      filterColumn="agentId"
      filterOptions={agentOptions}
      emptyTitle="No sessions found"
      emptyDescription="There are no agent sessions matching your criteria."
    />
  );
}
