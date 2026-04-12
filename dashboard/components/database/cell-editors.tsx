'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';

export type CellEditType = 'text' | 'number' | 'select' | 'date' | 'boolean';

export interface CellEditorProps {
  value: unknown;
  type: CellEditType;
  options?: string[];
  onSave: (value: unknown) => void;
  onCancel: () => void;
  className?: string;
}

export function CellEditor({ value, type, options, onSave, onCancel, className }: CellEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const [local, setLocal] = useState(() => {
    if (type === 'number') return value === null || value === undefined ? '' : String(value);
    if (type === 'boolean') return value ? 'true' : 'false';
    if (type === 'date') {
      if (!value) return '';
      try {
        const d = new Date(String(value));
        return isNaN(d.getTime()) ? '' : d.toISOString().split('T')[0];
      } catch {
        return '';
      }
    }
    return value === null || value === undefined ? '' : String(value);
  });

  useEffect(() => {
    if (type === 'select') selectRef.current?.focus();
    else inputRef.current?.focus();
  }, [type]);

  const commit = useCallback(() => {
    if (type === 'number') {
      const n = Number(local);
      onSave(isNaN(n) ? null : n);
    } else if (type === 'boolean') {
      onSave(local === 'true');
    } else if (type === 'date') {
      onSave(local || null);
    } else {
      onSave(local || null);
    }
  }, [local, type, onSave]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commit(); }
    if (e.key === 'Escape') onCancel();
  };

  if (type === 'select' && options?.length) {
    return (
      <select
        ref={selectRef}
        value={local}
        onChange={(e) => { setLocal(e.target.value); }}
        onBlur={commit}
        onKeyDown={handleKey}
        className={cn(
          'w-full bg-surface border border-border-strong rounded px-1.5 py-0.5 text-sm text-text-primary focus:outline-none',
          className
        )}
      >
        <option value="">—</option>
        {options.map((opt) => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    );
  }

  if (type === 'boolean') {
    return (
      <select
        ref={selectRef}
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        className={cn(
          'bg-surface border border-border-strong rounded px-1.5 py-0.5 text-sm text-text-primary focus:outline-none',
          className
        )}
      >
        <option value="true">Yes</option>
        <option value="false">No</option>
      </select>
    );
  }

  return (
    <input
      ref={inputRef}
      type={type === 'number' ? 'number' : type === 'date' ? 'date' : 'text'}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={handleKey}
      className={cn(
        'w-full bg-surface border border-border-strong rounded px-1.5 py-0.5 text-sm text-text-primary focus:outline-none tabular',
        className
      )}
    />
  );
}

export function resolveCellType(field: string): CellEditType {
  if (field === 'status' || field === 'health') return 'select';
  if (field === 'priority') return 'select';
  if (field.includes('date') || field.includes('created') || field.includes('updated') || field === 'deadline') return 'date';
  if (field === 'amount' || field === 'balance' || field.includes('calories') || field.includes('progress')) return 'number';
  if (field === 'read' || field === 'responded' || field === 'published' || field.includes('is_')) return 'boolean';
  return 'text';
}

export function resolveCellOptions(field: string): string[] | undefined {
  if (field === 'status') return ['not_started', 'in_progress', 'completed', 'on_hold', 'cancelled', 'active', 'archived', 'draft', 'pending', 'approved', 'rejected'];
  if (field === 'health') return ['healthy', 'warning', 'critical', 'neutral'];
  if (field === 'priority') return ['low', 'medium', 'high', 'urgent', 'p1', 'p2', 'p3', 'p4'];
  return undefined;
}

export function formatDisplayValue(value: unknown, field: string): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (field.includes('date') || field.includes('created') || field.includes('updated')) {
    try {
      return new Date(String(value)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { /* fall through */ }
  }
  if (typeof value === 'number') return String(value);
  return String(value);
}
