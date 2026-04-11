"use client";

import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { KanbanCard } from "./kanban-card";
import { Plus, GripVertical, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KanbanColumn as KanbanColumnType, KanbanCard as KanbanCardType } from "@/lib/server/kanban";

interface KanbanColumnProps {
  column: KanbanColumnType;
  cards: KanbanCardType[];
  onCardDoubleClick: (card: KanbanCardType) => void;
  onCardAdd: (columnId: string, title: string) => void;
  onDeleteCard?: (cardId: string) => void;
  onRenameColumn?: (columnId: string, newName: string) => void;
  onDeleteColumn?: (columnId: string) => void;
}

export function KanbanColumn({
  column,
  cards,
  onCardDoubleClick,
  onCardAdd,
  onDeleteCard,
  onRenameColumn,
  onDeleteColumn,
}: KanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column.id });
  const [isAdding, setIsAdding] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(column.name);

  const handleSubmit = () => {
    if (newTitle.trim()) {
      onCardAdd(column.id, newTitle.trim());
      setNewTitle("");
      setIsAdding(false);
    }
  };

  const handleRenameSubmit = () => {
    if (renameValue.trim() && renameValue.trim() !== column.name) {
      onRenameColumn?.(column.id, renameValue.trim());
    } else {
      setRenameValue(column.name);
    }
    setIsRenaming(false);
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
        <div className="flex items-center gap-2 flex-1 min-w-0">
          {isRenaming ? (
            <div className="flex items-center gap-1 flex-1">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleRenameSubmit();
                  if (e.key === "Escape") { setRenameValue(column.name); setIsRenaming(false); }
                }}
                onBlur={handleRenameSubmit}
                autoFocus
                className="flex-1 bg-surface border border-border-strong rounded px-1.5 py-0.5 text-sm text-text-primary outline-none"
              />
            </div>
          ) : (
            <>
              <h3 className="text-sm font-medium text-text-primary truncate">{column.name}</h3>
              <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-mono tabular-nums bg-hover text-text-secondary">
                {cards.length}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setIsAdding(true)}
            className="p-1 rounded transition-colors text-text-muted hover:text-text-primary hover:bg-hover"
            aria-label="Add card"
          >
            <Plus className="h-4 w-4" />
          </button>
          <div className="relative">
            <button
              onClick={() => setColumnMenuOpen(!columnMenuOpen)}
              className="p-1 rounded transition-colors text-text-muted hover:text-text-primary hover:bg-hover"
              aria-label="Column options"
            >
              <MoreVertical className="h-4 w-4" />
            </button>
            {columnMenuOpen && (
              <div className="absolute right-0 top-full mt-1 w-40 rounded-md border border-border bg-elevated shadow-lg z-10">
                <button
                  onClick={() => { setIsRenaming(true); setColumnMenuOpen(false); }}
                  className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-secondary hover:bg-hover hover:text-text-primary transition-colors"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Rename column
                </button>
                {onDeleteColumn && (
                  <button
                    onClick={() => { onDeleteColumn(column.id); setColumnMenuOpen(false); }}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-critical hover:bg-hover transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete column
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[calc(100vh-300px)] min-h-[120px]">
        {cards.length > 0 ? (
          <SortableContext items={cards.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {cards.map((card) => (
              <KanbanCard
                key={card.id}
                card={card}
                onDoubleClick={() => onCardDoubleClick(card)}
                onDelete={onDeleteCard ? () => onDeleteCard(card.id) : undefined}
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
