'use client';

import { useMemo } from 'react';
import { Badge } from '@/components/ui/badge';
import { STATUS_MAP, type StatusKey } from '@/lib/constants';

export interface KanbanColumn {
  id: string;
  title: string;
  color?: string;
}

export interface KanbanViewProps<TData extends Record<string, unknown>> {
  data: TData[];
  columns: KanbanColumn[];
  groupField: string;
  titleField: string;
  subtitleField?: string;
  statusField?: string;
  onCardClick?: (row: TData) => void;
}

export function KanbanView<TData extends Record<string, unknown>>({
  data,
  columns,
  groupField,
  titleField,
  subtitleField,
  statusField,
  onCardClick,
}: KanbanViewProps<TData>) {
  const grouped = useMemo(() => {
    const map = new Map<string, TData[]>();
    columns.forEach((col) => map.set(col.id, []));
    data.forEach((row) => {
      const group = String(row[groupField] ?? '').toLowerCase();
      const matched = columns.find((c) => c.id.toLowerCase() === group);
      const key = matched ? matched.id : columns[0]?.id ?? 'unknown';
      const bucket = map.get(key);
      if (bucket) bucket.push(row);
    });
    return map;
  }, [data, columns, groupField]);

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {columns.map((col) => {
        const items = grouped.get(col.id) ?? [];
        return (
          <div key={col.id} className="min-w-64 w-72 shrink-0">
            <div className="flex items-center justify-between mb-3 px-1">
              <div className="flex items-center gap-2">
                {col.color && (
                  <span className="w-2 h-2 rounded-full" style={{ backgroundColor: col.color }} />
                )}
                <span className="text-sm font-medium text-text-primary">{col.title}</span>
              </div>
              <span className="text-xs text-text-muted tabular">{items.length}</span>
            </div>

            <div className="space-y-2">
              {items.map((row, i) => {
                const title = String(row[titleField] ?? `Item ${i + 1}`);
                const subtitle = subtitleField ? String(row[subtitleField] ?? '') : '';
                const status = statusField ? String(row[statusField] ?? '').toLowerCase() as StatusKey : null;

                return (
                  <div
                    key={String(row.id ?? i)}
                    onClick={() => onCardClick?.(row)}
                    className="p-3 bg-surface border border-border rounded-md hover:border-border-strong hover:bg-elevated transition-colors cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-sm text-text-primary font-medium line-clamp-2">
                        {title}
                      </span>
                      {status && STATUS_MAP[status] && (
                        <Badge status={status} />
                      )}
                    </div>
                    {subtitle && (
                      <p className="text-xs text-text-muted mt-1 truncate">{subtitle}</p>
                    )}
                  </div>
                );
              })}

              {items.length === 0 && (
                <div className="py-8 text-center text-xs text-text-muted border border-dashed border-border rounded-md">
                  Empty
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
