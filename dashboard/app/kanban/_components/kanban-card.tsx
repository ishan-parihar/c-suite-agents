"use client";

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { format } from "date-fns";
import { CalendarDays, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KanbanCard as KanbanCardType } from "@/lib/server/kanban";

const PRIORITY_COLORS: Record<string, string> = {
  high: "text-critical",
  medium: "text-warning",
  low: "text-healthy",
};

const PRIORITY_LABELS: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

interface KanbanCardProps {
  card: KanbanCardType;
  onDoubleClick: () => void;
  isDragging?: boolean;
}

export function KanbanCard({ card, onDoubleClick, isDragging }: KanbanCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isSortableDragging,
  } = useSortable({ id: card.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const priorityColor = card.priority ? PRIORITY_COLORS[card.priority] ?? "text-text-muted" : "text-text-muted";
  const priorityLabel = card.priority ? PRIORITY_LABELS[card.priority] ?? card.priority : "None";

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onDoubleClick();
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      className={cn(
        "group rounded-lg border bg-surface p-3 cursor-grab active:cursor-grabbing transition-all",
        isSortableDragging && "opacity-50 shadow-xl",
        isDragging && "shadow-2xl rotate-2",
        "hover:border-border-strong"
      )}
      onDoubleClick={onDoubleClick}
      onKeyDown={handleKeyDown}
      tabIndex={0}
      role="button"
      aria-label={`Card: ${card.title}, Priority: ${priorityLabel}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div {...listeners} className="mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab">
          <Clock className="h-3 w-3 text-text-muted" />
        </div>
        <span className={cn("text-xs font-medium", priorityColor)}>{priorityLabel}</span>
      </div>

      <p className="text-sm text-text-primary mt-1 line-clamp-2">{card.title}</p>

      <div className="flex items-center justify-between mt-2 gap-2">
        {card.due ? (
          <span className="flex items-center gap-1 text-xs text-text-secondary">
            <CalendarDays className="h-3 w-3" />
            {format(new Date(card.due), "MMM d")}
          </span>
        ) : (
          <span />
        )}

        {card.tags && card.tags.length > 0 && (
          <div className="flex gap-1">
            {card.tags.slice(0, 2).map((tag: string, i: number) => (
              <span
                key={i}
                className="text-[10px] px-1.5 py-0.5 rounded bg-hover text-text-muted truncate max-w-[60px]"
              >
                {tag}
              </span>
            ))}
            {card.tags.length > 2 && (
              <span className="text-[10px] text-text-muted">+{card.tags.length - 2}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
