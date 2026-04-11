"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Pencil, Trash2, Loader2, Mail } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreateModal } from "@/components/crud/create-modal";
import { DeleteDialog } from "@/components/crud/delete-dialog";
import { cn } from "@/lib/utils";

// ── Types ───────────────────────────────────────────────────────────────────

export interface PersonRow {
  id: string;
  name: string;
  email: string | null;
  relationshipStatus: string | null;
  city: string | null;
  lastConnectedDate: string | null;
  connectionFrequencyDays: number | null;
  networkingProfile: string | null;
  professionalDomain: string | null;
  lastInteractionSentiment: string | null;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function relationshipBadgeKey(status: string | null): "healthy" | "warning" | "critical" | "neutral" {
  if (!status) return "neutral";
  const s = status.toLowerCase();
  if (s.includes("close") || s.includes("strong") || s.includes("active")) return "healthy";
  if (s.includes("warm") || s.includes("developing")) return "warning";
  if (s.includes("cold") || s.includes("lost") || s.includes("dormant")) return "critical";
  return "neutral";
}

function formatDate(d: string | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleDateString("en-IN", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "—";
  }
}

function getUniqueValues(data: PersonRow[], key: keyof PersonRow): { label: string; value: string }[] {
  const set = new Set<string>();
  data.forEach((r) => {
    const v = r[key];
    if (v != null && v !== "") set.add(String(v));
  });
  return Array.from(set).sort().map((v) => ({ label: v, value: v }));
}

// ── Form state ──────────────────────────────────────────────────────────────

interface PersonFormState {
  name: string;
  email: string;
  relationshipStatus: string;
  city: string;
  networkingProfile: string;
  professionalDomain: string;
}

const emptyForm: PersonFormState = {
  name: "",
  email: "",
  relationshipStatus: "",
  city: "",
  networkingProfile: "",
  professionalDomain: "",
};

// ── Component ───────────────────────────────────────────────────────────────

export function PeopleCrudClient({ people }: { people: PersonRow[] }) {
  const [data, setData] = useState<PersonRow[]>(people);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingPerson, setEditingPerson] = useState<PersonRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PersonRow | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState<PersonFormState>(emptyForm);

  const reload = async () => {
    try {
      const res = await fetch("/api/crud/people?limit=1000&sort=name&order=asc");
      const json = await res.json();
      if (json.success) {
        setData(json.data.items);
      }
    } catch {
      // silent
    }
  };

  const openCreate = () => {
    setEditingPerson(null);
    setForm(emptyForm);
    setModalOpen(true);
  };

  const openEdit = (person: PersonRow) => {
    setEditingPerson(person);
    setForm({
      name: person.name,
      email: person.email ?? "",
      relationshipStatus: person.relationshipStatus ?? "",
      city: person.city ?? "",
      networkingProfile: person.networkingProfile ?? "",
      professionalDomain: person.professionalDomain ?? "",
    });
    setModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      const url = editingPerson
        ? `/api/crud/people/${editingPerson.id}`
        : "/api/crud/people";
      const method = editingPerson ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
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
      const res = await fetch(`/api/crud/people/${deleteTarget.id}`, {
        method: "DELETE",
      });
      if (res.ok) {
        await reload();
      }
    } finally {
      setDeleteTarget(null);
    }
  };

  const relationshipOptions = getUniqueValues(data, "relationshipStatus");

  const columns: ColumnDef<PersonRow>[] = [
    {
      accessorKey: "name",
      header: "Name",
      cell: ({ row }) => {
        const p = row.original;
        return (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-elevated flex items-center justify-center flex-shrink-0">
              <span className="text-xs font-heading font-medium text-text-secondary">
                {p.name
                  .split(" ")
                  .map((n) => n[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
            </div>
            <div className="min-w-0">
              <span className="font-medium truncate block">{p.name}</span>
              {p.email && (
                <span className="text-xs text-text-muted flex items-center gap-1">
                  <Mail className="w-3 h-3" />
                  {p.email}
                </span>
              )}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "relationshipStatus",
      header: "Relationship",
      cell: ({ row }) => {
        const v = row.original.relationshipStatus;
        if (!v) return <span className="text-text-muted">—</span>;
        return <Badge status={relationshipBadgeKey(v)}>{v}</Badge>;
      },
    },
    {
      accessorKey: "professionalDomain",
      header: "Domain",
      cell: ({ row }) => row.original.professionalDomain ?? <span className="text-text-muted">—</span>,
    },
    {
      accessorKey: "city",
      header: "City",
      cell: ({ row }) => row.original.city ?? <span className="text-text-muted">—</span>,
    },
    {
      accessorKey: "lastConnectedDate",
      header: "Last Connected",
      cell: ({ row }) => (
        <span className="tabular">{formatDate(row.original.lastConnectedDate)}</span>
      ),
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
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
          {/* Search is handled by DataTable */}
        </div>
        <button
          onClick={openCreate}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm text-text-primary font-medium hover:bg-accent-hover transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Person
        </button>
      </div>

      {/* DataTable */}
      <DataTable
        columns={columns}
        data={data}
        searchKey="name"
        searchPlaceholder="Search people..."
        filterColumn="relationshipStatus"
        filterOptions={relationshipOptions}
        emptyTitle="No people found"
        emptyDescription="Add your first person to get started."
      />

      {/* Create/Edit Modal */}
      <CreateModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editingPerson ? "Edit Person" : "Add Person"}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Name <span className="text-critical">*</span>
            </label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              placeholder="Full name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Email
            </label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              placeholder="email@example.com"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Relationship Status
            </label>
            <input
              type="text"
              value={form.relationshipStatus}
              onChange={(e) => setForm({ ...form, relationshipStatus: e.target.value })}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              placeholder="e.g., Close, Warm, Cold"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                City
              </label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => setForm({ ...form, city: e.target.value })}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
                placeholder="City"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">
                Professional Domain
              </label>
              <input
                type="text"
                value={form.professionalDomain}
                onChange={(e) => setForm({ ...form, professionalDomain: e.target.value })}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
                placeholder="e.g., Engineering"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">
              Networking Profile
            </label>
            <input
              type="text"
              value={form.networkingProfile}
              onChange={(e) => setForm({ ...form, networkingProfile: e.target.value })}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              placeholder="e.g., Mentor, Peer, Investor"
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
              {editingPerson ? "Save Changes" : "Add Person"}
            </button>
          </div>
        </form>
      </CreateModal>

      {/* Delete Dialog */}
      <DeleteDialog
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Person"
        description="This action cannot be undone. The person will be permanently removed."
        itemName={deleteTarget?.name}
      />
    </div>
  );
}
