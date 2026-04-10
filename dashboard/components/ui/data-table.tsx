"use client";

import { useState } from "react";
import {
  type ColumnDef,
  type ColumnFiltersState,
  type SortingState,
  type PaginationState,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  Search,
  ChevronUp,
  ChevronDown,
  ChevronsUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "./skeleton";
import { EmptyState } from "./empty-state";

interface DataTableProps<TData, TValue> {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  searchKey?: string;
  searchPlaceholder?: string;
  filterColumn?: string;
  filterOptions?: { label: string; value: string }[];
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  className?: string;
}

export function DataTable<TData, TValue>({
  columns,
  data,
  searchKey,
  searchPlaceholder = "Search...",
  filterColumn,
  filterOptions,
  loading,
  emptyTitle = "No results found",
  emptyDescription = "Try adjusting your search or filter criteria.",
  className,
}: DataTableProps<TData, TValue>) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnFilters, globalFilter, pagination },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    globalFilterFn: (row, columnId, filterValue) => {
      const value = row.getValue(searchKey ?? columnId);
      return String(value).toLowerCase().includes(filterValue.toLowerCase());
    },
  });

  if (loading) {
    return <Skeleton variant="table" lines={10} className={className} />;
  }

  const hasResults = table.getFilteredRowModel().rows.length > 0;
  const filteredCount = table.getFilteredRowModel().rows.length;

  if (!hasResults) {
    return (
      <div className={cn("rounded-lg border border-border bg-surface", className)}>
        <EmptyState icon={Search} title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  const paginationState = table.getState().pagination;
  const startRow = paginationState.pageIndex * paginationState.pageSize + 1;
  const endRow = Math.min(
    (paginationState.pageIndex + 1) * paginationState.pageSize,
    filteredCount
  );

  return (
    <div className={cn("space-y-4", className)}>
      {(searchKey || (filterColumn && filterOptions)) && (
        <div className="flex items-center gap-3">
          {searchKey && (
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full rounded-md border border-border bg-surface pl-9 pr-4 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-border-strong focus:outline-none"
              />
            </div>
          )}
          {filterColumn && filterOptions && (
            <select
              value={(table.getColumn(filterColumn)?.getFilterValue() as string) ?? ""}
              onChange={(e) =>
                table.getColumn(filterColumn)?.setFilterValue(e.target.value || undefined)
              }
              className="rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-border-strong focus:outline-none"
            >
              <option value="">All</option>
              {filterOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      <div className="rounded-lg border border-border bg-surface overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id} className="border-b border-border">
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={cn(
                        "px-4 py-3 text-left font-medium text-text-secondary uppercase tracking-wider text-xs",
                        header.column.getCanSort() && "cursor-pointer select-none hover:bg-hover/50"
                      )}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1.5">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <span className="text-text-muted">
                            {{
                              asc: <ChevronUp className="h-3.5 w-3.5" />,
                              desc: <ChevronDown className="h-3.5 w-3.5" />,
                            }[header.column.getIsSorted() as string] ?? (
                              <ChevronsUpDown className="h-3.5 w-3.5" />
                            )}
                          </span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-b border-border last:border-b-0 hover:bg-hover/50 transition-colors"
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className="px-4 py-3 text-text-primary">
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between text-sm text-text-secondary">
        <span>
          Showing {startRow} to {endRow} of {filteredCount} results
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:bg-hover/50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            Previous
          </button>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text-secondary hover:bg-hover/50 disabled:opacity-40 disabled:pointer-events-none transition-colors"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
