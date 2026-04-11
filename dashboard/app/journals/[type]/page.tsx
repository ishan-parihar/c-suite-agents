'use client';

import { useState, useCallback, useEffect, Suspense } from 'react';
import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft, Pen, UsersRound, Network, Apple, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { DataTable } from '@/components/ui/data-table';
import { Card, CardContent } from '@/components/ui/card';
import { Modal } from '@/components/ui/modal';
import { formatDate } from '@/lib/formatters';
import type { ColumnDef } from '@tanstack/react-table';

// ─── Types ───────────────────────────────────────────────────────────────

type JournalType = 'subjective' | 'relational' | 'systemic' | 'diet';

const TYPE_CONFIG: Record<JournalType, { label: string; icon: typeof Pen; entity: string }> = {
  subjective: { label: 'Subjective', icon: Pen, entity: 'journal-subjective' },
  relational: { label: 'Relational', icon: UsersRound, entity: 'journal-relational' },
  systemic: { label: 'Systemic', icon: Network, entity: 'journal-systemic' },
  diet: { label: 'Diet Log', icon: Apple, entity: 'journal-diet' },
};

interface JournalRow {
  id: string;
  name: string | null;
  date: string | null;
  [key: string]: unknown;
}

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

// ─── Confirm Delete ──────────────────────────────────────────────────────

function ConfirmDelete({
  name,
  onConfirm,
  onCancel,
}: {
  name: string;
  onConfirm: () => Promise<void>;
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
          Are you sure you want to delete{' '}
          <span className="text-text-primary font-medium">&quot;{name}&quot;</span>? This action cannot be undone.
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

// ─── Entry Form Modal ────────────────────────────────────────────────────

interface EntryFormProps {
  type: JournalType;
  existing?: JournalRow | null;
  onSave: () => void;
  onClose: () => void;
}

function EntryForm({ type, existing, onSave, onClose }: EntryFormProps) {
  const config = TYPE_CONFIG[type];
  // Map type to entity slug — diet uses a different table name
  const entitySlug = type === 'diet' ? 'journal-diet' : config.entity;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(existing?.name ?? '');
  const [date, setDate] = useState(existing?.date ? new Date(existing.date).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]);
  const [mood, setMood] = useState((existing as Record<string, unknown>)?.mood as string ?? '');
  const [stressLevel, setStressLevel] = useState((existing as Record<string, unknown>)?.stress_level as string ?? '');
  const [energyLevel, setEnergyLevel] = useState((existing as Record<string, unknown>)?.energy_level as string ?? '');
  const [interactionType, setInteractionType] = useState((existing as Record<string, unknown>)?.interaction_type as string ?? '');
  const [sentiment, setSentiment] = useState((existing as Record<string, unknown>)?.sentiment as string ?? '');
  const [impact, setImpact] = useState((existing as Record<string, unknown>)?.impact as string ?? '');
  const [mealType, setMealType] = useState((existing as Record<string, unknown>)?.meal_type as string ?? '');
  const [calories, setCalories] = useState((existing as Record<string, unknown>)?.calories as string ?? '');

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setLoading(true);
      try {
        const body: Record<string, unknown> = { name, date };
        if (type === 'subjective') {
          if (stressLevel) body.stress_level = stressLevel;
          if (energyLevel) body.energy_level = energyLevel;
          if (mood) body.mood = mood;
        } else if (type === 'relational') {
          if (interactionType) body.interaction_type = interactionType;
          if (sentiment) body.sentiment = sentiment;
        } else if (type === 'systemic') {
          if (impact) body.impact = impact;
        } else if (type === 'diet') {
          if (mealType) body.meal_type = mealType;
          if (calories) body.calories = parseInt(calories, 10);
          if (mood) body.mood = mood;
        }

        if (existing) {
          await fetchJson(`/api/crud/${entitySlug}/${existing.id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          });
        } else {
          await fetchJson(`/api/crud/${entitySlug}`, {
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
    [entitySlug, existing, name, date, mood, stressLevel, energyLevel, interactionType, sentiment, impact, mealType, calories, type, onSave],
  );

  return (
    <Modal open onClose={onClose} title={existing ? 'Edit Entry' : 'New Entry'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md border border-border bg-critical/10 px-4 py-2 text-sm text-critical">
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              placeholder="Entry title"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
            />
          </div>
        </div>

        {type === 'subjective' && (
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Mood</label>
              <input
                type="text"
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
                placeholder="e.g., happy"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Stress Level</label>
              <select
                value={stressLevel}
                onChange={(e) => setStressLevel(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
              >
                <option value="">—</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Energy Level</label>
              <select
                value={energyLevel}
                onChange={(e) => setEnergyLevel(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
              >
                <option value="">—</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </div>
          </div>
        )}

        {type === 'relational' && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Interaction Type</label>
              <input
                type="text"
                value={interactionType}
                onChange={(e) => setInteractionType(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Sentiment</label>
              <select
                value={sentiment}
                onChange={(e) => setSentiment(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
              >
                <option value="">—</option>
                <option value="positive">Positive</option>
                <option value="neutral">Neutral</option>
                <option value="negative">Negative</option>
              </select>
            </div>
          </div>
        )}

        {type === 'systemic' && (
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Impact</label>
            <select
              value={impact}
              onChange={(e) => setImpact(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
            >
              <option value="">—</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </div>
        )}

        {type === 'diet' && (
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Meal Type</label>
              <input
                type="text"
                value={mealType}
                onChange={(e) => setMealType(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Calories</label>
              <input
                type="number"
                value={calories}
                onChange={(e) => setCalories(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-text-secondary mb-1">Mood</label>
              <input
                type="text"
                value={mood}
                onChange={(e) => setMood(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              />
            </div>
          </div>
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
            {existing ? 'Update' : 'Create'} Entry
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Page Content ────────────────────────────────────────────────────────

function JournalsPageContent({ type }: { type: string }) {
  const journalType = type as JournalType;
  const config = TYPE_CONFIG[journalType];
  const Icon = config?.icon ?? Pen;
  const entitySlug = journalType === 'diet' ? 'journal-diet' : config?.entity ?? '';

  const [data, setData] = useState<JournalRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editEntry, setEditEntry] = useState<JournalRow | null>(null);
  const [deleteEntry, setDeleteEntry] = useState<JournalRow | null>(null);

  const fetchData = useCallback(async () => {
    if (!entitySlug) return;
    setLoading(true);
    try {
      const res = await fetchJson<{ items: JournalRow[] }>(`/api/crud/${entitySlug}?limit=200&sort=date&order=desc`);
      setData(res.items);
    } catch {
      setData([]);
    } finally {
      setLoading(false);
    }
  }, [entitySlug]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = useCallback(
    async (entry: JournalRow) => {
      await fetchJson(`/api/crud/${entitySlug}/${entry.id}`, { method: 'DELETE' });
      fetchData();
    },
    [entitySlug, fetchData],
  );

  if (!config) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl text-text-primary">Unknown journal type: {type}</h2>
        <Link href="/journals/subjective" className="text-accent-secondary hover:underline mt-4 inline-block">
          Go to Subjective Journal
        </Link>
      </div>
    );
  }

  // Build columns dynamically based on type
  const columns: ColumnDef<JournalRow>[] = [
    {
      accessorKey: 'date',
      header: 'Date',
      cell: ({ row }) => <span className="tabular">{row.original.date ? formatDate(row.original.date) : '\u2014'}</span>,
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <Link href={`/journals/${journalType}/${row.original.id}`} className="text-accent-secondary hover:underline">
          {row.original.name || 'Unnamed'}
        </Link>
      ),
    },
  ];

  // Add type-specific columns
  if (journalType === 'subjective') {
    columns.push(
      {
        accessorKey: 'stress_level',
        header: 'Stress',
        cell: ({ row }) => {
          const v = row.original.stress_level as string;
          if (!v) return '\u2014';
          const color = v === 'low' ? 'text-healthy' : v === 'medium' ? 'text-warning' : 'text-critical';
          return <span className={`font-medium ${color}`}>{v}</span>;
        },
      },
      {
        accessorKey: 'energy_level',
        header: 'Energy',
        cell: ({ row }) => (row.original.energy_level as string) ?? '\u2014',
      },
      {
        accessorKey: 'mood',
        header: 'Mood',
        cell: ({ row }) => (row.original.mood as string) ?? '\u2014',
      },
    );
  } else if (journalType === 'relational') {
    columns.push(
      {
        accessorKey: 'interaction_type',
        header: 'Type',
        cell: ({ row }) => (row.original.interaction_type as string) ?? '\u2014',
      },
      {
        accessorKey: 'sentiment',
        header: 'Sentiment',
        cell: ({ row }) => {
          const v = row.original.sentiment as string;
          if (!v) return '\u2014';
          const color = v === 'positive' ? 'text-healthy' : v === 'negative' ? 'text-critical' : 'text-warning';
          return <span className={`font-medium ${color}`}>{v}</span>;
        },
      },
    );
  } else if (journalType === 'systemic') {
    columns.push({
      accessorKey: 'impact',
      header: 'Impact',
      cell: ({ row }) => {
        const v = row.original.impact as string;
        if (!v) return '\u2014';
        const color = v === 'high' ? 'text-critical' : v === 'medium' ? 'text-warning' : 'text-healthy';
        return <span className={`font-medium ${color}`}>{v}</span>;
      },
    });
  } else if (journalType === 'diet') {
    columns.push(
      { accessorKey: 'meal_type', header: 'Meal', cell: ({ row }) => (row.original.meal_type as string) ?? '\u2014' },
      { accessorKey: 'calories', header: 'Calories', cell: ({ row }) => (row.original.calories != null ? String(row.original.calories) : '\u2014') },
      { accessorKey: 'mood', header: 'Mood', cell: ({ row }) => (row.original.mood as string) ?? '\u2014' },
    );
  }

  // Actions column
  columns.push({
    id: 'actions',
    header: '',
    cell: ({ row }) => (
      <div className="flex items-center gap-1">
        <button
          onClick={() => setEditEntry(row.original)}
          className="p-1.5 rounded-md text-text-muted hover:text-accent-secondary hover:bg-hover transition-colors"
          aria-label="Edit entry"
        >
          <Pencil className="h-4 w-4" />
        </button>
        <button
          onClick={() => setDeleteEntry(row.original)}
          className="p-1.5 rounded-md text-text-muted hover:text-critical hover:bg-hover transition-colors"
          aria-label="Delete entry"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    ),
  });

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-elevated border border-border p-2">
            <Icon className="h-5 w-5 text-text-secondary" />
          </div>
          <div>
            <h1 className="font-heading text-2xl text-text-primary">{config.label} Journal</h1>
            <p className="text-text-secondary mt-1">Loading entries...</p>
          </div>
        </div>
        <div className="h-64 rounded-lg bg-hover animate-pulse" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/journals/subjective"
            className="rounded-lg bg-elevated border border-border p-2 hover:bg-hover transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-text-secondary" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <Icon className="h-4 w-4 text-text-muted" />
              <span className="text-xs text-text-muted uppercase tracking-wider">{config.label}</span>
            </div>
            <h1 className="font-heading text-2xl text-text-primary mt-0.5">{config.label} Journal</h1>
          </div>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Entry
        </button>
      </div>

      <Card>
        <CardContent className="p-0">
          <DataTable
            columns={columns}
            data={data}
            searchKey="name"
            searchPlaceholder="Search entries..."
            emptyTitle={`No ${config.label.toLowerCase()} entries`}
            emptyDescription={`Start tracking your ${config.label.toLowerCase()} journal entries.`}
          />
        </CardContent>
      </Card>

      {(showForm || editEntry) && (
        <EntryForm
          type={journalType}
          existing={editEntry}
          onSave={() => {
            setShowForm(false);
            setEditEntry(null);
            fetchData();
          }}
          onClose={() => {
            setShowForm(false);
            setEditEntry(null);
          }}
        />
      )}

      {deleteEntry && (
        <ConfirmDelete
          name={deleteEntry.name || 'Unnamed'}
          onConfirm={() => handleDelete(deleteEntry)}
          onCancel={() => setDeleteEntry(null)}
        />
      )}
    </div>
  );
}

// ─── Main Export ─────────────────────────────────────────────────────────

export default function JournalsPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params);
  return (
    <Suspense fallback={<div className="p-8 text-text-secondary">Loading...</div>}>
      <JournalsPageContent type={type} />
    </Suspense>
  );
}
