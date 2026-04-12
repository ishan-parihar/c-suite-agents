'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { STATUS_MAP, type StatusKey } from '@/lib/constants';

export interface GalleryViewProps<TData extends Record<string, unknown>> {
  data: TData[];
  titleField: string;
  subtitleField?: string;
  statusField?: string;
  descriptionField?: string;
  onCardClick?: (row: TData) => void;
}

export function GalleryView<TData extends Record<string, unknown>>({
  data,
  titleField,
  subtitleField,
  statusField,
  descriptionField,
  onCardClick,
}: GalleryViewProps<TData>) {
  const formatDate = (value: unknown) => {
    try {
      const d = new Date(String(value));
      if (isNaN(d.getTime())) return null;
      return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    } catch { return null; }
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {data.map((row, i) => {
        const title = String(row[titleField] ?? `Item ${i + 1}`);
        const subtitle = subtitleField ? formatDate(row[subtitleField]) || String(row[subtitleField] ?? '') : '';
        const status = statusField ? String(row[statusField] ?? '').toLowerCase() as StatusKey : null;
        const description = descriptionField ? String(row[descriptionField] ?? '') : '';

        return (
          <div
            key={String(row.id ?? i)}
            onClick={() => onCardClick?.(row)}
            className="group p-4 bg-surface border border-border rounded-lg hover:border-border-strong hover:bg-elevated transition-colors cursor-pointer"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <h4 className="text-sm font-medium text-text-primary line-clamp-2 group-hover:text-accent transition-colors">
                {title}
              </h4>
              {status && STATUS_MAP[status] && (
                <Badge status={status} />
              )}
            </div>

            {subtitle && (
              <p className="text-xs text-text-muted mb-1">{subtitle}</p>
            )}

            {description && (
              <p className="text-xs text-text-secondary line-clamp-3 mt-1">
                {description}
              </p>
            )}
          </div>
        );
      })}

      {data.length === 0 && (
        <div className="col-span-full py-16 text-center text-text-secondary">
          No records to display.
        </div>
      )}
    </div>
  );
}
