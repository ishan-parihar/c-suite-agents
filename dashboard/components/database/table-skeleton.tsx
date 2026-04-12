/**
 * Loading skeleton for the DataTable component.
 * Renders a header row + 6 shimmer rows matching the table structure.
 */

export function TableSkeleton({ columns = 6 }: { columns?: number }) {
  return (
    <div className="rounded-md border border-border overflow-hidden">
      {/* Header skeleton */}
      <div className="sticky top-0 bg-surface border-b border-border px-4 py-2.5">
        <div className="flex gap-4">
          {Array.from({ length: columns }).map((_, i) => (
            <div
              key={i}
              className="h-3 w-20 animate-pulse rounded bg-hover"
            />
          ))}
        </div>
      </div>

      {/* Data row skeletons — 6 rows with alternating subtle bg */}
      {Array.from({ length: 6 }).map((_, rowIdx) => (
        <div
          key={rowIdx}
          className={`flex gap-4 px-4 py-2.5 ${
            rowIdx % 2 === 1 ? 'bg-surface/30' : 'bg-transparent'
          }`}
        >
          {Array.from({ length: columns }).map((_, colIdx) => (
            <div
              key={colIdx}
              className="h-4 animate-pulse rounded bg-hover"
              style={{ width: `${30 + Math.random() * 70}%` }}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
