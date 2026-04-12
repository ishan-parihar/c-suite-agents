'use client';

import { use, useMemo, useCallback, useState, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowLeft, Database, Table2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { DataTable, type DataTableColumnMeta } from '@/components/database/data-table';
import { RowDetailPanel } from '@/components/database/row-detail-panel';
import { FilterBar } from '@/components/database/filter-bar';
import { ColumnConfigModal, ColumnConfigButton, type ColumnConfig } from '@/components/database/column-config';
import { ViewSwitcher, type DataViewType } from '@/components/database/view-switcher';
import { KanbanView, type KanbanColumn } from '@/components/database/kanban-view';
import { CalendarView } from '@/components/database/calendar-view';
import { GalleryView } from '@/components/database/gallery-view';
import { useTableData, useInvalidateTable } from '@/lib/database/use-table-data';
import { useUpdateEntity } from '@/lib/database/mutations';
import { entityRegistry, type EntitySlug } from '@/lib/crud/entities';
import { STATUS_MAP, type StatusKey } from '@/lib/constants';
import { resolveCellType, resolveCellOptions } from '@/components/database/cell-editors';

function humanize(slug: string) {
  return slug
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function isStatusField(field: string) {
  return field === 'status' || field === 'health';
}

function isDateField(field: string) {
  return field.includes('date') || field.includes('created') || field.includes('updated');
}

function isPriorityField(field: string) {
  return field === 'priority';
}

function renderCell(value: unknown, field: string) {
  if (value === null || value === undefined) {
    return <span className="text-text-muted">&mdash;</span>;
  }

  if (isStatusField(field)) {
    const statusKey = (value as string).toLowerCase() as StatusKey;
    if (STATUS_MAP[statusKey]) {
      return <Badge status={statusKey} />;
    }
    return <Badge status="neutral" />;
  }

  if (isPriorityField(field)) {
    const priColors: Record<string, string> = {
      high: 'text-status-critical',
      medium: 'text-status-warning',
      low: 'text-status-healthy',
      urgent: 'text-status-critical',
      p1: 'text-status-critical',
      p2: 'text-status-warning',
      p3: 'text-status-healthy',
      p4: 'text-text-muted',
    };
    const color = priColors[String(value).toLowerCase()] || 'text-text-secondary';
    return (
      <span className={`font-mono text-xs ${color}`}>
        {String(value)}
      </span>
    );
  }

  if (isDateField(field)) {
    try {
      const d = new Date(String(value));
      if (!isNaN(d.getTime())) {
        return (
          <span className="tabular text-text-secondary">
            {d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        );
      }
    } catch {
      // fall through
    }
  }

  if (typeof value === 'boolean') {
    return (
      <span className={value ? 'text-status-healthy' : 'text-text-muted'}>
        {value ? 'Yes' : 'No'}
      </span>
    );
  }

  const str = String(value);
  if (str.length > 60) {
    return <span className="text-text-secondary" title={str}>{str.slice(0, 60)}&hellip;</span>;
  }

  return <span className="text-text-primary">{str}</span>;
}

export default function EntityTablePage(props: { params: Promise<{ entity: string }> }) {
  const params = use(props.params);
  const searchParams = useSearchParams();
  const router = useRouter();

  const entity = params.entity as EntitySlug;
  const config = entityRegistry[entity];

  const page = Number(searchParams.get('page')) || 1;
  const limit = Number(searchParams.get('limit')) || 25;
  const sort = searchParams.get('sort') || 'created_at';
  const order = (searchParams.get('order') as 'asc' | 'desc') || 'desc';
  const [filter, setFilter] = useState<Record<string, string> | null>(null);

  const { data, isLoading } = useTableData(entity, { page, limit, sort, order, filter: filter ?? undefined });
  const invalidate = useInvalidateTable(entity);
  const updateEntity = useUpdateEntity(entity);

  const navigateToPage = useCallback((newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', String(newPage));
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  const navigateToLimit = useCallback((newLimit: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('limit', String(newLimit));
    params.set('page', '1');
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [searchParams, router]);

  const handleCellEdit = useCallback((rowId: string | number, field: string, value: unknown) => {
    updateEntity.mutate(
      { id: rowId, data: { [field]: value } },
      { onSuccess: () => invalidate() }
    );
  }, [updateEntity, invalidate]);

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    if (!config) return [];

    return config.listFields.map((field) => ({
      accessorKey: field,
      header: humanize(field),
      cell: ({ getValue }) => renderCell(getValue(), field),
      sortDescFirst: isDateField(field) || field === 'priority',
    }));
  }, [config]);

  const columnMeta = useMemo<DataTableColumnMeta[]>(() => {
    if (!config) return [];
    return config.listFields.map((field) => ({
      field,
      editType: resolveCellType(field),
      editOptions: resolveCellOptions(field),
    }));
  }, [config]);

  if (!config) {
    return (
      <div>
        <Link
          href="/database"
          className="inline-flex items-center gap-1.5 text-sm text-text-secondary hover:text-accent transition-colors mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Database
        </Link>
        <EmptyState
          icon={Table2}
          title="Unknown table"
          description={`No entity found with slug "${entity}".`}
          action={{ label: 'View all tables', href: '/database' }}
        />
      </div>
    );
  }

  const items = data?.items || [];
  const total = data?.total || 0;
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [showColumnConfig, setShowColumnConfig] = useState(false);
  const [view, setView] = useState<DataViewType>(() => {
    try {
      return (localStorage.getItem(`operant:view:${entity}`) as DataViewType) || 'table';
    } catch { return 'table'; }
  });

  const handleViewChange = useCallback((v: DataViewType) => {
    setView(v);
    try { localStorage.setItem(`operant:view:${entity}`, v); } catch { /* quota */ }
  }, [entity]);

  const defaultColumnConfig = useMemo<ColumnConfig[]>(() => {
    if (!config) return [];
    return config.listFields.map((field) => ({
      id: field,
      header: humanize(field),
      visible: true,
      pinned: false as const,
    }));
  }, [config]);

  const [columnConfig, setColumnConfig] = useState<ColumnConfig[]>(() => {
    try {
      const raw = localStorage.getItem(`operant:columns:${entity}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch { /* corrupt data */ }
    return defaultColumnConfig;
  });

  const handleColumnConfigChange = useCallback((updated: ColumnConfig[]) => {
    setColumnConfig(updated);
    try {
      localStorage.setItem(`operant:columns:${entity}`, JSON.stringify(updated));
    } catch { /* quota */ }
  }, [entity]);

  useEffect(() => {
    const currentIds = new Set(columnConfig.map((c) => c.id));
    const newFields = config?.listFields.filter((f) => !currentIds.has(f)) ?? [];
    if (newFields.length > 0) {
      const added: ColumnConfig[] = newFields.map((f) => ({
        id: f,
        header: humanize(f),
        visible: true,
        pinned: false as const,
      }));
      setColumnConfig((prev) => [...prev, ...added]);
    }
  }, [config, columnConfig]);

  const kanbanGroupField = useMemo(() => {
    if (!config) return null;
    return config.filterableFields.find((f) => f === 'status' || f === 'phase') ?? null;
  }, [config]);

  const kanbanCols = useMemo<KanbanColumn[]>(() => {
    if (!kanbanGroupField || !data?.items) return [];
    const seen = new Map<string, string>();
    data.items.forEach((row) => {
      const val = String(row[kanbanGroupField] ?? '');
      if (val && !seen.has(val.toLowerCase())) {
        seen.set(val.toLowerCase(), val);
      }
    });
    return Array.from(seen.entries()).map(([id, label]) => ({ id, title: humanize(id) }));
  }, [config, data, kanbanGroupField]);

  const calendarDateField = useMemo(() => {
    if (!config) return null;
    return config.listFields.find((f) => f.includes('date') || f.includes('deadline')) ?? null;
  }, [config]);

  const entityTitleField = useMemo(() => {
    if (!config) return 'name';
    return config.listFields.find((f) => f === 'name' || f === 'title' || f === 'subject') ?? config.listFields[1] ?? 'id';
  }, [config]);

  const availableViews = useMemo<DataViewType[]>(() => {
    const views: DataViewType[] = ['table', 'gallery'];
    if (kanbanGroupField && kanbanCols.length > 0) views.push('kanban');
    if (calendarDateField) views.push('calendar');
    return views;
  }, [kanbanGroupField, kanbanCols, calendarDateField]);

  return (
    <div>
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/database"
          className="inline-flex items-center justify-center w-8 h-8 rounded-md border border-border text-text-muted hover:text-text-primary hover:bg-hover transition-colors shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-text-muted shrink-0" />
            <h1 className="font-heading text-lg font-semibold text-text-primary truncate">
              {humanize(entity)}
            </h1>
          </div>
          <p className="text-xs text-text-muted mt-0.5">
            {config.listFields.length} fields &middot; {total} records
          </p>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3">
        <FilterBar entity={entity} config={config} onFilterChange={setFilter} />
        <div className="flex items-center gap-2">
          <ViewSwitcher current={view} onChange={handleViewChange} available={availableViews} />
          <ColumnConfigButton onClick={() => setShowColumnConfig(true)} />
        </div>
      </div>

      {view === 'table' && (
        <>
          <DataTable
            entity={entity}
            columns={columns}
            columnMeta={columnMeta}
            columnConfig={columnConfig}
            data={items}
            loading={isLoading}
            total={total}
            page={page}
            limit={limit}
            searchable
            filterable
            onCellEdit={handleCellEdit}
            onRowClick={setSelectedRow}
            onPageChange={navigateToPage}
            onLimitChange={navigateToLimit}
          />
        </>
      )}

      {view === 'kanban' && kanbanGroupField && (
        <KanbanView
          data={items}
          columns={kanbanCols}
          groupField={kanbanGroupField}
          titleField={entityTitleField}
          statusField="status"
          onCardClick={setSelectedRow}
        />
      )}

      {view === 'calendar' && calendarDateField && (
        <CalendarView
          data={items}
          dateField={calendarDateField}
          titleField={entityTitleField}
          statusField="status"
          onCardClick={setSelectedRow}
        />
      )}

      {view === 'gallery' && (
        <GalleryView
          data={items}
          titleField={entityTitleField}
          statusField="status"
          onCardClick={setSelectedRow}
        />
      )}

      <RowDetailPanel
        open={!!selectedRow}
        onClose={() => setSelectedRow(null)}
        entity={entity}
        row={selectedRow}
        fields={config.listFields}
      />

      <ColumnConfigModal
        open={showColumnConfig}
        onClose={() => setShowColumnConfig(false)}
        columns={columnConfig}
        onChange={handleColumnConfigChange}
      />
    </div>
  );
}
