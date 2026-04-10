import { cn } from "@/lib/utils";
import { STATUS_MAP, type StatusKey } from "@/lib/constants";

interface BadgeProps {
  status: StatusKey;
  children?: React.ReactNode;
  className?: string;
}

export function Badge({ status, children, className }: BadgeProps) {
  const config = STATUS_MAP[status] ?? STATUS_MAP.neutral;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium",
        className
      )}
      style={{
        backgroundColor: `${config.color}20`,
        color: config.color,
      }}
      role="status"
      aria-label={`Status: ${children ?? config.label}`}
    >
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: config.color }} />
      {children ?? config.label}
    </span>
  );
}
