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
      <div className="flex items-baseline gap-3">
        <div className="flex-1">
          <p className="font-heading text-2xl font-semibold tabular-nums">{value}</p>
          <p className="text-xs tracking-wider text-text-muted mt-1">{title}</p>
        </div>
        <Icon className="h-5 w-5 text-text-muted shrink-0" />
      </div>
      {trend && (
        <div className="flex items-center gap-1.5 mt-2 text-xs">
          <span
            className={cn(
              "font-medium",
              trend.direction === "up" ? "text-healthy" : "text-critical"
            )}
          >
            {trend.direction === "up" ? "↑" : "↓"} {Math.abs(trend.value)}%
          </span>
          {subtitle && <span className="text-text-secondary">{subtitle}</span>}
        </div>
      )}
      {!trend && subtitle && (
        <p className="text-xs text-text-secondary mt-2">{subtitle}</p>
      )}
    </Card>
  );
}
