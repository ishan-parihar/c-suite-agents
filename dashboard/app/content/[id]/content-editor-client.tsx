'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ChevronRight,
  MoreHorizontal,
  FileText,
  Eye,
  PencilLine,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BlockNoteNotionEditor, SaveStatusIndicator } from '@/components/notes/blocknote-notion-editor';

interface ContentEditorClientProps {
  content: {
    id: string;
    name: string;
    status: string | null;
    pillar: string | null;
    funnelStage: string | null;
    tone: string | null;
    platforms: string[] | null;
    format: string[] | null;
    isEvergreen: boolean | null;
    publishDate: Date | null;
    campaignId: string | null;
    liveUrl: string | null;
    contentBody: string | null;
    reach: number | null;
    engagement: number | null;
    engagementRate: string | null;
    createdAt: Date | null;
    updatedAt: Date | null;
  };
  initialContent: unknown;
}

function formatDate(d: Date | null): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-IN', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function ContentEditorClient({ content, initialContent }: ContentEditorClientProps) {
  const router = useRouter();
  const [title, setTitle] = useState(content.name ?? 'Untitled');
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const [showProperties, setShowProperties] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [titleChanged, setTitleChanged] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  // Auto-save title on change with debounce
  useEffect(() => {
    if (!titleChanged) return;

    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/crud/content-pipeline/${content.id}`, {
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
  }, [title, titleChanged, content.id]);

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setTitle(e.target.value);
    if (!titleChanged) setTitleChanged(true);
  }, [titleChanged]);

  const handleDelete = useCallback(async () => {
    if (!confirm('Delete this content item? This action cannot be undone.')) return;
    try {
      await fetch(`/api/crud/content-pipeline/${content.id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      router.push('/content');
    } catch {
      alert('Failed to delete content');
    }
  }, [content.id, router]);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] flex-col">
      {/* Header bar */}
      <div className="h-12 bg-gradient-to-br from-surface to-elevated border-b border-border-default flex items-center justify-between px-4">
        <nav className="flex items-center gap-1 text-sm text-text-muted">
          <Link href="/content" className="hover:text-text-secondary transition-colors">
            Content
          </Link>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-text-secondary truncate max-w-[300px]">{title}</span>
        </nav>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPreviewMode(!previewMode)}
            className={cn(
              'flex items-center gap-1.5 px-2.5 py-1.5 text-xs rounded-md border transition-colors',
              previewMode
                ? 'border-accent-default/30 bg-accent-default/10 text-accent-default'
                : 'border-border-default text-text-muted hover:text-text-secondary hover:bg-hover',
            )}
          >
            {previewMode ? (
              <PencilLine className="w-3.5 h-3.5" />
            ) : (
              <Eye className="w-3.5 h-3.5" />
            )}
            {previewMode ? 'Edit' : 'Preview'}
          </button>

          <SaveStatusIndicator status={titleChanged ? 'unsaved' : saveStatus} />

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

      <div className="flex flex-1 gap-6 px-0 pt-6">
        {/* Main editor area */}
        <div className="flex-1 min-w-0">
          {/* Icon + Title */}
          <div className="px-1 mb-6">
            <div className="flex items-start gap-3">
              <div className="shrink-0 -mt-2">
                <div className="w-12 h-12 flex items-center justify-center rounded-lg bg-surface border border-border-default text-2xl">
                  <FileText className="w-5 h-5 text-text-muted" />
                </div>
              </div>
              <div className="flex-1 min-w-0">
                {previewMode ? (
                  <h1 className="text-3xl font-semibold text-text-primary font-heading">
                    {title}
                  </h1>
                ) : (
                  <input
                    type="text"
                    value={title}
                    onChange={handleTitleChange}
                    placeholder="Untitled"
                    className="w-full bg-transparent text-3xl font-semibold text-text-primary placeholder:text-text-muted focus:outline-none font-heading"
                  />
                )}
              </div>
            </div>
          </div>

          {/* BlockNote Editor or Preview */}
          <div className="px-1">
            {previewMode ? (
              <ContentPreview content={initialContent} />
            ) : (
              <BlockNoteNotionEditor
                id={content.id}
                initialContent={initialContent}
                onSave={setSaveStatus}
              />
            )}
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
                <ChevronRight className="w-3.5 h-3.5 rotate-180" />
              </button>
            </div>

            <div className="space-y-3">
              <PropertyField label="Status" value={content.status} />
              <PropertyField label="Pillar" value={content.pillar} />
              <PropertyField label="Funnel Stage" value={content.funnelStage} />
              <PropertyField label="Tone" value={content.tone} />
              <PropertyField
                label="Platforms"
                value={content.platforms?.join(', ') ?? null}
              />
              <PropertyField
                label="Format"
                value={content.format?.join(', ') ?? null}
              />
              <PropertyField
                label="Evergreen"
                value={content.isEvergreen ? 'Yes' : 'No'}
              />
              <PropertyField
                label="Publish Date"
                value={formatDate(content.publishDate)}
              />
              <PropertyField label="Live URL" value={content.liveUrl} />
              <PropertyField
                label="Reach"
                value={content.reach?.toLocaleString('en-IN') ?? null}
              />
              <PropertyField
                label="Engagement"
                value={content.engagement?.toLocaleString('en-IN') ?? null}
              />
              <PropertyField
                label="Eng. Rate"
                value={content.engagementRate
                  ? `${(parseFloat(content.engagementRate) * 100).toFixed(1)}%`
                  : null}
              />
              <PropertyField
                label="Created"
                value={formatDate(content.createdAt)}
              />
              <PropertyField
                label="Updated"
                value={formatDate(content.updatedAt)}
              />
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
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

function ContentPreview({ content }: { content: unknown }) {
  if (!content) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-text-muted">
        <FileText className="w-12 h-12 mb-4 opacity-50" />
        <p className="text-lg font-medium">No content yet</p>
        <p className="text-sm mt-1">Switch to edit mode to start writing</p>
      </div>
    );
  }

  // Render BlockNote JSON as plain text preview
  try {
    const blocks = Array.isArray(content)
      ? content
      : JSON.parse(String(content));

    if (!Array.isArray(blocks) || blocks.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-24 text-text-muted">
          <FileText className="w-12 h-12 mb-4 opacity-50" />
          <p className="text-lg font-medium">Empty document</p>
        </div>
      );
    }

    return (
      <div className="prose prose-sm max-w-none dark:prose-invert">
        {blocks.map((block: { type?: string; content?: unknown }, i: number) => (
          <BlockPreview key={i} block={block} />
        ))}
      </div>
    );
  } catch {
    return (
      <div className="whitespace-pre-wrap text-text-secondary">
        {String(content)}
      </div>
    );
  }
}

function BlockPreview({ block }: { block: { type?: string; content?: unknown } }) {
  const text = typeof block.content === 'string'
    ? block.content
    : Array.isArray(block.content)
      ? block.content.map((t: { type?: string; text?: string }) => t.text ?? '').join('')
      : '';

  switch (block.type) {
    case 'heading':
      return <h2 className="text-xl font-semibold text-text-primary mt-6 mb-2">{text}</h2>;
    case 'paragraph':
      return <p className="text-text-secondary mb-4">{text}</p>;
    case 'bullet-list':
    case 'numbered-list':
      return <p className="text-text-secondary mb-2 pl-4">{text}</p>;
    default:
      return text ? <p className="text-text-secondary mb-4">{text}</p> : null;
  }
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

export default ContentEditorClient;
