'use client';

import { useEffect } from 'react';
import { X, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { STATUS_MAP, type StatusKey } from '@/lib/constants';

export interface RowDetailPanelProps {
  open: boolean;
  onClose: () => void;
  entity: string;
  row: Record<string, unknown> | null;
  fields?: string[];
}

export function RowDetailPanel({ open, onClose, entity, row, fields }: RowDetailPanelProps) {
  useEffect(() => {
    if (!open) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open || !row) return null;

  const displayFields = fields ?? Object.keys(row).filter((k) => k !== 'id');
  const titleField = displayFields.find((f) =>
    f === 'name' || f === 'title' || f === 'subject'
  );
  const title = titleField ? String(row[titleField] || 'Untitled') : `Record ${row.id}`;

  const renderValue = (field: string, value: unknown): React.ReactNode => {
    if (value === null || value === undefined) {
      return <span className="text-text-muted">Not set</span>;
    }

    if (field === 'status' || field === 'health') {
      const key = (String(value).toLowerCase()) as StatusKey;
      return <Badge status={STATUS_MAP[key] ? key : 'neutral'} />;
    }

    if (field === 'priority') {
      const colors: Record<string, string> = {
        high: 'text-status-critical', medium: 'text-status-warning',
        low: 'text-status-healthy', urgent: 'text-status-critical',
      };
      return <span className={`font-mono text-xs ${colors[String(value).toLowerCase()] || 'text-text-secondary'}`}>{String(value)}</span>;
    }

    if (field.includes('date') || field.includes('created') || field.includes('updated')) {
      try {
        return (
          <span className="tabular text-text-secondary">
            {new Date(String(value)).toLocaleString('en-US', {
              month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        );
      } catch { /* fall through */ }
    }

    if (typeof value === 'boolean') {
      return <span className={value ? 'text-status-healthy' : 'text-text-muted'}>{value ? 'Yes' : 'No'}</span>;
    }

    if (typeof value === 'number') {
      return <span className="tabular text-text-primary">{value.toLocaleString()}</span>;
    }

    const str = String(value);
    if (str.length > 200) {
      return (
        <span className="text-text-secondary whitespace-pre-wrap">
          {str}
        </span>
      );
    }

    return <span className="text-text-primary">{str}</span>;
  };

  return (
    <div className="fixed inset-0 z-modal" role="dialog" aria-modal="true" aria-label={`${title} details`}>
      <div className="absolute inset-0 bg-background/60" onClick={onClose} />
      <div className="absolute right-0 top-0 bottom-0 w-full max-w-lg bg-elevated border-l border-border flex flex-col shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-6 py-4 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs text-text-muted font-mono">{entity}</span>
            <ChevronRight className="w-3 h-3 text-text-muted shrink-0" />
            <span className="text-sm font-medium text-text-primary truncate">{title}</span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-text-muted hover:bg-hover hover:text-text-primary transition-colors shrink-0"
            aria-label="Close panel"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div className="space-y-0">
            {displayFields.map((field, i) => (
              <div
                key={field}
                className={`flex items-start gap-4 py-3 ${
                  i > 0 ? 'border-t border-border/50' : ''
                }`}
              >
                <div className="w-32 shrink-0">
                  <span className="text-xs font-heading uppercase tracking-wide text-text-muted">
                    {field.replace(/_/g, ' ')}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  {renderValue(field, row[field])}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-border px-6 py-3 shrink-0">
          <span className="text-xs text-text-muted font-mono">ID: {String(row.id)}</span>
        </div>
      </div>
    </div>
  );
}
