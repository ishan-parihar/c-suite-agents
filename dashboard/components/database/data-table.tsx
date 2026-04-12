'use client';

import {
  type ColumnDef,
  type SortingState,
  type PaginationState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { useState, useMemo, useCallback } from 'react';
import { ChevronDown, ChevronUp, ChevronsUpDown, ChevronLeft, ChevronRight, Search, Filter, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { TableSkeleton } from './table-skeleton';
import { PAGINATION_SIZES } from '@/lib/constants';
import type { EntitySlug } from '@/lib/crud/entities';
import type { ListResponse } from '@/lib/database/use-table-data';

export interface DataTableProps<TData> {
  entity: EntitySlug;
  columns: ColumnDef<TData>[];
  data: TData[];
  loading: boolean;
  total: number;
  onRowClick?: (row: TData) => void;
  searchable?: boolean;
  filterable?: boolean;
}

export function DataTable<TData extends Record<string, unknown>>({
  entity,
  columns,
  data,
  loading,
  total,
  onRowClick,
  searchable = false,
  filterable = false,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 25,
  });
  const [search, setSearch] = useState('');

  const table = useReactTable<TData>({
    data,
    columns,
    state: {
      sorting,
      pagination,
    },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    enableColumnResizing: true,
    columnResizeMode: 'onChange',
    manualPagination: true,
    manualSorting: true,
    pageCount: Math.ceil(total / pagination.pageSize),
  });

  const filteredData = useMemo(() => {
    if (!search) return data;
    const term = search.toLowerCase();
    return data.filter((row) =>
      Object.values(row).some((val) =>
        typeof val === 'string' && val.toLowerCase().includes(term)
      )
    );
  }, [data, search]);

  const handleSearchChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setSearch(e.target.value);
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  }, []);

  const handlePageSizeChange = useCallback((size: number) => {
    setPagination({ pageIndex: 0, pageSize: size });
  }, []);

  const startIdx = pagination.pageIndex * pagination.pageSize + 1;
  const endIdx = Math.min((pagination.pageIndex + 1) * pagination.pageSize, total);

  if (loading) {
    return <TableSkeleton columns={columns.length} />;
  }

  if (data.length === 0 && !search) {
    return (
      <EmptyState
        icon={Search}
        title={`No ${entity} records yet`}
        description="Records will appear here once they're created or synced."
      />
    );
  }

  return (
    <div>
      {(searchable || filterable) && (
        <div className="flex items-center gap-3 mb-3">
          {searchable && (
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={handleSearchChange}
                placeholder="Search records..."
                className="w-full pl-9 pr-8 py-2 text-sm bg-surface border border-border rounded-md text-text-primary placeholder:text-text-muted focus:outline-none focus:border-border-strong"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-hover"
                >
                  <X className="w-3.5 h-3.5 text-text-muted" />
                </button>
              )}
            </div>
          )}
          {filterable && (
            <button className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-border rounded-md text-text-secondary hover:bg-hover hover:text-text-primary transition-colors">
              <Filter className="w-3.5 h-3.5" />
              Filter
            </button>
          )}
        </div>
      )}

      <div className="rounded-md border border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="sticky top-0 bg-surface border-b border-border">
                  {headerGroup.headers.map((header) => {
                    const isSortable = header.column.getCanSort();
                    const sortDir = header.column.getIsSorted();

                    return (
                      <th
                        key={header.id}
                        className={`font-heading text-xs uppercase tracking-wide text-text-muted text-left px-4 py-2.5 select-none ${
                          isSortable ? 'cursor-pointer hover:text-text-secondary transition-colors' : ''
                        }`}
                        style={{ width: header.getSize() !== 150 ? header.getSize() : undefined }}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        <div className="flex items-center gap-1">
                          {header.isPlaceholder
                            ? null
                            : flexRender(header.column.columnDef.header, header.getContext())}
                          {isSortable && (
                            <span className="text-text-muted ml-0.5">
                              {sortDir === 'asc' ? (
                                <ChevronUp className="w-3.5 h-3.5" />
                              ) : sortDir === 'desc' ? (
                                <ChevronDown className="w-3.5 h-3.5" />
                              ) : (
                                <ChevronsUpDown className="w-3.5 h-3.5" />
                              )}
                            </span>
                          )}
                        </div>
                      </th>
                    );
                  })}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-4 py-12 text-center text-text-secondary">
                    No results match your search.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row, rowIdx) => (
                  <tr
                    key={row.id}
                    className={`border-b border-border/50 transition-colors ${
                      rowIdx % 2 === 1 ? 'bg-surface/30' : 'bg-transparent'
                    } ${onRowClick ? 'hover:bg-hover cursor-pointer' : 'hover:bg-hover'}`}
                    onClick={() => onRowClick?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td
                        key={cell.id}
                        className="px-4 py-2.5 text-text-primary overflow-hidden text-ellipsis whitespace-nowrap"
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between pt-3 pb-2 border-t border-border">
        <span className="text-sm text-text-secondary">
          Showing {total === 0 ? 0 : startIdx}–{endIdx} of {total}
        </span>

        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-muted">Rows:</span>
            <select
              value={pagination.pageSize}
              onChange={(e) => handlePageSizeChange(Number(e.target.value))}
              className="text-sm bg-surface border border-border rounded px-2 py-1 text-text-primary focus:outline-none focus:border-border-strong"
            >
              {PAGINATION_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-1">
            <button
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm border border-border rounded text-text-secondary hover:bg-hover hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary transition-colors"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
              Prev
            </button>
            <span className="text-xs text-text-muted px-2 tabular">
              Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount() || 1}
            </span>
            <button
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-sm border border-border rounded text-text-secondary hover:bg-hover hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-text-secondary transition-colors"
            >
              Next
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
