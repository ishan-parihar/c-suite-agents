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
    <div className={cn("flex flex-col items-center justify-center py-12 text-center", className)}>
      <div className="mb-4 rounded-full bg-hover p-4 text-text-muted">
        <Icon className="h-8 w-8" />
      </div>
      <h3 className="mb-1 text-lg font-medium text-text-primary">{title}</h3>
      <p className="mb-4 max-w-sm text-sm text-text-secondary">{description}</p>
      {action && (
        <Link
          href={action.href}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-accent-hover"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
