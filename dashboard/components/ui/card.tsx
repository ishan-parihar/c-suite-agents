import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const variantStyles: Record<string, string> = {
  default: "bg-surface border border-border",
  elevated: "bg-elevated border border-border shadow-lg",
  bordered: "bg-surface border-2 border-accent/20",
};

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated" | "bordered";
}

export function Card({ variant = "default", className, onClick, children, ...props }: CardProps) {
  const isInteractive = !!onClick;
  return (
    <div
      className={cn(
        "rounded-lg transition-colors",
        variantStyles[variant],
        isInteractive && "cursor-pointer hover:border-border-strong",
        className
      )}
      onClick={onClick}
      role={isInteractive ? "button" : undefined}
      tabIndex={isInteractive ? 0 : undefined}
      {...props}
    >
      {children}
    </div>
  );
}

interface CardSectionProps extends HTMLAttributes<HTMLDivElement> {}

export function CardHeader({ className, children, ...props }: CardSectionProps) {
  return (
    <div className={cn("px-4 py-3 border-b border-border", className)} {...props}>
      {children}
    </div>
  );
}

export function CardContent({ className, children, ...props }: CardSectionProps) {
  return (
    <div className={cn("px-4 py-3", className)} {...props}>
      {children}
    </div>
  );
}

export function CardFooter({ className, children, ...props }: CardSectionProps) {
  return (
    <div className={cn("px-4 py-3 border-t border-border", className)} {...props}>
      {children}
    </div>
  );
}
