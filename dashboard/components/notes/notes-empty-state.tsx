'use client';

import { FileText, Layers, Type, Link2, Star, Search, MessageSquare, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NotesEmptyStateProps {
  onCreateNote?: () => void;
  className?: string;
}

const features = [
  {
    icon: Layers,
    title: 'Hierarchical Pages',
    description: 'Organize notes with parent/child nesting for structured knowledge.',
  },
  {
    icon: Type,
    title: 'Rich Text Editing',
    description: 'BlockNote-powered editor with headings, lists, code blocks, and more.',
  },
  {
    icon: Link2,
    title: 'Entity References',
    description: 'Link goals, tasks, people, projects, and meetings directly in your notes.',
  },
  {
    icon: Star,
    title: 'Favorites & Search',
    description: 'Star important pages and find anything instantly with full-text search.',
  },
  {
    icon: MessageSquare,
    title: 'Custom Blocks',
    description: 'Add callouts, warnings, and info blocks to highlight key information.',
  },
];

export function NotesEmptyState({ onCreateNote, className }: NotesEmptyStateProps) {
  return (
    <div
      role="status"
      className={cn('flex flex-col items-center justify-center py-12 px-6 text-center', className)}
    >
      <div className="mb-6 rounded-full bg-elevated border border-border-default p-5">
        <FileText className="h-10 w-10 text-text-muted" />
      </div>

      <h3 className="mb-2 text-xl font-semibold font-heading text-text-primary">
        No notes yet
      </h3>
      <p className="mb-8 max-w-md text-sm text-text-secondary leading-relaxed">
        Start building your personal knowledge base. Create hierarchical pages,
        write with rich text, and link everything together.
      </p>

      {onCreateNote && (
        <button
          type="button"
          onClick={onCreateNote}
          className="mb-12 inline-flex items-center gap-2 rounded-md bg-accent px-5 py-2.5 text-sm font-medium text-text-primary transition-colors hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-secondary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Plus className="h-4 w-4" />
          Create your first note
        </button>
      )}

      <div className="w-full max-w-2xl">
        <h4 className="mb-4 text-xs font-semibold uppercase tracking-wider text-text-muted">
          What you can do
        </h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((feature) => (
            <div
              key={feature.title}
              className="rounded-lg border border-border-default bg-surface p-4 text-left transition-colors hover:border-border-strong"
            >
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-elevated">
                <feature.icon className="h-5 w-5 text-accent-secondary" />
              </div>
              <h5 className="mb-1 text-sm font-medium text-text-primary">
                {feature.title}
              </h5>
              <p className="text-xs leading-relaxed text-text-secondary">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default NotesEmptyState;
