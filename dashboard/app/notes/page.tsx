'use client';

import { useState, useCallback } from 'react';
import { Grid3X3, ListTree } from 'lucide-react';
import { NotesSidebar } from '@/components/notes/notes-sidebar';
import { NotesEmptyState } from '@/components/notes/notes-empty-state';
import { cn } from '@/lib/utils';

type ViewMode = 'grid' | 'tree';

export default function NotesPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('grid');

  const handleCreateNote = useCallback(() => {
    const name = prompt('Page name:');
    if (name?.trim()) {
      fetch('/api/crud/notes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), parent_id: null, status: 'New Note' }),
      })
        .then((res) => res.json())
        .then((data) => {
          const newId = data?.id ?? data?.data?.id;
          if (newId) window.location.href = `/notes/${newId}`;
        })
        .catch(console.error);
    }
  }, []);

  return (
    <div className="flex h-[calc(100vh-4rem)]">
      <NotesSidebar selectedId={selectedId} onSelect={setSelectedId} />

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-default">
          <div>
            <h1 className="font-heading text-xl font-semibold text-text-primary">Notes</h1>
            <p className="text-sm text-text-secondary mt-0.5">Organize your thoughts and ideas</p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center rounded-md border border-border-default bg-surface overflow-hidden">
              <button
                type="button"
                onClick={() => setViewMode('grid')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors',
                  viewMode === 'grid'
                    ? 'bg-elevated text-text-primary'
                    : 'text-text-muted hover:text-text-secondary',
                )}
                aria-label="Grid view"
              >
                <Grid3X3 className="w-3.5 h-3.5" />
                Grid
              </button>
              <button
                type="button"
                onClick={() => setViewMode('tree')}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors border-l border-border-default',
                  viewMode === 'tree'
                    ? 'bg-elevated text-text-primary'
                    : 'text-text-muted hover:text-text-secondary',
                )}
                aria-label="Tree view"
              >
                <ListTree className="w-3.5 h-3.5" />
                Tree
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <NotesEmptyState onCreateNote={handleCreateNote} />
        </div>
      </div>
    </div>
  );
}
