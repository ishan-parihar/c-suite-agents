"use client";

import Link from "next/link";
import { Download } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatCurrency } from "@/lib/formatters";
import { truncate } from "@/lib/utils";

export interface TransactionRow {
  id: string | null;
  name: string | null;
  signedAmount: string | null;
  category: string | null;
  capitalEngine: string | null;
  date: string | null;
  notes: string | null;
  transactionType: string | null;
  isRecurring: string | null;
  receiptUrl: string | null;
  weekId: string | null;
  monthId: string | null;
  projectId: string | null;
  accountId: string | null;
  projectName: string | null;
  accountName: string | null;
}

function getAmountValue(row: TransactionRow): number {
  const v = row.signedAmount;
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return isNaN(n) ? 0 : n;
}

const columns: ColumnDef<TransactionRow>[] = [
  {
    accessorKey: "date",
    header: "Date",
    cell: ({ row }) => <span className="tabular">{formatDate(row.original.date)}</span>,
  },
  {
    accessorKey: "signedAmount",
    header: "Amount",
    cell: ({ row }) => {
      const amount = getAmountValue(row.original);
      const cls = amount >= 0 ? "text-healthy" : "text-critical";
      return <span className={`tabular font-medium ${cls}`}>{formatCurrency(amount)}</span>;
    },
  },
  {
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) => row.original.category ?? "\u2014",
  },
  {
    accessorKey: "accountName",
    header: "Account",
    cell: ({ row }) => row.original.accountName ?? "\u2014",
  },
  {
    accessorKey: "projectName",
    header: "Project",
    cell: ({ row }) => {
      const { projectName, projectId } = row.original;
      if (!projectName) return "\u2014";
      if (projectId) {
        return (
          <Link href={`/projects/${projectId}`} className="text-accent-secondary hover:underline">
            {truncate(projectName, 30)}
          </Link>
        );
      }
      return truncate(projectName, 30);
    },
  },
  {
    accessorKey: "capitalEngine",
    header: "Capital Engine",
    cell: ({ row }) => row.original.capitalEngine ?? "\u2014",
  },
  {
    accessorKey: "name",
    header: "Description",
    cell: ({ row }) => truncate(row.original.name ?? "\u2014", 50),
  },
];

function getUniqueValues(data: TransactionRow[], key: keyof TransactionRow): { label: string; value: string }[] {
  const set = new Set<string>();
  data.forEach((r) => {
    const v = r[key];
    if (v != null) set.add(String(v));
  });
  return Array.from(set).sort().map((v) => ({ label: v, value: v }));
}

function exportToCsv(data: TransactionRow[]) {
  const headers = ["date", "amount", "category", "account", "project", "capital_engine", "description", "notes"];
  const rows = data.map((r) => [
    r.date ?? "",
    getAmountValue(r).toString(),
    r.category ?? "",
    r.accountName ?? "",
    r.projectName ?? "",
    r.capitalEngine ?? "",
    r.name ?? "",
    r.notes ?? "",
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "transactions.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function TransactionsTable({ data }: { data: TransactionRow[] }) {
  const categoryOptions = getUniqueValues(data, "category");
  const accountOptions = getUniqueValues(data, "accountName");

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => exportToCsv(data)}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-secondary hover:bg-hover/50 transition-colors"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        searchKey="name"
        searchPlaceholder="Search transactions..."
        filterColumn="category"
        filterOptions={categoryOptions}
        emptyTitle="No transactions found"
        emptyDescription="There are no transactions matching your criteria."
      />
    </div>
  );
}
