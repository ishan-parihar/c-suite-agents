'use client';

import { use, useMemo } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { ArrowLeft, Database, Table2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { DataTable } from '@/components/database/data-table';
import { useTableData } from '@/lib/database/use-table-data';
import { entityRegistry, type EntitySlug } from '@/lib/crud/entities';
import { STATUS_MAP, type StatusKey } from '@/lib/constants';

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

  const entity = params.entity as EntitySlug;
  const config = entityRegistry[entity];

  const page = Number(searchParams.get('page')) || 1;
  const limit = Number(searchParams.get('limit')) || 25;
  const sort = searchParams.get('sort') || 'created_at';
  const order = (searchParams.get('order') as 'asc' | 'desc') || 'desc';

  const { data, isLoading } = useTableData(entity, { page, limit, sort, order });

  const columns = useMemo<ColumnDef<Record<string, unknown>>[]>(() => {
    if (!config) return [];

    return config.listFields.map((field) => ({
      accessorKey: field,
      header: humanize(field),
      cell: ({ getValue }) => renderCell(getValue(), field),
      sortDescFirst: isDateField(field) || field === 'priority',
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

      <DataTable
        entity={entity}
        columns={columns}
        data={items}
        loading={isLoading}
        total={total}
        searchable
        filterable
      />
    </div>
  );
}
