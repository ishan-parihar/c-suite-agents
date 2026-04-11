'use client';

import { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  FileText,
  Star,
  Calendar,
  Filter,
  X,
  ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';
import { cn, truncate } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import type { StatusKey } from '@/lib/constants';
import type { NoteTreeItem } from '@/components/notes/notes-sidebar';
import { useNoteShortcuts } from '@/lib/shortcuts';

interface SearchResult extends NoteTreeItem {
  highlightedName: string;
}

async function fetchNotesTree(): Promise<NoteTreeItem[]> {
  const res = await fetch('/api/notes/tree');
  if (!res.ok) throw new Error('Failed to fetch notes tree');
  const json = await res.json();
  return json.data as NoteTreeItem[];
}

function highlightMatch(text: string, query: string): string {
  if (!query.trim()) return text;
  const regex = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  return text.replace(regex, '<<mark>>$1<</mark>>');
}

function parseHighlighted(html: string) {
  const parts = html.split(/(<<mark>>.*?<\/mark>>)/g);
  return parts.map((part, i) => {
    if (part.startsWith('<<mark>>')) {
      const inner = part.slice(8, -9);
      return (
        <mark key={i} className="bg-accent/30 text-accent-secondary rounded px-0.5">
          {inner}
        </mark>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

const ALL_STATUSES: { key: StatusKey; label: string }[] = [
  { key: 'healthy', label: 'Healthy' },
  { key: 'warning', label: 'Warning' },
  { key: 'critical', label: 'Critical' },
  { key: 'neutral', label: 'Inactive' },
];

export default function NotesSearchPage() {
  const router = useRouter();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusKey | 'all'>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['notes-tree'],
    queryFn: fetchNotesTree,
  });

  // Wire Cmd/Ctrl+K to focus search input
  useNoteShortcuts({
    onFocusSearch: () => searchRef.current?.focus(),
  });

  const parentMap = useMemo(() => {
    const map = new Map<string, NoteTreeItem>();
    for (const item of items) {
      map.set(item.id, item);
    }
    return map;
  }, [items]);

  const hasActiveFilters = statusFilter !== 'all' || dateFrom !== '' || dateTo !== '';

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q && !hasActiveFilters) return [];

    const filtered: SearchResult[] = [];

    for (const item of items) {
      const nameMatch = !q || item.name.toLowerCase().includes(q);
      const statusMatch = statusFilter === 'all' || item.status === statusFilter;
      const dateMatch = (() => {
        if (!dateFrom && !dateTo) return true;
        const created = new Date(item.createdAt);
        if (dateFrom && created < new Date(dateFrom)) return false;
        if (dateTo && created > new Date(dateTo + 'T23:59:59')) return false;
        return true;
      })();

      if (nameMatch && statusMatch && dateMatch) {
        filtered.push({
          ...item,
          highlightedName: highlightMatch(item.name, q),
        });
      }
    }

    return filtered.sort((a, b) => a.name.localeCompare(b.name));
  }, [items, query, statusFilter, dateFrom, dateTo, hasActiveFilters]);

  const handleSelectNote = useCallback(
    (id: string) => {
      router.push(`/notes/${id}`);
    },
    [router],
  );

  const clearFilters = useCallback(() => {
    setStatusFilter('all');
    setDateFrom('');
    setDateTo('');
  }, []);

  // Escape clears search
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && query) {
        setQuery('');
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [query]);

  return (
    <div className="flex flex-col min-h-[calc(100vh-8rem)]">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Link
            href="/notes"
            className="p-2 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
            aria-label="Back to notes"
          >
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="font-heading text-xl font-semibold text-text-primary">Search Notes</h1>
            <p className="text-sm text-text-secondary mt-0.5">
              {results.length > 0
                ? `${results.length} result${results.length === 1 ? '' : 's'}`
                : query
                  ? 'No results found'
                  : 'Search across all your notes'}
            </p>
          </div>
        </div>
      </div>

      <div className="relative mb-4">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-text-muted" />
        <input
          ref={searchRef}
          type="text"
          placeholder="Search note titles... (Cmd/Ctrl+K to focus)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-12 pr-12 py-3 text-base rounded-lg bg-elevated border border-border-default text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent/50 transition-all"
          autoFocus
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded text-text-muted hover:text-text-secondary transition-colors"
            aria-label="Clear search"
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      <div className="flex items-center gap-2 mb-4">
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border transition-colors',
            showFilters || hasActiveFilters
              ? 'border-accent/30 bg-accent/10 text-accent-secondary'
              : 'border-border-default text-text-muted hover:text-text-secondary hover:bg-hover',
          )}
        >
          <Filter className="w-3.5 h-3.5" />
          Filters
          {hasActiveFilters && (
            <span className="w-4 h-4 rounded-full bg-accent-secondary text-[10px] font-bold flex items-center justify-center text-white">
              {[statusFilter !== 'all', dateFrom !== '', dateTo !== ''].filter(Boolean).length}
            </span>
          )}
        </button>

        {hasActiveFilters && (
          <button
            type="button"
            onClick={clearFilters}
            className="flex items-center gap-1 px-2 py-1 text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            <X className="w-3 h-3" />
            Clear all
          </button>
        )}
      </div>

      {showFilters && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-6 p-4 rounded-lg bg-elevated border border-border-default">
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Status</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusKey | 'all')}
              className="w-full px-3 py-2 text-sm rounded-md bg-surface border border-border-default text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/50"
            >
              <option value="all">All statuses</option>
              {ALL_STATUSES.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Created after</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md bg-surface border border-border-default text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">Created before</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full px-3 py-2 text-sm rounded-md bg-surface border border-border-default text-text-primary focus:outline-none focus:ring-1 focus:ring-accent/50"
            />
          </div>
        </div>
      )}

      <div className="flex-1">
        {isLoading ? (
          <div className="py-8 text-center text-text-muted text-sm">Loading notes...</div>
        ) : results.length === 0 && query.trim() ? (
          <div className="py-12 text-center">
            <div className="mb-4 rounded-full bg-hover p-4 text-text-muted inline-block">
              <Search className="h-8 w-8" />
            </div>
            <h3 className="mb-1 text-lg font-medium text-text-primary">No results found</h3>
            <p className="text-sm text-text-secondary">
              No notes matching &ldquo;{query}&rdquo;
            </p>
          </div>
        ) : results.length === 0 && !query.trim() && !hasActiveFilters ? (
          <div className="py-12 text-center">
            <div className="mb-4 rounded-full bg-hover p-4 text-text-muted inline-block">
              <FileText className="h-8 w-8" />
            </div>
            <h3 className="mb-1 text-lg font-medium text-text-primary">Start searching</h3>
            <p className="text-sm text-text-secondary">
              Type in the search box above to find notes by title
            </p>
          </div>
        ) : (
          <div className="space-y-1">
            {results.map((note) => {
              const parent = note.parentId ? parentMap.get(note.parentId) : null;

              return (
                <button
                  key={note.id}
                  type="button"
                  onClick={() => handleSelectNote(note.id)}
                  className="w-full flex items-start gap-3 px-4 py-3 rounded-lg text-left transition-colors hover:bg-hover group"
                >
                  <div className="shrink-0 mt-0.5 w-8 h-8 rounded-md bg-surface border border-border-default flex items-center justify-center text-sm">
                    {note.icon ? (
                      <span>{note.icon}</span>
                    ) : (
                      <FileText className="w-4 h-4 text-text-muted" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-text-primary truncate">
                        {parseHighlighted(note.highlightedName)}
                      </span>
                      {note.isFavorite && (
                        <Star className="w-3.5 h-3.5 text-yellow-400 shrink-0" fill="currentColor" />
                      )}
                    </div>

                    <div className="flex items-center gap-3 mt-1">
                      {note.status && (
                        <Badge status={note.status as StatusKey} />
                      )}

                      {parent && (
                        <span className="text-xs text-text-muted truncate">
                          {parent.icon && <span className="mr-1">{parent.icon}</span>}
                          {truncate(parent.name, 30)}
                        </span>
                      )}

                      <span className="flex items-center gap-1 text-xs text-text-muted shrink-0">
                        <Calendar className="w-3 h-3" />
                        {new Date(note.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                        })}
                      </span>
                    </div>
                  </div>

                  <div className="shrink-0 mt-1 text-text-muted opacity-0 group-hover:opacity-100 transition-opacity">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
