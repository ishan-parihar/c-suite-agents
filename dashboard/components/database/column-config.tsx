'use client';

import { useState, useCallback, useEffect } from 'react';
import { Settings2, Eye, EyeOff, ChevronUp, ChevronDown, Pin, PinOff } from 'lucide-react';
import { Modal } from '@/components/ui/modal';

export interface ColumnConfig {
  id: string;
  header: string;
  visible: boolean;
  pinned: 'left' | 'right' | false;
}

export interface ColumnConfigModalProps {
  open: boolean;
  onClose: () => void;
  columns: ColumnConfig[];
  onChange: (columns: ColumnConfig[]) => void;
}

export function ColumnConfigModal({ open, onClose, columns, onChange }: ColumnConfigModalProps) {
  const [localColumns, setLocalColumns] = useState<ColumnConfig[]>(columns);

  useEffect(() => {
    if (open) setLocalColumns(columns);
  }, [open, columns]);

  const toggleVisibility = useCallback((id: string) => {
    setLocalColumns((prev) =>
      prev.map((c) => (c.id === id ? { ...c, visible: !c.visible } : c))
    );
  }, []);

  const togglePin = useCallback((id: string) => {
    setLocalColumns((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const next = c.pinned === 'left' ? 'right' : c.pinned === 'right' ? false : 'left';
        return { ...c, pinned: next };
      })
    );
  }, []);

  const moveColumn = useCallback((index: number, direction: 'up' | 'down') => {
    setLocalColumns((prev) => {
      const target = direction === 'up' ? index - 1 : index + 1;
      if (target < 0 || target >= prev.length) return prev;
      const updated = [...prev];
      [updated[index], updated[target]] = [updated[target], updated[index]];
      return updated;
    });
  }, []);

  const handleSave = useCallback(() => {
    onChange(localColumns);
    onClose();
  }, [localColumns, onChange, onClose]);

  const handleReset = useCallback(() => {
    setLocalColumns(columns);
  }, [columns]);

  const visibleCount = localColumns.filter((c) => c.visible).length;
  const pinnedCount = localColumns.filter((c) => c.pinned).length;

  return (
    <Modal open={open} onClose={onClose} title="Configure Columns" size="lg">
      <div className="space-y-4">
        <div className="flex items-center justify-between text-xs text-text-muted">
          <span>{visibleCount} visible · {pinnedCount} pinned</span>
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="text-text-secondary hover:text-text-primary transition-colors"
            >
              Reset
            </button>
            <button
              onClick={handleSave}
              className="px-3 py-1 text-xs bg-accent text-bg-base rounded-md hover:bg-accent/90 transition-colors"
            >
              Apply
            </button>
          </div>
        </div>

        <div className="border border-border rounded-md divide-y divide-border/50">
          {localColumns.map((col, i) => (
            <div
              key={col.id}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-hover/50 transition-colors"
            >
              {/* Reorder controls */}
              <div className="flex flex-col gap-0.5 w-5 shrink-0">
                <button
                  onClick={() => moveColumn(i, 'up')}
                  disabled={i === 0}
                  className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronUp className="w-3 h-3" />
                </button>
                <button
                  onClick={() => moveColumn(i, 'down')}
                  disabled={i === localColumns.length - 1}
                  className="p-0.5 text-text-muted hover:text-text-primary disabled:opacity-20 disabled:cursor-not-allowed transition-colors"
                >
                  <ChevronDown className="w-3 h-3" />
                </button>
              </div>

              {/* Column name */}
              <span className="flex-1 text-sm text-text-primary font-mono text-xs">
                {col.header}
              </span>

              {/* Pin toggle */}
              <button
                onClick={() => togglePin(col.id)}
                className={`p-1.5 rounded transition-colors ${
                  col.pinned
                    ? 'text-accent hover:text-accent/80'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
                title={col.pinned ? `Unpin (${col.pinned})` : 'Pin left'}
              >
                {col.pinned ? (
                  <Pin className="w-3.5 h-3.5" />
                ) : (
                  <PinOff className="w-3.5 h-3.5" />
                )}
              </button>

              {/* Visibility toggle */}
              <button
                onClick={() => toggleVisibility(col.id)}
                className={`p-1.5 rounded transition-colors ${
                  col.visible
                    ? 'text-text-secondary hover:text-text-primary'
                    : 'text-text-muted hover:text-text-secondary'
                }`}
                title={col.visible ? 'Hide column' : 'Show column'}
              >
                {col.visible ? (
                  <Eye className="w-3.5 h-3.5" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          ))}
        </div>

        <p className="text-xs text-text-muted">
          Drag columns up/down to reorder. Click pin to freeze columns left or right. Toggle eye icon to show/hide.
        </p>
      </div>
    </Modal>
  );
}

/**
 * Button to open column config — used in DataTable toolbar.
 */
export function ColumnConfigButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-md text-text-secondary hover:text-text-primary hover:bg-hover transition-colors"
      title="Configure columns"
    >
      <Settings2 className="w-3.5 h-3.5" />
      Columns
    </button>
  );
}
