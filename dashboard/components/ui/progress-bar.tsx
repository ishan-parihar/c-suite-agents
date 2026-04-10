import { cn } from "@/lib/utils";
import { clamp } from "@/lib/utils";

const barColors: Record<string, string> = {
  healthy: "bg-healthy",
  warning: "bg-warning",
  critical: "bg-critical",
  accent: "bg-accent",
};

interface ProgressBarProps {
  value: number;
  max?: number;
  color?: "healthy" | "warning" | "critical" | "accent";
  label?: string;
  showLabel?: boolean;
  className?: string;
}

export function ProgressBar({
  value,
  max = 100,
  color = "accent",
  label,
  showLabel = true,
  className,
}: ProgressBarProps) {
  const percentage = clamp((value / max) * 100, 0, 100);
  const displayLabel = label ?? `${Math.round(percentage)}%`;

  return (
    <div className={cn("w-full space-y-1", className)}>
      {showLabel && (
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-secondary">{displayLabel}</span>
          <span className="tabular-nums text-text-muted">{Math.round(percentage)}%</span>
        </div>
      )}
      <div className="w-full h-2 bg-hover rounded-full overflow-hidden">
        <div
          className={cn("h-full rounded-full transition-all duration-300", barColors[color])}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
