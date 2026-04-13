'use client';

import { useState, useEffect, useCallback } from 'react';
import { Search, Brain, Tag, Clock, Loader2, AlertCircle } from 'lucide-react';

interface Memory {
  id: string;
  content: string;
  relevance: number;
  tags: string[];
  source: string;
  timestamp: string;
}

export default function NotesPage() {
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchNotes = useCallback(async (searchQuery?: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        limit: '50',
        sort: 'created_at',
        order: 'desc',
      });
      if (searchQuery?.trim()) {
        params.set('name', searchQuery.trim());
      }

      const res = await fetch(`/api/crud/notes?${params}`);
      if (!res.ok) {
        throw new Error(`Failed to load notes: ${res.status} ${res.statusText}`);
      }
      const json = await res.json();
      const items = json.data?.items || [];
      setNotes(
        items.map((row: Record<string, unknown>) => {
          let content = '';
          if (row.content && typeof row.content === 'string') {
            content = row.content;
          } else if (row.content && typeof row.content === 'object') {
            content = JSON.stringify(row.content);
          } else if (typeof row.name === 'string') {
            content = row.name;
          }

          let tags: string[] = [];
          if (Array.isArray(row.tags)) {
            tags = row.tags.filter((t): t is string => typeof t === 'string');
          } else if (typeof row.tags === 'string') {
            tags = row.tags.split(',').map((t) => t.trim()).filter(Boolean);
          }

          const source = (typeof row.agent === 'string' ? row.agent : '')
            || (typeof row.status === 'string' ? row.status : 'Note');

          const timestamp = (typeof row.created_at === 'string' ? row.created_at : '')
            || (typeof row.createdTime === 'string' ? row.createdTime : '')
            || '';

          return {
            id: typeof row.id === 'string' ? row.id : '',
            content,
            relevance: 0.5,
            tags,
            source,
            timestamp: timestamp ? new Date(timestamp).toLocaleDateString('en-CA') : '',
          } as Memory;
        })
      );
    } catch (err) {
      console.error('Failed to load notes:', err);
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
      setNotes([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNotes();
  }, [fetchNotes]);

  const handleSearch = (q: string) => {
    setQuery(q);
    fetchNotes(q.trim() ? q : undefined);
  };

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Agent Memory</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Vector search across agent knowledge and memories
        </p>
      </div>

      <div className="bg-card-bg border border-card-border rounded-xl px-5 py-4 mb-6">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
            placeholder="Search memories..."
            className="w-full bg-zinc-50 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {loading && (
        <div className="text-center py-12">
          <Loader2 className="w-8 h-8 text-zinc-400 mx-auto mb-3 animate-spin" />
          <p className="text-sm text-zinc-500">Loading memories...</p>
        </div>
      )}

      {error && !loading && (
        <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 rounded-xl px-5 py-4 mb-6">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-500" />
            <p className="text-sm text-red-600 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      {!loading && !error && (
        <div className="space-y-4">
          {notes.map((memory) => (
            <div key={memory.id} className="bg-card-bg border border-card-border rounded-xl px-5 py-4">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Brain className="w-4 h-4 text-purple-500" />
                  <span className="text-xs text-zinc-500">{memory.source}</span>
                </div>
                <span className="text-xs font-mono text-zinc-400">{(memory.relevance * 100).toFixed(0)}% match</span>
              </div>
              <p className="text-sm text-zinc-700 dark:text-zinc-300 mb-3">{memory.content}</p>
              <div className="flex items-center gap-4">
                <div className="flex gap-1.5 flex-wrap">
                  {memory.tags.map((tag) => (
                    <span key={tag} className="inline-flex items-center gap-1 text-xs bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 px-2 py-0.5 rounded-full">
                      <Tag className="w-2.5 h-2.5" />
                      {tag}
                    </span>
                  ))}
                </div>
                <span className="text-xs text-zinc-400 flex items-center gap-1 ml-auto">
                  <Clock className="w-3 h-3" />
                  {memory.timestamp}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !error && notes.length === 0 && (
        <div className="text-center py-12">
          <Brain className="w-12 h-12 text-zinc-300 dark:text-zinc-600 mx-auto mb-4" />
          <h2 className="text-lg font-medium text-zinc-700 dark:text-zinc-300">No Memories Found</h2>
          <p className="text-sm text-zinc-500 mt-1">Try a different search query</p>
        </div>
      )}
    </div>
  );
}
