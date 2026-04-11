"use client";

import { useState } from "react";
import { Plus, Pencil, Trash2, Loader2, ExternalLink } from "lucide-react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-bar";
import { BlockNoteEditor } from "@/components/crud/blocknote-editor";
import { CreateModal } from "@/components/crud/create-modal";
import { DeleteDialog } from "@/components/crud/delete-dialog";
import { truncate } from "@/lib/utils";
import type { StatusKey } from "@/lib/constants";

// ── Types ───────────────────────────────────────────────────────────────────

export interface CampaignRow {
  id: string;
  name: string;
  status: string | null;
  startDate: string | null;
  endDate: string | null;
  durationDays: number | null;
  platforms: string[];
  theme: string | null;
  summary: string | null;
  targetReach: number | null;
  actualReach: number | null;
  engagementRate: string | null;
  budgetAllocated: string | null;
  contentCount: number;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function statusToBadgeKey(status: string | null): StatusKey {
  if (!status) return "neutral";
  const s = status.toLowerCase();
  if (s === "active") return "healthy";
  if (s === "planned" || s === "draft") return "warning";
  if (s === "completed" || s === "archived") return "neutral";
  if (s === "paused" || s === "cancelled") return "critical";
  return "neutral";
}

function reachProgressColor(actual: number | null, target: number | null): "healthy" | "warning" | "critical" | "accent" {
  if (!target || target === 0) return "accent";
  const ratio = (actual || 0) / target;
  if (ratio >= 0.9) return "healthy";
  if (ratio >= 0.5) return "warning";
  return "critical";
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

function getUniqueValues(data: CampaignRow[], key: keyof CampaignRow): { label: string; value: string }[] {
  const set = new Set<string>();
  data.forEach((r) => {
    const v = r[key];
    if (v != null && v !== "") set.add(String(v));
  });
  return Array.from(set).sort().map((v) => ({ label: v, value: v }));
}

// ── Form state ──────────────────────────────────────────────────────────────

interface CampaignFormState {
  name: string;
  status: string;
  startDate: string;
  endDate: string;
  budgetAllocated: string;
  summary: string;
  theme: string;
  platforms: string;
}

const emptyForm: CampaignFormState = {
  name: "",
  status: "draft",
  startDate: "",
  endDate: "",
  budgetAllocated: "",
  summary: "",
  theme: "",
  platforms: "",
};

// ── Component ───────────────────────────────────────────────────────────────

export function CampaignsCrudClient({ campaigns }: { campaigns: CampaignRow[] }) {
  const [data, setData] = useState<CampaignRow[]>(campaigns);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCampaign, setEditingCampaign] = useState<CampaignRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CampaignRow | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState<CampaignFormState>(emptyForm);

  const reload = async () => {
    try {
      const res = await fetch("/api/crud/campaigns?limit=1000&sort=start_date&order=desc");
      const json = await res.json();
      if (json.success) {
        setData(json.data.items);
      }
    } catch {
      // silent
    }
  };

  const openCreate = () => {
    setEditingCampaign(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (c: CampaignRow) => {
    setEditingCampaign(c);
    setForm({
      name: c.name,
      status: c.status ?? "draft",
      startDate: c.startDate ? c.startDate.split("T")[0] : "",
      endDate: c.endDate ? c.endDate.split("T")[0] : "",
      budgetAllocated: c.budgetAllocated ?? "",
      summary: c.summary ?? "",
      theme: c.theme ?? "",
      platforms: Array.isArray(c.platforms) ? c.platforms.join(", ") : "",
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const body: Record<string, unknown> = {
        name: form.name,
        status: form.status || undefined,
        summary: form.summary || undefined,
        theme: form.theme || undefined,
      };
      if (form.startDate) body.start_date = new Date(form.startDate).toISOString();
      if (form.endDate) body.end_date = new Date(form.endDate).toISOString();
      if (form.budgetAllocated) body.budget_allocated = form.budgetAllocated;
      if (form.platforms) body.platforms = form.platforms.split(",").map((p) => p.trim()).filter(Boolean);

      const url = editingCampaign
        ? `/api/crud/campaigns/${editingCampaign.id}`
        : "/api/crud/campaigns";
      const method = editingCampaign ? "PATCH" : "POST";
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
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/crud/campaigns/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await reload();
      }
    } finally {
      setDeleteTarget(null);
    }
  };

  const statusOptions = getUniqueValues(data, "status");

  const columns: ColumnDef<CampaignRow>[] = [
    {
      accessorKey: "name",
      header: "Campaign",
      cell: ({ row }) => {
        const c = row.original;
        return (
          <div className="space-y-1">
            <Link href={`/campaigns/${c.id}`} className="font-medium text-accent-secondary hover:underline">
              {c.name}
            </Link>
            {c.theme && <p className="text-xs text-text-muted">Theme: {c.theme}</p>}
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Status",
      cell: ({ row }) => {
        const v = row.original.status;
        if (!v) return <span className="text-text-muted">—</span>;
        return <Badge status={statusToBadgeKey(v)}>{v}</Badge>;
      },
    },
    {
      accessorKey: "startDate",
      header: "Timeline",
      cell: ({ row }) => {
        const c = row.original;
        return (
          <span className="text-xs text-text-secondary">
            {formatDate(c.startDate)} → {formatDate(c.endDate)}
            {c.durationDays && <span className="text-text-muted ml-1">({c.durationDays}d)</span>}
          </span>
        );
      },
    },
    {
      accessorKey: "targetReach",
      header: "Reach",
      cell: ({ row }) => {
        const c = row.original;
        if (!c.targetReach || c.targetReach === 0) return <span className="text-text-muted">—</span>;
        return (
          <div className="w-32">
            <ProgressBar
              value={c.actualReach || 0}
              max={c.targetReach}
              color={reachProgressColor(c.actualReach, c.targetReach)}
              label={`${(c.actualReach || 0).toLocaleString("en-IN")}`}
            />
          </div>
        );
      },
    },
    {
      accessorKey: "budgetAllocated",
      header: "Budget",
      cell: ({ row }) => row.original.budgetAllocated ?? <span className="text-text-muted">—</span>,
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
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex-1" />
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm text-text-primary font-medium hover:bg-accent-hover transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Campaign
        </button>
      </div>

      {/* DataTable */}
      <DataTable
        columns={columns}
        data={data}
        searchKey="name"
        searchPlaceholder="Search campaigns..."
        filterColumn="status"
        filterOptions={statusOptions}
        emptyTitle="No campaigns found"
        emptyDescription="Create your first campaign to get started."
      />

      {/* Create/Edit Modal */}
      <CreateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingCampaign ? "Edit Campaign" : "New Campaign"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Campaign Name <span className="text-critical">*</span>
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              placeholder="Campaign name"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Status
              </label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
              >
                <option value="draft">Draft</option>
                <option value="planned">Planned</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="completed">Completed</option>
                <option value="cancelled">Cancelled</option>
                <option value="archived">Archived</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Theme
              </label>
              <input
                type="text"
                value={form.theme}
                onChange={(e) => setForm({ ...form, theme: e.target.value })}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
                placeholder="e.g., Brand awareness"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Start Date
              </label>
              <input
                type="date"
                value={form.startDate}
                onChange={(e) => setForm({ ...form, startDate: e.target.value })}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                End Date
              </label>
              <input
                type="date"
                value={form.endDate}
                onChange={(e) => setForm({ ...form, endDate: e.target.value })}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Budget
              </label>
              <input
                type="text"
                value={form.budgetAllocated}
                onChange={(e) => setForm({ ...form, budgetAllocated: e.target.value })}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
                placeholder="e.g., $5,000"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Platforms
              </label>
              <input
                type="text"
                value={form.platforms}
                onChange={(e) => setForm({ ...form, platforms: e.target.value })}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
                placeholder="e.g., LinkedIn, Twitter"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Brief / Summary
            </label>
            <BlockNoteEditor
              initialContent={form.summary}
              onChange={(content) => setForm({ ...form, summary: content })}
              minHeight="200px"
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
              {editingCampaign ? "Save Changes" : "Create Campaign"}
            </button>
          </div>
        </form>
      </CreateModal>

      {/* Delete Dialog */}
      <DeleteDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Campaign"
        description="This action cannot be undone. The campaign will be permanently removed."
        itemName={deleteTarget?.name}
      />
    </div>
  );
}
