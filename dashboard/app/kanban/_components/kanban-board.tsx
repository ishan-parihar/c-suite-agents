"use client";

import { useState, useCallback } from "react";
import {
  DndContext,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { KanbanColumn } from "./kanban-column";
import { KanbanCard } from "./kanban-card";
import { KanbanCardModal } from "./kanban-card-modal";
import type { KanbanColumn as KanbanColumnType, KanbanCard as KanbanCardType } from "@/lib/server/kanban";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { ChartCard } from "@/components/ui/chart-card";
import { DeleteDialog } from "@/components/crud/delete-dialog";
import dynamic from "next/dynamic";
import { useSSE } from "@/lib/sse/client";

const CardDistributionChart = dynamic(() => import("./card-distribution-chart"), {
  ssr: false,
  loading: () => <ChartCard title="Card Distribution" loading><Skeleton variant="chart" /></ChartCard>,
});

interface KanbanBoardProps {
  columns: KanbanColumnType[];
  cards: KanbanCardType[];
}

export function KanbanBoard({ columns: initialColumns, cards: initialCards }: KanbanBoardProps) {
  const [columns, setColumns] = useState(initialColumns);
  const [cards, setCards] = useState(initialCards);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [selectedCard, setSelectedCard] = useState<KanbanCardType | null>(null);
  const [deleteCardId, setDeleteCardId] = useState<string | null>(null);
  const [deletingCardTitle, setDeletingCardTitle] = useState("");

  useSSE("/api/cron/outbox", [["kanban"], ["kanban-cards"]]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const getColumnCards = useCallback(
    (columnId: string) => cards.filter((c) => c.columnId === columnId),
    [cards]
  );

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    if (activeId === overId) return;

    const activeCard = cards.find((c) => c.id === activeId);
    if (!activeCard) return;

    const isOverColumn = columns.some((col) => col.id === overId);
    const overCard = cards.find((c) => c.id === overId);

    if (isOverColumn && activeCard.columnId !== overId) {
      setCards((prev) =>
        prev.map((c) => (c.id === activeId ? { ...c, columnId: overId } : c))
      );
    } else if (overCard && activeCard.columnId !== overCard.columnId) {
      setCards((prev) =>
        prev.map((c) => (c.id === activeId ? { ...c, columnId: overCard.columnId } : c))
      );
    }
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeId = active.id as string;
    const overId = over.id as string;

    const activeCard = cards.find((c) => c.id === activeId);
    if (!activeCard) return;

    const isOverColumn = columns.some((col) => col.id === overId);
    const overCard = cards.find((c) => c.id === overId);

    const targetColumnId = isOverColumn ? overId : (overCard?.columnId ?? activeCard.columnId);
    const previousColumnId = activeCard.columnId;

    if (targetColumnId === previousColumnId && activeId !== overId) {
      const columnCards = cards.filter((c) => c.columnId === targetColumnId);
      const oldIndex = columnCards.findIndex((c) => c.id === activeId);
      const newIndex = columnCards.findIndex((c) => c.id === overId);
      if (oldIndex !== -1 && newIndex !== -1) {
        const newOrderedCards = arrayMove(columnCards, oldIndex, newIndex);
        const otherCards = cards.filter((c) => c.columnId !== targetColumnId);
        setCards([...otherCards, ...newOrderedCards]);
      }
      return;
    }

    const snapshot = [...cards];

    setCards((prev) =>
      prev.map((c) => (c.id === activeId ? { ...c, columnId: targetColumnId } : c))
    );

    try {
      const res = await fetch("/api/kanban/cards", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId: activeId, columnId: targetColumnId }),
      });

      if (!res.ok) {
        throw new Error("Failed to move card");
      }
    } catch {
      setCards(snapshot);
      toast.error("Failed to move card. Changes rolled back.");
    }
  };

  const handleCardAdd = (columnId: string, title: string) => {
    const boardId = cards[0]?.boardId ?? columns[0]?.boardId;
    if (!boardId) return;

    const newCard: KanbanCardType = {
      id: `temp-${Date.now()}`,
      boardId,
      columnId,
      title,
      description: null,
      priority: "medium",
      due: null,
      tags: [],
      assigneeAgentId: null,
      projectId: null,
      lastUpdate: new Date(),
      createdAt: new Date(),
    };

    setCards((prev) => [...prev, newCard]);

    fetch("/api/kanban/cards", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ boardId, columnId, title, priority: "medium" }),
    }).catch(() => {
      setCards((prev) => prev.filter((c) => c.id !== newCard.id));
      toast.error("Failed to create card.");
    });
  };

  const handleDeleteCard = async (cardId: string) => {
    const card = cards.find((c) => c.id === cardId);
    if (!card) return;
    setDeleteCardId(cardId);
    setDeletingCardTitle(card.title);
  };

  const confirmDeleteCard = async () => {
    if (!deleteCardId) return;
    const snapshot = [...cards];
    setCards((prev) => prev.filter((c) => c.id !== deleteCardId));

    try {
      const res = await fetch(`/api/kanban/cards/${deleteCardId}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete card");
      toast.success("Card deleted");
    } catch {
      setCards(snapshot);
      toast.error("Failed to delete card. Changes rolled back.");
    } finally {
      setDeleteCardId(null);
      setDeletingCardTitle("");
    }
  };

  const handleRenameColumn = async (columnId: string, newName: string) => {
    const snapshot = [...columns];
    setColumns((prev) => prev.map((c) => (c.id === columnId ? { ...c, name: newName } : c)));

    try {
      const res = await fetch("/api/kanban/cards", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId, name: newName }),
      });
      if (!res.ok) throw new Error("Failed to rename column");
    } catch {
      setColumns(snapshot);
      toast.error("Failed to rename column.");
    }
  };

  const handleDeleteColumn = async (columnId: string) => {
    const col = columns.find((c) => c.id === columnId);
    if (!col) return;
    const colCards = cards.filter((c) => c.columnId === columnId);
    if (colCards.length > 0) {
      toast.error(`Cannot delete column "${col.name}" — it has ${colCards.length} card(s). Move them first.`);
      return;
    }

    const snapshot = [...columns];
    setColumns((prev) => prev.filter((c) => c.id !== columnId));

    try {
      const res = await fetch(`/api/kanban/cards`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ columnId }),
      });
      if (!res.ok) throw new Error("Failed to delete column");
      toast.success(`Column "${col.name}" deleted`);
    } catch {
      setColumns(snapshot);
      toast.error("Failed to delete column.");
    }
  };

  const activeCard = activeId ? cards.find((c) => c.id === activeId) : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <ChartCard title="Card Distribution" subtitle="Cards per column">
            <CardDistributionChart columns={columns} cards={cards} />
          </ChartCard>
        </div>
        <div>
          <ChartCard title="Board Stats" subtitle={`Total: ${cards.length} cards`}>
            <div className="space-y-2">
              {columns.map((col) => {
                const count = getColumnCards(col.id).length;
                return (
                  <div key={col.id} className="flex items-center justify-between text-sm">
                    <span className="text-text-secondary">{col.name}</span>
                    <span className="font-mono tabular-nums text-text-primary">{count}</span>
                  </div>
                );
              })}
            </div>
          </ChartCard>
        </div>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <div className="flex gap-4 overflow-x-auto pb-4 min-h-[500px]">
          {columns.map((column) => (
            <SortableContext
              key={column.id}
              items={getColumnCards(column.id).map((c) => c.id)}
              strategy={verticalListSortingStrategy}
            >
              <KanbanColumn
                column={column}
                cards={getColumnCards(column.id)}
                onCardDoubleClick={setSelectedCard}
                onCardAdd={handleCardAdd}
                onDeleteCard={handleDeleteCard}
                onRenameColumn={handleRenameColumn}
                onDeleteColumn={handleDeleteColumn}
              />
            </SortableContext>
          ))}
        </div>

        <DragOverlay>
          {activeCard ? (
            <div className="rotate-3 shadow-2xl">
              <KanbanCard card={activeCard} onDoubleClick={() => {}} isDragging />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {selectedCard && (
        <KanbanCardModal
          card={selectedCard}
          onClose={() => setSelectedCard(null)}
        />
      )}

      <DeleteDialog
        open={deleteCardId !== null}
        onClose={() => { setDeleteCardId(null); setDeletingCardTitle(""); }}
        onConfirm={confirmDeleteCard}
        title="Delete Card"
        description="This action cannot be undone. The card will be permanently removed."
        itemName={deletingCardTitle}
      />
    </div>
  );
}
