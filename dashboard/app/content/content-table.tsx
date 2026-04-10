"use client";

import type { ColumnDef } from "@tanstack/react-table";
import Link from "next/link";
import { FileText, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { DataTable } from "@/components/ui/data-table";
import { truncate } from "@/lib/utils";
import type { StatusKey } from "@/lib/constants";

function contentStatusToBadgeKey(status: string | null): StatusKey {
  if (!status) return "neutral";
  const s = status.toLowerCase();
  if (s === "published" || s === "live") return "healthy";
  if (s === "in progress" || s === "in_review" || s === "draft" || s === "in review") return "warning";
  if (s === "cancelled" || s === "rejected") return "critical";
  return "neutral";
}

function formatDate(d: Date | string | null): string {
  if (!d) return "—";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
}

interface ContentRow {
  id: string;
  name: string;
  format: string[];
  status: string | null;
  platforms: string[];
  publishDate: Date | string | null;
  reach: number | null;
  engagement: number | null;
  engagementRate: string;
}

const columns: ColumnDef<ContentRow>[] = [
  {
    accessorKey: "name",
    header: "Title",
    cell: ({ row }) => {
      const item = row.original;
      return (
        <Link
          href={`/content/${item.id}`}
          className="flex items-center gap-1.5 text-text-primary hover:text-accent-hover transition-colors"
        >
          <FileText className="w-3.5 h-3.5 text-text-muted flex-shrink-0" />
          <span className="truncate max-w-[250px]">{truncate(item.name, 50)}</span>
          <ExternalLink className="w-3 h-3 text-text-muted flex-shrink-0 opacity-0 group-hover:opacity-100" />
        </Link>
      );
    },
    enableSorting: true,
  },
  {
    accessorKey: "format",
    header: "Type / Format",
    cell: ({ row }) => {
      const formats = row.original.format || [];
      if (formats.length === 0) return <span className="text-text-muted">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {formats.map((f: string) => (
            <span key={f} className="text-xs bg-hover text-text-secondary px-2 py-0.5 rounded-md">
              {f}
            </span>
          ))}
        </div>
      );
    },
    enableSorting: true,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge status={contentStatusToBadgeKey(row.original.status)}>
        {row.original.status || "Unknown"}
      </Badge>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "platforms",
    header: "Platform(s)",
    cell: ({ row }) => {
      const platforms = row.original.platforms || [];
      if (platforms.length === 0) return <span className="text-text-muted">—</span>;
      return (
        <div className="flex flex-wrap gap-1">
          {platforms.map((p: string) => (
            <span key={p} className="text-xs bg-hover text-text-secondary px-2 py-0.5 rounded-md">
              {p}
            </span>
          ))}
        </div>
      );
    },
    enableSorting: true,
  },
  {
    accessorKey: "publishDate",
    header: "Publish Date",
    cell: ({ row }) => (
      <span className="tabular-nums text-text-secondary">
        {formatDate(row.original.publishDate)}
      </span>
    ),
    enableSorting: true,
  },
  {
    accessorKey: "reach",
    header: "Reach",
    cell: ({ row }) => {
      const reach = row.original.reach;
      return reach ? (
        <span className="tabular-nums text-text-secondary">{reach.toLocaleString("en-IN")}</span>
      ) : (
        <span className="text-text-muted">—</span>
      );
    },
    enableSorting: true,
  },
  {
    accessorKey: "engagement",
    header: "Engagement",
    cell: ({ row }) => {
      const engagement = row.original.engagement;
      return engagement ? (
        <span className="tabular-nums text-text-secondary">{engagement.toLocaleString("en-IN")}</span>
      ) : (
        <span className="text-text-muted">—</span>
      );
    },
    enableSorting: true,
  },
  {
    accessorKey: "engagementRate",
    header: "Eng. Rate",
    cell: ({ row }) => {
      const rate = parseFloat(row.original.engagementRate);
      return rate ? (
        <span className="tabular-nums text-text-secondary">{(rate * 100).toFixed(1)}%</span>
      ) : (
        <span className="text-text-muted">—</span>
      );
    },
    enableSorting: true,
  },
];

export function ContentTable({ data }: { data: ContentRow[] }) {
  const allStatuses = Array.from(new Set(data.map((c) => c.status).filter(Boolean))).sort();
  const statusOptions = allStatuses.map((s) => ({ label: s!, value: s! }));

  return (
    <DataTable
      columns={columns}
      data={data}
      searchKey="name"
      searchPlaceholder="Search content..."
      filterColumn="status"
      filterOptions={statusOptions}
      emptyTitle="No content found"
      emptyDescription="Start creating content to build your pipeline."
    />
  );
}
