"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { KanbanCard } from "./kanban-card";
import { Plus, GripVertical } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KanbanColumn as KanbanColumnType, KanbanCard as KanbanCardType } from "@/lib/server/kanban";

interface KanbanColumnProps {
  column: KanbanColumnType;
  cards: KanbanCardType[];
  onCardDoubleClick: (card: KanbanCardType) => void;
  onCardAdd: (columnId: string, title: string) => void;
}

export function KanbanColumn({ column, cards, onCardDoubleClick, onCardAdd }: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");

  const handleSubmit = () => {
    if (newTitle.trim()) {
      onCardAdd(column.id, newTitle.trim());
      setNewTitle("");
      setIsAdding(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSubmit();
    if (e.key === "Escape") {
      setNewTitle("");
      setIsAdding(false);
    }
  };

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex-shrink-0 w-72 flex flex-col rounded-lg border transition-colors",
        isOver ? "border-border-strong bg-elevated" : "border-border bg-surface"
      )}
    >
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-border">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-text-primary">{column.name}</h3>
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-mono tabular-nums bg-hover text-text-secondary">
            {cards.length}
          </span>
        </div>
        <button
          onClick={() => setIsAdding(true)}
          className="p-1 rounded transition-colors text-text-muted hover:text-text-primary hover:bg-hover"
          aria-label="Add card"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-300px)] min-h-[120px]">
        {cards.length > 0 ? (
          <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {cards.map((card) => (
              <KanbanCard
                key={card.id}
                card={card}
                onDoubleClick={() => onCardDoubleClick(card)}
              />
            ))}
          </SortableContext>
        ) : (
          <div className="flex flex-col items-center justify-center h-24 text-text-muted text-xs">
            <GripVertical className="h-4 w-4 mb-1 opacity-50" />
            Drop cards here
          </div>
        )}

        {isAdding && (
          <div className="bg-elevated border border-border rounded-lg p-2">
            <input
              type="text"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSubmit}
              placeholder="Card title..."
              autoFocus
              className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-muted outline-none"
            />
          </div>
        )}
      </div>
    </div>
  );
}
