"use client";

import { useState } from "react";
import Link from "next/link";
import type { ColumnDef } from "@tanstack/react-table";
import { DataTable } from "@/components/ui/data-table";
import { formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { CreateModal } from "@/components/crud/create-modal";
import { DeleteDialog } from "@/components/crud/delete-dialog";
import { Plus, Pencil, Trash2, Loader2, Check } from "lucide-react";
import { toast } from "sonner";

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

const STATUS_OPTIONS = ["To Do", "In Progress", "Done", "Blocked"];
const PRIORITY_OPTIONS = ["low", "medium", "high", "urgent"];

interface TaskTableProps {
  data: TaskRow[];
  onMutate?: () => void;
}

function getUniqueValues(data: TaskRow[], key: keyof TaskRow): { label: string; value: string }[] {
  const set = new Set<string>();
  data.forEach((r) => {
    const v = r[key];
    if (v != null) set.add(String(v));
  });
  return Array.from(set).sort().map((v) => ({ label: v, value: v }));
}

function TaskForm({
  initial,
  onSubmit,
  submitLabel = "Create",
}: {
  initial?: Partial<TaskRow>;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  submitLabel?: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [assignee, setAssignee] = useState(initial?.assignee ?? "");
  const [priority, setPriority] = useState(initial?.priority ?? "medium");
  const [actionDate, setActionDate] = useState(
    initial?.actionDate ? String(initial.actionDate).split("T")[0] : "",
  );
  const [status, setStatus] = useState(initial?.status ?? "To Do");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({ name, assignee, priority, actionDate, status });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs text-text-secondary mb-1">Title *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong placeholder:text-text-muted"
          placeholder="Task title..."
          autoFocus
          required
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-text-secondary mb-1">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
          >
            {STATUS_OPTIONS.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-xs text-text-secondary mb-1">Priority</label>
          <select
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
          >
            {PRIORITY_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-text-secondary mb-1">Assignee</label>
          <input
            type="text"
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong placeholder:text-text-muted"
            placeholder="Assignee..."
          />
        </div>
        <div>
          <label className="block text-xs text-text-secondary mb-1">Due Date</label>
          <input
            type="date"
            value={actionDate}
            onChange={(e) => setActionDate(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
          />
        </div>
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button
          type="submit"
          disabled={submitting || !name.trim()}
          className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm text-text-primary font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
        >
          {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {submitting ? "Saving..." : submitLabel}
        </button>
      </div>
    </form>
  );
}

export function TasksTable({ data, onMutate }: TaskTableProps) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<TaskRow | null>(null);
  const [deleteTask, setDeleteTask] = useState<TaskRow | null>(null);
  const [inlineStatusRow, setInlineStatusRow] = useState<string | null>(null);

  const handleCreate = async (formData: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/crud/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error("Failed to create task");
      toast.success("Task created");
      setCreateOpen(false);
      onMutate?.();
    } catch {
      toast.error("Failed to create task");
    }
  };

  const handleUpdate = async (id: string, formData: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/crud/tasks/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      if (!res.ok) throw new Error("Failed to update task");
      toast.success("Task updated");
      setEditTask(null);
      onMutate?.();
    } catch {
      toast.error("Failed to update task");
    }
  };

  const handleDelete = async () => {
    if (!deleteTask) return;
    try {
      const res = await fetch(`/api/crud/tasks/${deleteTask.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete task");
      toast.success("Task deleted");
      setDeleteTask(null);
      onMutate?.();
    } catch {
      toast.error("Failed to delete task");
    }
  };

  const handleInlineStatus = async (taskId: string, newStatus: string) => {
    setInlineStatusRow(taskId);
    try {
      const res = await fetch(`/api/crud/tasks/${taskId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      if (!res.ok) throw new Error("Failed to update status");
      toast.success("Status updated");
      onMutate?.();
    } catch {
      toast.error("Failed to update status");
    } finally {
      setInlineStatusRow(null);
    }
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
      cell: ({ row }) => {
        const task = row.original;
        const taskId = String(task.id);
        const isUpdating = inlineStatusRow === taskId;
        return (
          <div className="relative inline-block">
            <select
              value={task.status ?? ""}
              onChange={(e) => handleInlineStatus(taskId, e.target.value)}
              disabled={isUpdating}
              className="appearance-none rounded-full border border-border bg-surface px-3 py-0.5 text-xs font-medium text-text-primary outline-none focus:border-border-strong cursor-pointer pr-6 disabled:opacity-50"
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            {isUpdating && (
              <Loader2 className="h-3 w-3 animate-spin absolute right-1.5 top-1/2 -translate-y-1/2 text-text-muted" />
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "priority",
      header: "Priority",
      cell: ({ row }) => {
        const p = row.original.priority;
        const color = p === "high" || p === "urgent" ? "text-critical" : p === "medium" ? "text-warning" : "text-healthy";
        return <span className={cn("text-xs font-medium", color)}>{p ?? "—"}</span>;
      },
    },
    {
      accessorKey: "actionDate",
      header: "Due",
      cell: ({ row }) => formatDate(row.original.actionDate),
    },
    { accessorKey: "assignee", header: "Assignee" },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => {
        const task = row.original;
        return (
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => setEditTask(task)}
              className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
              aria-label="Edit task"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setDeleteTask(task)}
              className="p-1 rounded text-text-muted hover:text-critical hover:bg-hover transition-colors"
              aria-label="Delete task"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      },
    },
  ];

  const statusOptions = getUniqueValues(data, "status");

  return (
    <>
      <div className="flex justify-end mb-2">
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm text-text-primary font-medium hover:bg-accent-hover transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Task
        </button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        searchKey="name"
        searchPlaceholder="Search tasks..."
        filterColumn="status"
        filterOptions={statusOptions}
        emptyTitle="No tasks found"
        emptyDescription="There are no tasks matching your criteria."
        className="[&_[role=row]]:group"
      />

      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Task">
        <TaskForm onSubmit={handleCreate} />
      </CreateModal>

      <CreateModal open={editTask !== null} onClose={() => setEditTask(null)} title="Edit Task">
        {editTask && (
          <TaskForm
            initial={editTask}
            onSubmit={(formData) => handleUpdate(String(editTask.id), formData)}
            submitLabel="Update"
          />
        )}
      </CreateModal>

      <DeleteDialog
        open={deleteTask !== null}
        onClose={() => setDeleteTask(null)}
        onConfirm={handleDelete}
        title="Delete Task"
        description="This action cannot be undone. The task will be permanently removed."
        itemName={deleteTask?.name ?? ""}
      />
    </>
  );
}
