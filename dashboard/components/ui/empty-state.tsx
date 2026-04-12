import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; href: string };
  className?: string;
}

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div role="status" className={cn("py-12", className)}>
      <div className="flex items-start gap-4">
        <Icon className="h-6 w-6 text-text-muted shrink-0 mt-0.5" />
        <div className="space-y-1">
          <h3 className="text-lg font-heading font-medium text-text-primary">{title}</h3>
          <p className="text-sm text-text-secondary max-w-md">{description}</p>
          {action && (
            <Link
              href={action.href}
              className="inline-flex items-center gap-2 mt-3 text-sm font-medium text-accent hover:text-accent-hover transition-colors"
            >
              {action.label} →
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
