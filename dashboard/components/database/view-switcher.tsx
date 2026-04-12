'use client';

import { Table2, LayoutGrid, Calendar, Columns } from 'lucide-react';

export type DataViewType = 'table' | 'kanban' | 'calendar' | 'gallery';

export interface ViewSwitcherProps {
  current: DataViewType;
  onChange: (view: DataViewType) => void;
  available?: DataViewType[];
}

const VIEW_OPTIONS: { value: DataViewType; label: string; icon: typeof Table2 }[] = [
  { value: 'table', label: 'Table', icon: Table2 },
  { value: 'kanban', label: 'Board', icon: Columns },
  { value: 'calendar', label: 'Calendar', icon: Calendar },
  { value: 'gallery', label: 'Gallery', icon: LayoutGrid },
];

export function ViewSwitcher({ current, onChange, available }: ViewSwitcherProps) {
  const options = available
    ? VIEW_OPTIONS.filter((o) => available.includes(o.value))
    : VIEW_OPTIONS;

  return (
    <div className="inline-flex items-center bg-surface border border-border rounded-md p-0.5">
      {options.map((opt) => {
        const isActive = opt.value === current;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded transition-colors ${
              isActive
                ? 'bg-elevated text-text-primary shadow-sm'
                : 'text-text-muted hover:text-text-secondary'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
