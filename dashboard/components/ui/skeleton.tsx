import { cn } from "@/lib/utils";

interface SkeletonProps {
  variant?: "card" | "table" | "text" | "chart" | "stat";
  lines?: number;
  className?: string;
}

const base = "animate-pulse rounded-md bg-hover";

export function Skeleton({ variant = "text", lines = 3, className }: SkeletonProps) {
  if (variant === "card") {
    return (
      <div className={cn("space-y-3 p-4", className)}>
        <div className={cn(base, "h-4 w-1/3")} />
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className={cn(base, `h-3 w-${i % 2 === 0 ? "full" : "5/6"}`)} />
        ))}
      </div>
    );
  }

  if (variant === "table") {
    return (
      <div className={cn("space-y-2 p-4", className)}>
        <div className="flex gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={cn(base, "h-3 flex-1")} />
          ))}
        </div>
        {Array.from({ length: lines }).map((_, i) => (
          <div key={i} className="flex gap-4">
            {Array.from({ length: 4 }).map((_, j) => (
              <div key={j} className={cn(base, "h-3 flex-1")} />
            ))}
          </div>
        ))}
      </div>
    );
  }

  if (variant === "chart") {
    return (
      <div className={cn("space-y-3 p-4", className)}>
        <div className={cn(base, "h-4 w-1/4")} />
        <div className={cn(base, "h-48 w-full")} />
      </div>
    );
  }

  if (variant === "stat") {
    return (
      <div className={cn("space-y-2 p-4", className)}>
        <div className={cn(base, "h-3 w-1/3")} />
        <div className={cn(base, "h-7 w-1/2")} />
      </div>
    );
  }

  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn(
            base,
            "h-3",
            i === lines - 1 ? "w-4/5" : "w-full"
          )}
        />
      ))}
    </div>
  );
}
