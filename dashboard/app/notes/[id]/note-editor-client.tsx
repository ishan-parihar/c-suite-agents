'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  Star,
  MoreHorizontal,
  Image as ImageIcon,
  SmilePlus,
  ChevronLeft,
  FileText,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BlockNoteNotionEditor, SaveStatusIndicator } from '@/components/notes/blocknote-notion-editor';

interface NoteEditorClientProps {
  note: {
    id: string;
    name: string;
    status: string | null;
    agent: string | null;
    agentSecondary: string | null;
    report: string | null;
    reportExtra: string | null;
    projectId: string | null;
    projectStatus: string | null;
    knowledgeCategories: string | null;
    createdTime: string | null;
    lastEditedAt: string | null;
    createdAt: string | null;
    updatedAt: string | null;
    parentId: string | null;
    parentName: string | null;
    icon: string | null;
    coverImage: string | null;
    tags: string | null;
    ord: number | null;
    isFavorite: boolean | null;
    isArchived: boolean | null;
  };
  initialContent: unknown;
}

export function NoteEditorClient({ note, initialContent }: NoteEditorClientProps) {
  const router = useRouter();
  const [title, setTitle] = useState(note.name ?? 'Untitled');
  const [isFavorite, setIsFavorite] = useState(note.isFavorite ?? false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [showProperties, setShowProperties] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [titleChanged, setTitleChanged] = useState(false);

  // Auto-save title on change with debounce
  useEffect(() => {
    if (!titleChanged) return;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crud/notes/${note.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: title }),
          credentials: 'include',
        });
        if (res.ok) {
          setTitleChanged(false);
        } else {
          setSaveStatus('unsaved');
        }
      } catch {
        setSaveStatus('unsaved');
      }
    }, 1000);

    return () => clearTimeout(timer);
  }, [title, titleChanged, note.id]);

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    if (!titleChanged) setTitleChanged(true);
  }, [titleChanged]);

  const handleToggleFavorite = useCallback(async () => {
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      await fetch(`/api/crud/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_favorite: next }),
        credentials: 'include',
      });
    } catch {
      setIsFavorite(!next);
    }
  }, [isFavorite, note.id]);

  const handleDelete = useCallback(async () => {
    if (!confirm('Delete this note? This action cannot be undone.')) return;
    try {
      await fetch(`/api/crud/notes/${note.id}`, { method: 'DELETE', credentials: 'include' });
      router.push('/notes');
    } catch {
      alert('Failed to delete note');
    }
  }, [note.id, router]);

  const handleArchive = useCallback(async () => {
    try {
      await fetch(`/api/crud/notes/${note.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_archived: true }),
        credentials: 'include',
      });
      router.push('/notes');
    } catch {
      alert('Failed to archive note');
    }
  }, [note.id, router]);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      {/* Cover image area */}
      <div className="group relative -mx-4 sm:-mx-6 h-48 bg-gradient-to-br from-surface to-elevated border-b border-border-default overflow-hidden">
        {note.coverImage ? (
          <img
            src={note.coverImage}
            alt="Cover"
            className="w-full h-full object-cover"
          />
        ) : (
          <button
            type="button"
            className="w-full h-full flex items-center justify-center text-text-muted hover:text-text-secondary transition-colors opacity-0 group-hover:opacity-100"
          >
            <ImageIcon className="w-8 h-8" />
          </button>
        )}
      </div>

      <div className="flex flex-1 gap-6 px-0 pt-6">
        {/* Main editor area */}
        <div className="flex-1 min-w-0">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1 text-sm text-text-muted mb-4 px-1">
            <Link href="/notes" className="hover:text-text-secondary transition-colors">
              Notes
            </Link>
            {note.parentId && note.parentName && (
              <>
                <ChevronRight className="w-3.5 h-3.5" />
                <Link
                  href={`/notes/${note.parentId}`}
                  className="hover:text-text-secondary transition-colors"
                >
                  {note.parentName}
                </Link>
              </>
            )}
          </nav>

          {/* Icon + Title */}
          <div className="px-1 mb-6">
            <div className="flex items-start gap-3">
              <div className="shrink-0 -mt-2">
                <button
                  type="button"
                  className="w-12 h-12 flex items-center justify-center rounded-lg bg-surface border border-border-default hover:bg-hover transition-colors text-2xl"
                >
                  {note.icon ? (
                    <span>{note.icon}</span>
                  ) : (
                    <SmilePlus className="w-5 h-5 text-text-muted" />
                  )}
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <input
                  type="text"
                  value={title}
                  onChange={handleTitleChange}
                  placeholder="Untitled"
                  className="w-full bg-transparent text-3xl font-semibold text-text-primary placeholder:text-text-muted focus:outline-none font-heading"
                />
                <div className="flex items-center gap-3 mt-2">
                  <SaveStatusIndicator status={titleChanged ? 'unsaved' : saveStatus} />
                </div>
              </div>
            </div>
          </div>

          {/* Top actions bar */}
          <div className="flex items-center justify-between px-1 mb-4 border-b border-border-default pb-3">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleFavorite}
                className={cn(
                  'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border transition-colors',
                  isFavorite
                    ? 'border-yellow-400/30 bg-yellow-400/10 text-yellow-400'
                    : 'border-border-default text-text-muted hover:text-text-secondary hover:bg-hover',
                )}
              >
                <Star className="w-3.5 h-3.5" fill={isFavorite ? 'currentColor' : 'none'} />
                {isFavorite ? 'Favorited' : 'Favorite'}
              </button>
            </div>

            <div className="flex items-center gap-2">
              <SaveStatusIndicator status={saveStatus} />

              <div className="relative">
                <button
                  type="button"
                  onClick={() => setShowMoreMenu(!showMoreMenu)}
                  className="p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>

                {showMoreMenu && (
                  <>
                    <div
                      className="fixed inset-0 z-10"
                      onClick={() => setShowMoreMenu(false)}
                    />
                    <div className="absolute right-0 top-full mt-1 w-48 rounded-md border border-border-default bg-elevated shadow-lg z-20 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => {
                          setShowMoreMenu(false);
                          handleArchive();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-text-secondary hover:bg-hover transition-colors"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                        Archive
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setShowMoreMenu(false);
                          handleDelete();
                        }}
                        className="w-full flex items-center gap-2 px-3 py-2 text-sm text-destructive hover:bg-hover transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5" />
                        Delete
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* BlockNote Editor */}
          <div className="px-1">
            <BlockNoteNotionEditor
              id={note.id}
              initialContent={initialContent}
              onSave={setSaveStatus}
            />
          </div>
        </div>

        {/* Properties panel (collapsible) */}
        <div className={cn(
          'shrink-0 transition-all duration-200',
          showProperties ? 'w-72' : 'w-0 overflow-hidden',
        )}>
          <div className="w-72 bg-surface border border-border-default rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium text-text-primary">Properties</h3>
              <button
                type="button"
                onClick={() => setShowProperties(false)}
                className="p-1 rounded text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="space-y-3">
              <PropertyField label="Status" value={note.status} />
              <PropertyField label="Agent" value={note.agent} />
              <PropertyField label="Secondary Agent" value={note.agentSecondary} />
              <PropertyField label="Report" value={note.report} />
              <PropertyField label="Report Extra" value={note.reportExtra} />
              <PropertyField label="Project ID" value={note.projectId} />
              <PropertyField label="Project Status" value={note.projectStatus} />
              <PropertyField label="Knowledge Categories" value={note.knowledgeCategories} />
              <PropertyField label="Tags" value={note.tags} />
              <PropertyField label="Created" value={note.createdAt} />
              <PropertyField label="Updated" value={note.updatedAt} />
              <PropertyField label="Order" value={note.ord?.toString() ?? null} />
            </div>
          </div>
        </div>

        {/* Toggle properties button */}
        {!showProperties && (
          <button
            type="button"
            onClick={() => setShowProperties(true)}
            className="shrink-0 self-start mt-6 p-2 rounded-md border border-border-default text-text-muted hover:text-text-secondary hover:bg-hover transition-colors"
            title="Show properties"
          >
            <ChevronLeft className="w-4 h-4 rotate-180" />
          </button>
        )}
      </div>
    </div>
  );
}

function PropertyField({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider text-text-muted mb-1">{label}</dt>
      <dd className="text-sm text-text-secondary">
        {value ?? <span className="text-text-muted">—</span>}
      </dd>
    </div>
  );
}
