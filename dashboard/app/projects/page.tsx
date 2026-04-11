"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { FolderKanban, Search, Plus, Pencil, Trash2, Loader2, Check } from "lucide-react";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { CreateModal } from "@/components/crud/create-modal";
import { DeleteDialog } from "@/components/crud/delete-dialog";
import { BlockNoteEditor } from "@/components/crud/blocknote-editor";
import { toast } from "sonner";
import type { StatusKey } from "@/lib/constants";

const statusToBadge: Record<string, StatusKey> = {
  "On Track": "healthy",
  "At Risk": "warning",
  "Off Track": "critical",
};

const STATUS_OPTIONS = ["On Track", "At Risk", "Off Track", "Not Started"];
const PHASE_OPTIONS = ["Planning", "Execution", "Review", "Completed"];
const PRIORITY_OPTIONS = ["low", "medium", "high", "critical"];

interface ProjectRow {
  id: string;
  name: string | null;
  status: string | null;
  health_score: number | null;
  progress_pct: number | null;
  team_size: number | null;
  description?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  phase?: string | null;
  priority?: string | null;
  team?: string | null;
}

function ProjectForm({
  initial,
  onSubmit,
  submitLabel = "Create",
}: {
  initial?: Partial<ProjectRow>;
  onSubmit: (data: Record<string, unknown>) => Promise<void>;
  submitLabel?: string;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [status, setStatus] = useState(initial?.status ?? "Not Started");
  const [phase, setPhase] = useState(initial?.phase ?? "Planning");
  const [priority, setPriority] = useState(initial?.priority ?? "medium");
  const [startDate, setStartDate] = useState(initial?.start_date ?? "");
  const [endDate, setEndDate] = useState(initial?.end_date ?? "");
  const [team, setTeam] = useState(initial?.team ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await onSubmit({ name, status, phase, priority, start_date: startDate || null, end_date: endDate || null, team, description });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-xs text-text-secondary mb-1">Project Name *</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong placeholder:text-text-muted"
          placeholder="Project name..."
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
          <label className="block text-xs text-text-secondary mb-1">Phase</label>
          <select
            value={phase}
            onChange={(e) => setPhase(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
          >
            {PHASE_OPTIONS.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
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
        <div>
          <label className="block text-xs text-text-secondary mb-1">Team</label>
          <input
            type="text"
            value={team}
            onChange={(e) => setTeam(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong placeholder:text-text-muted"
            placeholder="Team members..."
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-text-secondary mb-1">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
          />
        </div>
        <div>
          <label className="block text-xs text-text-secondary mb-1">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-text-secondary mb-1">Description</label>
        <BlockNoteEditor
          initialContent={description || undefined}
          onChange={setDescription}
          minHeight="120px"
        />
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

export default function ProjectsPage() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editProject, setEditProject] = useState<ProjectRow | null>(null);
  const [deleteProject, setDeleteProject] = useState<ProjectRow | null>(null);

  const fetchProjects = async () => {
    try {
      const res = await fetch("/api/crud/projects?limit=100&sort=created_at&order=desc");
      if (!res.ok) throw new Error("Failed to fetch");
      const json = await res.json();
      setProjects(json.data?.items ?? []);
    } catch {
      setProjects([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProjects();
  }, []);

  const handleCreate = async (data: Record<string, unknown>) => {
    try {
      const res = await fetch("/api/crud/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to create");
      toast.success("Project created");
      setCreateOpen(false);
      fetchProjects();
    } catch {
      toast.error("Failed to create project");
    }
  };

  const handleUpdate = async (id: string, data: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/crud/projects/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      toast.success("Project updated");
      setEditProject(null);
      fetchProjects();
    } catch {
      toast.error("Failed to update project");
    }
  };

  const handleDelete = async () => {
    if (!deleteProject) return;
    try {
      const res = await fetch(`/api/crud/projects/${deleteProject.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Project deleted");
      setDeleteProject(null);
      fetchProjects();
    } catch {
      toast.error("Failed to delete project");
    }
  };

  const statusCounts = { healthy: 0, warning: 0, critical: 0, neutral: 0 };
  projects.forEach((p) => {
    const bk = statusToBadge[p.status ?? ""] ?? "neutral";
    statusCounts[bk]++;
  });

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton variant="table" lines={10} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">Projects</h1>
          <p className="text-sm text-text-secondary mt-1">Monitor project health and progress</p>
        </div>
        <button
          onClick={() => setCreateOpen(true)}
          className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm text-text-primary font-medium hover:bg-accent-hover transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Project
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Projects" value={projects.length} icon={FolderKanban} />
        <StatCard title="On Track" value={statusCounts.healthy} icon={FolderKanban} />
        <StatCard title="At Risk" value={statusCounts.warning} icon={FolderKanban} />
        <StatCard title="Off Track" value={statusCounts.critical} icon={FolderKanban} />
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-default bg-elevated">
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Project</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Status</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Health</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Score</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Progress</th>
                  <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Team</th>
                  <th className="text-right text-xs font-medium text-text-muted px-5 py-3">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-default">
                {projects.length > 0 ? projects.map((p) => {
                  const bk = statusToBadge[p.status ?? ""] ?? "neutral";
                  return (
                    <tr key={p.id} className="hover:bg-hover/50 transition-colors group">
                      <td className="px-5 py-4">
                        <Link href={`/projects/${p.id}`} className="flex items-center gap-3 text-accent-secondary hover:underline">
                          <FolderKanban className="w-4 h-4 text-text-muted shrink-0" />
                          <span className="text-sm font-medium text-text-primary">{p.name || "Unnamed"}</span>
                        </Link>
                      </td>
                      <td className="px-5 py-4"><Badge status={bk}>{p.status}</Badge></td>
                      <td className="px-5 py-4 tabular text-text-secondary">{p.health_score ?? "—"}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-2">
                          <div className="w-24 h-2 bg-hover rounded-full overflow-hidden">
                            <div className="h-full bg-accent rounded-full" style={{ width: `${p.progress_pct ?? 0}%` }} />
                          </div>
                          <span className="text-xs text-text-muted tabular">{p.progress_pct ?? 0}%</span>
                        </div>
                      </td>
                      <td className="px-5 py-4 text-sm text-text-secondary tabular">{p.team_size ?? "—"}</td>
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => setEditProject(p)}
                            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
                            aria-label="Edit project"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setDeleteProject(p)}
                            className="p-1 rounded text-text-muted hover:text-critical hover:bg-hover transition-colors"
                            aria-label="Delete project"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                }) : (
                  <tr>
                    <td colSpan={7} className="px-5 py-12 text-center text-sm text-text-muted">
                      <div className="flex flex-col items-center gap-2">
                        <Search className="w-8 h-8" />
                        <p>No projects found</p>
                        <button
                          onClick={() => setCreateOpen(true)}
                          className="text-accent-secondary hover:underline text-sm"
                        >
                          Create your first project
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <CreateModal open={createOpen} onClose={() => setCreateOpen(false)} title="Create Project">
        <ProjectForm onSubmit={handleCreate} />
      </CreateModal>

      <CreateModal open={editProject !== null} onClose={() => setEditProject(null)} title="Edit Project">
        {editProject && (
          <ProjectForm
            initial={editProject}
            onSubmit={(data) => handleUpdate(editProject.id, data)}
            submitLabel="Update"
          />
        )}
      </CreateModal>

      <DeleteDialog
        open={deleteProject !== null}
        onClose={() => setDeleteProject(null)}
        onConfirm={handleDelete}
        title="Delete Project"
        description="This action cannot be undone. The project will be permanently removed."
        itemName={deleteProject?.name ?? ""}
      />
    </div>
  );
}
