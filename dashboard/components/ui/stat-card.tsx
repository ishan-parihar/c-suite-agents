import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "./card";
import { Skeleton } from "./skeleton";

interface StatCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  trend?: { value: number; direction: "up" | "down" };
  subtitle?: string;
  loading?: boolean;
  className?: string;
}

export function StatCard({
  title,
  value,
  icon: Icon,
  trend,
  subtitle,
  loading,
  className,
}: StatCardProps) {
  if (loading) {
    return (
      <Card className={cn("p-0 overflow-hidden", className)}>
        <Skeleton variant="stat" />
      </Card>
    );
  }

  return (
    <Card className={cn("p-4", className)} aria-label={`${title}: ${value}`}>
      <div className="flex items-start justify-between">
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider text-text-muted">{title}</p>
          <p className="font-mono text-2xl font-semibold tabular-nums">{value}</p>
          {(trend || subtitle) && (
            <div className="flex items-center gap-2 text-sm">
              {trend && (
                <span
                  className={cn(
                    "flex items-center gap-0.5 font-medium",
                    trend.direction === "up" ? "text-healthy" : "text-critical"
                  )}
                >
                  {trend.direction === "up" ? "\u2191" : "\u2193"}
                  {Math.abs(trend.value)}%
                </span>
              )}
              {subtitle && <span className="text-text-secondary">{subtitle}</span>}
            </div>
          )}
        </div>
        <div className="rounded-md bg-hover p-2 text-text-secondary">
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </Card>
  );
}
