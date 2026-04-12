'use client';

import { useState, useCallback, useEffect } from 'react';
import { Filter, Plus, X, Save, ChevronDown, Trash2 } from 'lucide-react';
import type { EntityConfig, EntitySlug } from '@/lib/crud/entities';

export interface FilterCondition {
  field: string;
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt';
  value: string;
}

export interface SavedFilter {
  id: string;
  name: string;
  conditions: FilterCondition[];
}

const OPERATORS: { value: FilterCondition['operator']; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'contains', label: 'contains' },
  { value: 'gt', label: '>' },
  { value: 'lt', label: '<' },
];

function storageKey(entity: EntitySlug) {
  return `operant:filters:${entity}`;
}

function loadPresets(entity: EntitySlug): SavedFilter[] {
  try {
    const raw = localStorage.getItem(storageKey(entity));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function savePresets(entity: EntitySlug, presets: SavedFilter[]) {
  try {
    localStorage.setItem(storageKey(entity), JSON.stringify(presets));
  } catch { /* quota exceeded */ }
}

export function FilterBar({
  entity,
  config,
  onFilterChange,
}: {
  entity: EntitySlug;
  config: EntityConfig;
  onFilterChange: (filter: Record<string, string> | null) => void;
}) {
  const [conditions, setConditions] = useState<FilterCondition[]>([]);
  const [presets, setPresets] = useState<SavedFilter[]>(() => loadPresets(entity));
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [saveName, setSaveName] = useState('');

  const addCondition = useCallback(() => {
    const firstField = config.filterableFields[0] ?? '';
    setConditions((prev) => [...prev, { field: firstField, operator: 'eq', value: '' }]);
  }, [config.filterableFields]);

  const updateCondition = useCallback((index: number, patch: Partial<FilterCondition>) => {
    setConditions((prev) => prev.map((c, i) => i === index ? { ...c, ...patch } : c));
  }, []);

  const removeCondition = useCallback((index: number) => {
    setConditions((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const applyFilters = useCallback(() => {
    const active = conditions.filter((c) => c.value.trim());
    if (active.length === 0) {
      onFilterChange(null);
      return;
    }
    const filter: Record<string, string> = {};
    active.forEach((c) => {
      filter[c.field] = c.operator === 'contains' ? `*${c.value}*` : c.value;
    });
    onFilterChange(filter);
  }, [conditions, onFilterChange]);

  const savePreset = useCallback(() => {
    const name = saveName.trim();
    if (!name || conditions.length === 0) return;
    const preset: SavedFilter = { id: crypto.randomUUID(), name, conditions: [...conditions] };
    const updated = [...presets, preset];
    setPresets(updated);
    savePresets(entity, updated);
    setSaveName('');
  }, [saveName, conditions, presets, entity]);

  const loadPreset = useCallback((preset: SavedFilter) => {
    setConditions([...preset.conditions]);
    setShowPresetMenu(false);
  }, []);

  const deletePreset = useCallback((id: string) => {
    const updated = presets.filter((p) => p.id !== id);
    setPresets(updated);
    savePresets(entity, updated);
  }, [presets, entity]);

  useEffect(() => {
    applyFilters();
  }, [applyFilters]);

  if (conditions.length === 0) {
    return (
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={addCondition}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-md text-text-secondary hover:text-text-primary hover:bg-hover transition-colors"
        >
          <Filter className="w-3.5 h-3.5" />
          Filter
        </button>
        {presets.length > 0 && (
          <div className="relative">
            <button
              onClick={() => setShowPresetMenu(!showPresetMenu)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm border border-border rounded-md text-text-secondary hover:text-text-primary hover:bg-hover transition-colors"
            >
              <ChevronDown className="w-3.5 h-3.5" />
              Saved
            </button>
            {showPresetMenu && (
              <div className="absolute top-full left-0 mt-1 w-48 bg-elevated border border-border rounded-md shadow-lg py-1 z-10">
                {presets.map((p) => (
                  <div key={p.id} className="flex items-center group">
                    <button
                      onClick={() => loadPreset(p)}
                      className="flex-1 text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-hover hover:text-text-primary"
                    >
                      {p.name}
                    </button>
                    <button
                      onClick={() => deletePreset(p.id)}
                      className="px-2 py-1.5 text-text-muted hover:text-critical opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-2 mb-3">
      <div className="flex flex-wrap items-center gap-2">
        {conditions.map((cond, i) => (
          <div key={i} className="flex items-center gap-1">
            {i > 0 && <span className="text-xs text-text-muted px-1">AND</span>}
            <select
              value={cond.field}
              onChange={(e) => updateCondition(i, { field: e.target.value })}
              className="text-xs bg-surface border border-border rounded px-1.5 py-1 text-text-primary focus:outline-none focus:border-border-strong"
            >
              {config.filterableFields.map((f) => (
                <option key={f} value={f}>{f.replace(/_/g, ' ')}</option>
              ))}
            </select>
            <select
              value={cond.operator}
              onChange={(e) => updateCondition(i, { operator: e.target.value as FilterCondition['operator'] })}
              className="text-xs bg-surface border border-border rounded px-1.5 py-1 text-text-primary focus:outline-none focus:border-border-strong w-20"
            >
              {OPERATORS.map((op) => (
                <option key={op.value} value={op.value}>{op.label}</option>
              ))}
            </select>
            <input
              value={cond.value}
              onChange={(e) => updateCondition(i, { value: e.target.value })}
              placeholder="Value"
              className="text-xs bg-surface border border-border rounded px-1.5 py-1 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-strong w-24"
            />
            <button
              onClick={() => removeCondition(i)}
              className="p-1 text-text-muted hover:text-critical transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        ))}
        <button
          onClick={addCondition}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-border rounded text-text-secondary hover:text-text-primary hover:bg-hover transition-colors"
        >
          <Plus className="w-3 h-3" />
        </button>
        <div className="flex items-center gap-1 ml-2">
          <input
            value={saveName}
            onChange={(e) => setSaveName(e.target.value)}
            placeholder="Save as..."
            className="text-xs bg-surface border border-border rounded px-1.5 py-1 text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-strong w-20"
          />
          <button
            onClick={savePreset}
            disabled={!saveName.trim()}
            className="inline-flex items-center gap-1 px-2 py-1 text-xs border border-border rounded text-text-secondary hover:text-text-primary hover:bg-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-3 h-3" />
          </button>
        </div>
      </div>
    </div>
  );
}
