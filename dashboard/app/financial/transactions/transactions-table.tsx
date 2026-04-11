"use client";

import { useState } from "react";
import Link from "next/link";
import { Download, Plus, Pencil, Trash2, Loader2 } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { CreateModal } from "@/components/crud/create-modal";
import { DeleteDialog } from "@/components/crud/delete-dialog";
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

// ── Form state ──────────────────────────────────────────────────────────────

interface TransactionFormState {
  name: string;
  signedAmount: string;
  category: string;
  date: string;
  notes: string;
  accountId: string;
  transactionType: string;
  capitalEngine: string;
}

const emptyForm: TransactionFormState = {
  name: "",
  signedAmount: "",
  category: "",
  date: new Date().toISOString().split("T")[0],
  notes: "",
  accountId: "",
  transactionType: "",
  capitalEngine: "",
};

// ── Component ───────────────────────────────────────────────────────────────

export function TransactionsTable({
  data,
  accounts = [],
}: {
  data: TransactionRow[];
  accounts?: Array<{ id: string; name: string }>;
}) {
  const [tableData, setTableData] = useState<TransactionRow[]>(data);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<TransactionRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TransactionRow | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState<TransactionFormState>(emptyForm);

  const reload = async () => {
    try {
      const res = await fetch("/api/crud/financial-log?limit=2000&sort=date&order=desc");
      const json = await res.json();
      if (json.success) {
        setTableData(json.data.items);
      }
    } catch {
      // silent
    }
  };

  const openCreate = () => {
    setEditingTx(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (tx: TransactionRow) => {
    setEditingTx(tx);
    setForm({
      name: tx.name ?? "",
      signedAmount: tx.signedAmount ?? "",
      category: tx.category ?? "",
      date: tx.date ? tx.date.split("T")[0] : "",
      notes: tx.notes ?? "",
      accountId: tx.accountId ?? "",
      transactionType: tx.transactionType ?? "",
      capitalEngine: tx.capitalEngine ?? "",
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        signed_amount: form.signedAmount ? parseFloat(form.signedAmount) : undefined,
        category: form.category || undefined,
        date: form.date ? new Date(form.date).toISOString() : undefined,
        notes: form.notes || undefined,
        transaction_type: form.transactionType || undefined,
        capital_engine: form.capitalEngine || undefined,
      };
      if (form.accountId) body.account_id = form.accountId;

      const url = editingTx && editingTx.id
        ? `/api/crud/financial-log/${editingTx.id}`
        : "/api/crud/financial-log";
      const method = editingTx && editingTx.id ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        setModalOpen(false);
        await reload();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget || !deleteTarget.id) return;
    try {
      const res = await fetch(`/api/crud/financial-log/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await reload();
      }
    } finally {
      setDeleteTarget(null);
    }
  };

  const categoryOptions = getUniqueValues(tableData, "category");
  const accountOptions = getUniqueValues(tableData, "accountName");

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
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => openEdit(row.original)}
            className="p-1.5 rounded-md text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => setDeleteTarget(row.original)}
            className="p-1.5 rounded-md text-text-muted hover:text-critical hover:bg-hover transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex-1" />
        <div className="flex items-center gap-3">
          <button
            onClick={() => exportToCsv(tableData)}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-secondary hover:bg-hover/50 transition-colors"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm text-text-primary font-medium hover:bg-accent-hover transition-colors"
          >
            <Plus className="h-4 w-4" />
            Add Transaction
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={tableData}
        searchKey="name"
        searchPlaceholder="Search transactions..."
        filterColumn="category"
        filterOptions={categoryOptions}
        emptyTitle="No transactions found"
        emptyDescription="There are no transactions matching your criteria."
      />

      {/* Create/Edit Modal */}
      <CreateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingTx ? "Edit Transaction" : "Add Transaction"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Amount <span className="text-critical">*</span>
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={form.signedAmount}
                onChange={(e) => setForm({ ...form, signedAmount: e.target.value })}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
                placeholder="e.g., -500 or 1000"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Date <span className="text-critical">*</span>
              </label>
              <input
                type="date"
                required
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Description <span className="text-critical">*</span>
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              placeholder="Transaction description"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Category
              </label>
              <input
                type="text"
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
                placeholder="e.g., Software, Office"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Transaction Type
              </label>
              <input
                type="text"
                value={form.transactionType}
                onChange={(e) => setForm({ ...form, transactionType: e.target.value })}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
                placeholder="e.g., Expense, Income"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Account
              </label>
              <select
                value={form.accountId}
                onChange={(e) => setForm({ ...form, accountId: e.target.value })}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
              >
                <option value="">Select account</option>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Capital Engine
              </label>
              <input
                type="text"
                value={form.capitalEngine}
                onChange={(e) => setForm({ ...form, capitalEngine: e.target.value })}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
                placeholder="e.g., Product, Service"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Notes
            </label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none resize-y"
              rows={3}
              placeholder="Additional notes..."
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-text-secondary hover:bg-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm text-text-primary font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingTx ? "Save Changes" : "Add Transaction"}
            </button>
          </div>
        </form>
      </CreateModal>

      {/* Delete Dialog */}
      <DeleteDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Transaction"
        description="This action cannot be undone. The transaction will be permanently removed."
        itemName={deleteTarget?.name ?? undefined}
      />
    </div>
  );
}
