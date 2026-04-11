'use client';

import { useState, useCallback, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { cn, truncate } from '@/lib/utils';
import { Modal } from '@/components/ui/modal';
import { BlockNoteEditor } from '@/components/crud/blocknote-editor';

// ─── Types ───────────────────────────────────────────────────────────────

interface Meeting {
  id: string;
  date: string | null;
  status: string | null;
  objective: string | null;
  started_at: string | null;
  concluded_at: string | null;
  created_at: string | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`);
  return json.data ?? json;
}

function meetingStatusConfig(status: string | null): { color: string; label: string } {
  switch (status) {
    case 'scheduled':
      return { color: 'var(--status-neutral)', label: 'Scheduled' };
    case 'in_progress':
      return { color: 'var(--status-warning)', label: 'In Progress' };
    case 'concluded':
      return { color: 'var(--status-healthy)', label: 'Concluded' };
    default:
      return { color: 'var(--status-neutral)', label: status ?? 'Unknown' };
  }
}

function formatDate(date: string | null): string {
  if (!date) return '\u2014';
  return new Date(date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function StatusBadge({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium"
      style={{ backgroundColor: `${color}20`, color }}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
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
          Are you sure you want to delete the meeting{' '}
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

// ─── Meeting Form Modal ──────────────────────────────────────────────────

interface MeetingFormProps {
  existing?: Meeting | null;
  onSave: () => void;
  onClose: () => void;
}

function MeetingForm({ existing, onSave, onClose }: MeetingFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [objective, setObjective] = useState(existing?.objective ?? '');
  const [status, setStatus] = useState(existing?.status ?? 'scheduled');
  const [date, setDate] = useState(
    existing?.date
      ? new Date(existing.date).toISOString().slice(0, 16)
      : new Date().toISOString().slice(0, 16),
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      setLoading(true);
      try {
        const body: Record<string, unknown> = {
          date: new Date(date).toISOString(),
          objective,
          status,
        };

        if (existing) {
          await fetchJson(`/api/crud/meetings/${existing.id}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          });
        } else {
          await fetchJson('/api/crud/meetings', {
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
    [existing, date, objective, status, onSave],
  );

  return (
    <Modal open onClose={onClose} title={existing ? 'Edit Meeting' : 'Create Meeting'} size="lg">
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && (
          <div className="rounded-md border border-border bg-critical/10 px-4 py-2 text-sm text-critical">
            {error}
          </div>
        )}

        <div>
          <label className="block text-sm font-medium text-text-secondary mb-1">Objective *</label>
          <BlockNoteEditor
            initialContent={objective}
            onChange={(content) => setObjective(content)}
            minHeight="200px"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Date & Time</label>
            <input
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
            >
              <option value="scheduled">Scheduled</option>
              <option value="in_progress">In Progress</option>
              <option value="concluded">Concluded</option>
            </select>
          </div>
        </div>

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
            disabled={loading || (!objective.trim() && objective !== '[]')}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            {existing ? 'Update' : 'Create'} Meeting
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────

export default function MeetingsPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const statusFilter = searchParams?.get('status') ?? 'all';

  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editMeeting, setEditMeeting] = useState<Meeting | null>(null);
  const [deleteMeeting, setDeleteMeeting] = useState<Meeting | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchJson<{ items: Meeting[] }>('/api/crud/meetings?limit=200&sort=date&order=desc');
      setMeetings(res.items);
    } catch {
      setMeetings([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleDelete = useCallback(
    async (meeting: Meeting) => {
      await fetchJson(`/api/crud/meetings/${meeting.id}`, { method: 'DELETE' });
      fetchData();
    },
    [fetchData],
  );

  const filtered = meetings.filter((m) => statusFilter === 'all' || m.status === statusFilter);

  const filterOptions = [
    { value: 'all', label: 'All' },
    { value: 'scheduled', label: 'Scheduled' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'concluded', label: 'Concluded' },
  ];

  return (
    <div>
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Board Meetings</h1>
          <p className="text-text-secondary mt-1">Quorum-based decision meetings with turn-by-turn records</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm text-white hover:bg-accent-hover transition-colors"
        >
          <Plus className="h-4 w-4" />
          Create Meeting
        </button>
      </div>

      <div className="flex items-center gap-3 mb-4">
        {filterOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => {
              if (opt.value === 'all') {
                router.push('/meetings');
              } else {
                router.push(`/meetings?status=${opt.value}`);
              }
            }}
            className={cn(
              'px-3 py-1.5 text-sm rounded-md border border-border transition-colors',
              statusFilter === opt.value
                ? 'bg-accent/10 border-border-strong text-text-primary'
                : 'bg-surface text-text-secondary hover:bg-hover',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
                  Date
                </th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
                  Status
                </th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
                  Objective
                </th>
                <th className="px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-text-muted">
                    Loading meetings...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-12 text-center text-text-muted">
                    No meetings found
                  </td>
                </tr>
              ) : (
                filtered.map((meeting) => {
                  const statusConfig = meetingStatusConfig(meeting.status);
                  return (
                    <tr
                      key={meeting.id}
                      className="border-b border-border last:border-b-0 hover:bg-hover/50 transition-colors"
                    >
                      <td className="px-4 py-3 text-text-primary tabular">
                        {formatDate(meeting.date)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge color={statusConfig.color} label={statusConfig.label} />
                      </td>
                      <td className="px-4 py-3 text-text-primary max-w-xs">
                        {truncate(meeting.objective ?? 'No objective', 80)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <Link
                            href={`/meetings/${meeting.id}`}
                            className="text-accent-secondary hover:text-text-primary text-sm transition-colors px-2 py-1"
                          >
                            View
                          </Link>
                          <button
                            onClick={() => setEditMeeting(meeting)}
                            className="p-1.5 rounded-md text-text-muted hover:text-accent-secondary hover:bg-hover transition-colors"
                            aria-label="Edit meeting"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => setDeleteMeeting(meeting)}
                            className="p-1.5 rounded-md text-text-muted hover:text-critical hover:bg-hover transition-colors"
                            aria-label="Delete meeting"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {(showForm || editMeeting) && (
        <MeetingForm
          existing={editMeeting}
          onSave={() => {
            setShowForm(false);
            setEditMeeting(null);
            fetchData();
          }}
          onClose={() => {
            setShowForm(false);
            setEditMeeting(null);
          }}
        />
      )}

      {deleteMeeting && (
        <ConfirmDelete
          name={deleteMeeting.objective ?? 'Unnamed meeting'}
          onConfirm={() => handleDelete(deleteMeeting)}
          onCancel={() => setDeleteMeeting(null)}
        />
      )}
    </div>
  );
}
