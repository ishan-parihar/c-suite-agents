"use client";

import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { formatDate } from "@/lib/formatters";
import type { StatusKey } from "@/lib/constants";

interface TaskRow {
  id: unknown;
  name: string | null;
  status: string | null;
  priority: string | null;
  assignee: string | null;
  actionDate: string | null;
  completedDate: unknown;
  sprintStatus: string | null;
  description: unknown;
  tags: unknown;
  projectId: unknown;
  projectName: string | null;
}

const statusMap: Record<string, StatusKey> = {
  Complete: "healthy",
  Done: "healthy",
  "In Progress": "warning",
  Blocked: "critical",
};

const columns: ColumnDef<TaskRow>[] = [
  {
    accessorKey: "name",
    header: "Task",
    cell: ({ row }) => {
      const task = row.original;
      return task.projectId ? (
        <Link href={`/projects/${task.projectId}`} className="text-accent-secondary hover:underline">{task.name}</Link>
      ) : task.name;
    },
  },
  { accessorKey: "projectName", header: "Project" },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => <Badge status={statusMap[row.original.status ?? ""] ?? "neutral"}>{row.original.status}</Badge>,
  },
  { accessorKey: "sprintStatus", header: "Sprint" },
  { accessorKey: "priority", header: "Priority" },
  {
    accessorKey: "actionDate",
    header: "Due",
    cell: ({ row }) => formatDate(row.original.actionDate),
  },
  { accessorKey: "assignee", header: "Assignee" },
];

function getUniqueValues(data: TaskRow[], key: keyof TaskRow): { label: string; value: string }[] {
  const set = new Set<string>();
  data.forEach((r) => {
    const v = r[key];
    if (v != null) set.add(String(v));
  });
  return Array.from(set).sort().map((v) => ({ label: v, value: v }));
}

export function TasksTable({ data }: { data: TaskRow[] }) {
  const statusOptions = getUniqueValues(data, "status");

  return (
    <DataTable
      columns={columns}
      data={data}
      searchKey="name"
      searchPlaceholder="Search tasks..."
      filterColumn="status"
      filterOptions={statusOptions}
      emptyTitle="No tasks found"
      emptyDescription="There are no tasks matching your criteria."
    />
  );
}
