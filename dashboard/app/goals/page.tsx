'use client';

import { useState, useCallback, useEffect } from 'react';
import { Target, ClipboardList, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ProgressBar } from '@/components/ui/progress-bar';
import { Modal } from '@/components/ui/modal';
import { formatNumber } from '@/lib/formatters';
import { BlockNoteEditor } from '@/components/crud/blocknote-editor';
import type { StatusKey } from '@/lib/constants';

// ─── Types ───────────────────────────────────────────────────────────────

interface AnnualGoal {
  id: string;
  name: string | null;
  status: string | null;
  goal_progress: string | null;
  goal_archetype: string | null;
  strategic_approach: string | null;
  success_condition: string | null;
  planned_range: string | null;
  the_epic: string | null;
  is_current_goal: boolean | null;
  data_source_id: string;
  years_id: string | null;
  created_at: string;
}

interface QuarterlyGoal {
  id: string;
  name: string | null;
  status: string | null;
  goal_progress: string | null;
  progress: string | null;
  health: string | null;
  key_result_1: string | null;
  key_result_2: string | null;
  key_result_3: string | null;
  key_learning: string | null;
  is_current_goal: boolean | null;
  annual_goal_id: string | null;
  data_source_id: string;
  created_at: string;
}

type GoalType = 'annual' | 'quarterly';

// ─── CRUD helpers ────────────────────────────────────────────────────────

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json.data ?? json;
}

const goalStatusToBadge: Record<string, StatusKey> = {
  Complete: 'healthy',
  Achieved: 'healthy',
  'In Progress': 'warning',
  Missed: 'critical',
};

function goalHealthToColor(health: string | null): 'healthy' | 'warning' | 'critical' | 'accent' {
  if (!health) return 'accent';
  const lower = health.toLowerCase();
  if (lower === 'on track' || lower === 'good') return 'healthy';
  if (lower === 'at risk' || lower === 'warning') return 'warning';
  if (lower === 'off track' || lower === 'critical' || lower === 'bad') return 'critical';
  return 'accent';
}

// ─── Goal Form Modal ─────────────────────────────────────────────────────

interface GoalFormProps {
  type: GoalType;
  existing?: AnnualGoal | QuarterlyGoal | null;
  onSave: () => void;
  onClose: () => void;
}

function GoalForm({ type, existing, onSave, onClose }: GoalFormProps) {
  const entity = type === 'annual' ? 'goals-annual' : 'goals-quarterly';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(existing?.name ?? '');
  const [status, setStatus] = useState(existing?.status ?? 'Draft');
  const [goalArchetype, setGoalArchetype] = useState(
    (existing as AnnualGoal | undefined)?.goal_archetype ?? '',
  );
  const [strategicApproach, setStrategicApproach] = useState(
    (existing as AnnualGoal | undefined)?.strategic_approach ?? '',
  );
  const [progress, setProgress] = useState(
    (existing as QuarterlyGoal | undefined)?.progress ??
      (existing as AnnualGoal | undefined)?.goal_progress ??
      '',
  );
  const [health, setHealth] = useState(
    (existing as QuarterlyGoal | undefined)?.health ?? '',
  );
  const [dataSourceId, setDataSourceId] = useState(
    (existing as AnnualGoal | QuarterlyGoal | undefined)?.data_source_id ?? '',
  );
  const [keyResult1, setKeyResult1] = useState(
    (existing as QuarterlyGoal | undefined)?.key_result_1 ?? '',
  );
  const [keyResult2, setKeyResult2] = useState(
    (existing as QuarterlyGoal | undefined)?.key_result_2 ?? '',
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setLoading(true);
      try {
        const body: Record<string, unknown> = { name };
        if (dataSourceId) body.data_source_id = dataSourceId;
        if (status) body.status = status;
        if (type === 'annual') {
          if (goalArchetype) body.goal_archetype = goalArchetype;
          if (strategicApproach) body.strategic_approach = strategicApproach;
          if (progress) body.goal_progress = progress;
        } else {
          if (progress) body.progress = progress;
          if (health) body.health = health;
          if (keyResult1) body.key_result_1 = keyResult1;
          if (keyResult2) body.key_result_2 = keyResult2;
        }

        if (existing) {
          await fetchJson(`/api/crud/${entity}/${existing.id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          });
        } else {
          await fetchJson(`/api/crud/${entity}`, {
            method: 'POST',
            body: JSON.stringify(body),
          });
        }
        onSave();
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : 'Failed to save');
      } finally {
        setLoading(false);
      }
    },
    [
      entity, existing, name, status, goalArchetype, strategicApproach,
      progress, health, keyResult1, keyResult2, dataSourceId, type, onSave,
    ],
  );

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? `Edit ${type === 'annual' ? 'Annual' : 'Quarterly'} Goal` : `New ${type === 'annual' ? 'Annual' : 'Quarterly'} Goal`}
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md border border-border bg-critical/10 px-4 py-2 text-sm text-critical">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Name *</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
            placeholder="Goal name"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
            >
              <option value="Draft">Draft</option>
              <option value="Planning">Planning</option>
              <option value="In Progress">In Progress</option>
              <option value="Complete">Complete</option>
              <option value="Achieved">Achieved</option>
              <option value="Missed">Missed</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Data Source ID</label>
            <input
              type="text"
              value={dataSourceId}
              onChange={(e) => setDataSourceId(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              placeholder="UUID"
            />
          </div>
        </div>

        {type === 'annual' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Goal Archetype</label>
                <input
                  type="text"
                  value={goalArchetype}
                  onChange={(e) => setGoalArchetype(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
                  placeholder="e.g., Growth, Maintenance"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Progress</label>
                <input
                  type="text"
                  value={progress}
                  onChange={(e) => setProgress(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
                  placeholder="e.g., 50%"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Strategic Approach</label>
              <BlockNoteEditor
                initialContent={strategicApproach}
                onChange={(content) => setStrategicApproach(content)}
                minHeight="200px"
              />
            </div>
          </>
        )}

        {type === 'quarterly' && (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Progress (%)</label>
                <input
                  type="text"
                  value={progress}
                  onChange={(e) => setProgress(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
                  placeholder="e.g., 75"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-secondary mb-1">Health</label>
                <select
                  value={health}
                  onChange={(e) => setHealth(e.target.value)}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
                >
                  <option value="">—</option>
                  <option value="On Track">On Track</option>
                  <option value="At Risk">At Risk</option>
                  <option value="Off Track">Off Track</option>
                  <option value="Good">Good</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Key Result 1</label>
              <input
                type="text"
                value={keyResult1}
                onChange={(e) => setKeyResult1(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Key Result 2</label>
              <input
                type="text"
                value={keyResult2}
                onChange={(e) => setKeyResult2(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              />
            </div>
          </>
        )}

        <div className="flex justify-end gap-3 pt-4 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-text-secondary hover:bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={loading || !name.trim()}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {existing ? 'Update' : 'Create'} Goal
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Confirm Delete Modal ────────────────────────────────────────────────

function ConfirmDelete({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    setLoading(true);
    try {
      await onConfirm();
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal open onClose={onCancel} title="Confirm Delete" size="sm">
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Are you sure you want to delete <span className="text-text-primary font-medium">&quot;{name}&quot;</span>? This action cannot be undone.
        </p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="rounded-md border border-border bg-surface px-4 py-2 text-sm text-text-secondary hover:bg-hover transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-md bg-critical/20 px-4 py-2 text-sm text-critical hover:bg-critical/30 disabled:opacity-50 transition-colors"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            Delete
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Goals Table (client) ────────────────────────────────────────────────

function AnnualGoalsTable({
  data,
  onRefresh,
}: {
  data: AnnualGoal[];
  onRefresh: () => void;
}) {
  const [editGoal, setEditGoal] = useState<AnnualGoal | null>(null);
  const [deleteGoal, setDeleteGoal] = useState<AnnualGoal | null>(null);
  const entity = 'goals-annual';

  const handleDelete = useCallback(
    async (goal: AnnualGoal) => {
      try {
        await fetchJson(`/api/crud/${entity}/${goal.id}`, { method: 'DELETE' });
        onRefresh();
      } catch {
        // error handled by ConfirmDelete
      }
    },
    [entity, onRefresh],
  );

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-4 rounded-full bg-hover p-4 text-text-muted">
          <Target className="h-8 w-8" />
        </div>
        <h3 className="mb-1 text-lg font-medium text-text-primary">No annual goals</h3>
        <p className="text-sm text-text-secondary">Annual goals will appear here once defined</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-default bg-elevated">
            <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Goal</th>
            <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Status</th>
            <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Archetype</th>
            <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Strategic Approach</th>
            <th className="text-left text-xs font-medium text-text-muted px-5 py-3 w-24">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-default">
          {data.map((g) => {
            const statusBadge = goalStatusToBadge[g.status ?? ''] ?? 'neutral';
            return (
              <tr key={g.id} className="hover:bg-hover/50 transition-colors">
                <td className="px-5 py-4">
                  <Link
                    href={`/goals/annual/${g.id}`}
                    className="text-sm font-medium text-text-primary hover:text-accent-secondary transition-colors"
                  >
                    {g.name || 'Unnamed'}
                  </Link>
                </td>
                <td className="px-5 py-4"><Badge status={statusBadge} /></td>
                <td className="px-5 py-4 text-sm text-text-secondary tabular">
                  {g.goal_archetype || '\u2014'}
                </td>
                <td className="px-5 py-4 text-sm text-text-secondary max-w-xs truncate">
                  {g.strategic_approach || '\u2014'}
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditGoal(g)}
                      className="p-1.5 rounded-md text-text-muted hover:text-accent-secondary hover:bg-hover transition-colors"
                      aria-label="Edit goal"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteGoal(g)}
                      className="p-1.5 rounded-md text-text-muted hover:text-critical hover:bg-hover transition-colors"
                      aria-label="Delete goal"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {editGoal && (
        <GoalForm
          type="annual"
          existing={editGoal}
          onSave={() => {
            setEditGoal(null);
            onRefresh();
          }}
          onClose={() => setEditGoal(null)}
        />
      )}

      {deleteGoal && (
        <ConfirmDelete
          name={deleteGoal.name || 'Unnamed'}
          onConfirm={() => handleDelete(deleteGoal)}
          onCancel={() => setDeleteGoal(null)}
        />
      )}
    </div>
  );
}

function QuarterlyGoalsTable({
  data,
  onRefresh,
}: {
  data: QuarterlyGoal[];
  onRefresh: () => void;
}) {
  const [editGoal, setEditGoal] = useState<QuarterlyGoal | null>(null);
  const [deleteGoal, setDeleteGoal] = useState<QuarterlyGoal | null>(null);
  const entity = 'goals-quarterly';

  const handleDelete = useCallback(
    async (goal: QuarterlyGoal) => {
      try {
        await fetchJson(`/api/crud/${entity}/${goal.id}`, { method: 'DELETE' });
        onRefresh();
      } catch {
        // error handled by ConfirmDelete
      }
    },
    [entity, onRefresh],
  );

  if (data.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mb-4 rounded-full bg-hover p-4 text-text-muted">
          <ClipboardList className="h-8 w-8" />
        </div>
        <h3 className="mb-1 text-lg font-medium text-text-primary">No quarterly goals</h3>
        <p className="text-sm text-text-secondary">Quarterly goals will appear here once defined</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border-default bg-elevated">
            <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Goal</th>
            <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Status</th>
            <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Progress</th>
            <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Health</th>
            <th className="text-left text-xs font-medium text-text-muted px-5 py-3">Key Results</th>
            <th className="text-left text-xs font-medium text-text-muted px-5 py-3 w-24">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border-default">
          {data.map((g) => {
            const statusBadge = goalStatusToBadge[g.status ?? ''] ?? 'neutral';
            const progressVal = g.progress ? parseFloat(g.progress) || 0 : 0;
            return (
              <tr key={g.id} className="hover:bg-hover/50 transition-colors">
                <td className="px-5 py-4">
                  <Link
                    href={`/goals/quarterly/${g.id}`}
                    className="text-sm font-medium text-text-primary hover:text-accent-secondary transition-colors"
                  >
                    {g.name || 'Unnamed'}
                  </Link>
                </td>
                <td className="px-5 py-4"><Badge status={statusBadge} /></td>
                <td className="px-5 py-4 w-48">
                  <ProgressBar
                    value={progressVal}
                    color={goalHealthToColor(g.health)}
                    showLabel
                  />
                </td>
                <td className="px-5 py-4">
                  <Badge
                    status={
                      goalHealthToColor(g.health) === 'accent'
                        ? 'neutral'
                        : (goalHealthToColor(g.health) as StatusKey)
                    }
                  />
                </td>
                <td className="px-5 py-4 text-sm text-text-secondary max-w-md">
                  {[g.key_result_1, g.key_result_2, g.key_result_3]
                    .filter(Boolean)
                    .slice(0, 2)
                    .join(' \u00b7 ') || '\u2014'}
                </td>
                <td className="px-5 py-4">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setEditGoal(g)}
                      className="p-1.5 rounded-md text-text-muted hover:text-accent-secondary hover:bg-hover transition-colors"
                      aria-label="Edit goal"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setDeleteGoal(g)}
                      className="p-1.5 rounded-md text-text-muted hover:text-critical hover:bg-hover transition-colors"
                      aria-label="Delete goal"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {editGoal && (
        <GoalForm
          type="quarterly"
          existing={editGoal}
          onSave={() => {
            setEditGoal(null);
            onRefresh();
          }}
          onClose={() => setEditGoal(null)}
        />
      )}

      {deleteGoal && (
        <ConfirmDelete
          name={deleteGoal.name || 'Unnamed'}
          onConfirm={() => handleDelete(deleteGoal)}
          onCancel={() => setDeleteGoal(null)}
        />
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────

export default function GoalsPage() {
  const [annualGoals, setAnnualGoals] = useState<AnnualGoal[]>([]);
  const [quarterlyGoals, setQuarterlyGoals] = useState<QuarterlyGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalType, setModalType] = useState<GoalType | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [annualRes, quarterlyRes] = await Promise.all([
        fetchJson<{ items: AnnualGoal[] }>('/api/crud/goals-annual?limit=100'),
        fetchJson<{ items: QuarterlyGoal[] }>('/api/crud/goals-quarterly?limit=100'),
      ]);
      setAnnualGoals(annualRes.items);
      setQuarterlyGoals(quarterlyRes.items);
    } catch {
      setAnnualGoals([]);
      setQuarterlyGoals([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const annualActive = annualGoals.filter(
    (g) => goalStatusToBadge[g.status ?? ''] === 'warning',
  ).length;
  const quarterlyActive = quarterlyGoals.filter(
    (g) => goalStatusToBadge[g.status ?? ''] === 'warning',
  ).length;

  if (loading) {
    return (
      <div className="space-y-8">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">Goals Dashboard</h1>
          <p className="text-sm text-text-secondary mt-1">Track annual and quarterly goal progress</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-hover animate-pulse" />
          ))}
        </div>
        <div className="h-64 rounded-lg bg-hover animate-pulse" />
        <div className="h-48 rounded-lg bg-hover animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading text-2xl font-semibold text-text-primary">Goals Dashboard</h1>
          <p className="text-sm text-text-secondary mt-1">Track annual and quarterly goal progress</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setModalType('annual')}
            className="inline-flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-secondary hover:bg-hover transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Annual Goal
          </button>
          <button
            onClick={() => setModalType('quarterly')}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-2 text-sm text-white hover:bg-accent-hover transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Quarterly Goal
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Annual Goals" value={formatNumber(annualGoals.length)} icon={Target} />
        <StatCard title="Active Annual Goals" value={formatNumber(annualActive)} icon={Target} />
        <StatCard title="Total Quarterly Goals" value={formatNumber(quarterlyGoals.length)} icon={ClipboardList} />
        <StatCard title="Active Quarterly Goals" value={formatNumber(quarterlyActive)} icon={ClipboardList} />
      </div>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider">
            Annual Goals
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          <AnnualGoalsTable data={annualGoals} onRefresh={fetchData} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <h2 className="text-sm font-medium text-text-secondary uppercase tracking-wider">
            Quarterly Goals
          </h2>
        </CardHeader>
        <CardContent className="p-0">
          <QuarterlyGoalsTable data={quarterlyGoals} onRefresh={fetchData} />
        </CardContent>
      </Card>

      {modalType && (
        <GoalForm
          type={modalType}
          onSave={() => {
            setModalType(null);
            fetchData();
          }}
          onClose={() => setModalType(null)}
        />
      )}
    </div>
  );
}
