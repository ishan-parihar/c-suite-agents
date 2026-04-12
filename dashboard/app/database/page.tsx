'use client';

import Link from 'next/link';
import { Database, ChevronRight } from 'lucide-react';
import { entityRegistry, type EntitySlug } from '@/lib/crud/entities';

const GROUPS: Record<string, { entities: EntitySlug[]; color: string }> = {
  Strategic: {
    entities: ['goals-annual', 'goals-quarterly', 'projects', 'campaigns'],
    color: 'text-accent',
  },
  Productivity: {
    entities: ['tasks', 'people'],
    color: 'text-accent-secondary',
  },
  Operations: {
    entities: ['kanban-boards', 'kanban-cards', 'message-threads', 'messages', 'meetings'],
    color: 'text-accent-secondary',
  },
  Journaling: {
    entities: ['journal-subjective', 'journal-relational', 'journal-systemic', 'journal-diet'],
    color: 'text-accent-hover',
  },
  Knowledge: {
    entities: ['notes'],
    color: 'text-text-secondary',
  },
  Financial: {
    entities: ['financial-log', 'financial-accounts'],
    color: 'text-accent',
  },
  Marketing: {
    entities: ['content-pipeline'],
    color: 'text-accent-secondary',
  },
};

function humanize(slug: string) {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function DatabasePage() {
  return (
    <div>
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-1">
          <Database className="w-5 h-5 text-text-muted" />
          <h1 className="font-heading text-2xl font-semibold text-text-primary">
            Database Management
          </h1>
        </div>
        <p className="text-sm text-text-secondary">
          All LifeOS data tables — {Object.keys(entityRegistry).length} entities across {Object.keys(GROUPS).length} groups
        </p>
      </div>

      <div className="space-y-6">
        {Object.entries(GROUPS).map(([groupName, { entities, color }]) => {
          const validEntities = entities.filter((e) => entityRegistry[e]);
          if (validEntities.length === 0) return null;

          return (
            <div key={groupName}>
              <h2 className={`font-heading text-base font-semibold mb-2 ${color}`}>
                {groupName}
              </h2>
              <div className="space-y-px">
                {validEntities.map((entitySlug) => {
                  const config = entityRegistry[entitySlug];
                  const titleField = config.listFields[1];

                  return (
                    <Link
                      key={entitySlug}
                      href={`/database/${entitySlug}`}
                      className="flex items-center justify-between py-2 px-3 rounded-md text-sm text-text-secondary hover:text-text-primary hover:bg-hover transition-colors group"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <span className="font-mono text-xs text-text-muted shrink-0">
                          {entitySlug}
                        </span>
                        <span className="truncate">{humanize(entitySlug)}</span>
                        {titleField && (
                          <span className="text-xs text-text-muted truncate hidden sm:inline">
                            &middot; {titleField}
                          </span>
                        )}
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-text-muted group-hover:text-text-secondary shrink-0 transition-colors" />
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
