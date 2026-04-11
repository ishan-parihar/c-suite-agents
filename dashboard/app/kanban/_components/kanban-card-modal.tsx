"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { X, Save, CalendarDays, Tag, User, FolderKanban, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { BlockNoteEditor } from "@/components/crud/blocknote-editor";
import { DeleteDialog } from "@/components/crud/delete-dialog";
import type { KanbanCard as KanbanCardType } from "@/lib/server/kanban";

interface KanbanCardModalProps {
  card: KanbanCardType;
  onClose: () => void;
}

export function KanbanCardModal({ card, onClose }: KanbanCardModalProps) {
  const [title, setTitle] = useState(card.title);
  const [description, setDescription] = useState(card.description ?? "");
  const [priority, setPriority] = useState(card.priority ?? "medium");
  const [isSaving, setIsSaving] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    document.addEventListener("keydown", handleEscape);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [handleEscape]);

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === overlayRef.current) onClose();
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await fetch(`/api/kanban/cards/${card.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description, priority }),
      });
      toast.success("Card saved");
      onClose();
    } catch {
      toast.error("Failed to save card");
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      const res = await fetch(`/api/kanban/cards/${card.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete");
      toast.success("Card deleted");
      onClose();
    } catch {
      toast.error("Failed to delete card");
    }
  };

  return (
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="fixed inset-0 z-[40] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-label={`Edit card: ${card.title}`}
    >
      <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-xl border border-border bg-elevated shadow-2xl">
        <div className="sticky top-0 z-10 flex items-center justify-between px-6 py-4 border-b border-border bg-elevated">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="text-lg font-medium bg-transparent text-text-primary outline-none w-full mr-4"
          />
          <div className="flex items-center gap-1">
            <button
              onClick={() => setShowDelete(true)}
              className="p-1.5 rounded-lg text-text-muted hover:text-critical hover:bg-hover transition-colors"
              aria-label="Delete card"
            >
              <Trash2 className="h-5 w-5" />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-text-muted hover:text-text-primary hover:bg-hover transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-4 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                <Tag className="h-3.5 w-3.5" />
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="w-full bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
              >
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                <CalendarDays className="h-3.5 w-3.5" />
                Due Date
              </label>
              <div className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-secondary">
                {card.due ? new Date(card.due).toLocaleDateString() : "Not set"}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-text-secondary">Description</label>
            <BlockNoteEditor
              initialContent={description}
              onChange={setDescription}
              minHeight="160px"
            />
          </div>

          {card.tags && card.tags.length > 0 && (
            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-xs text-text-secondary">
                <Tag className="h-3.5 w-3.5" />
                Tags
              </label>
              <div className="flex flex-wrap gap-1.5">
                {card.tags.map((tag: string, i: number) => (
                  <span
                    key={i}
                    className="text-xs px-2 py-1 rounded-full bg-hover text-text-secondary"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          )}

          {card.assigneeAgentId && (
            <div className="flex items-center gap-1.5 text-sm text-text-secondary">
              <User className="h-4 w-4" />
              <span>{card.assigneeAgentId}</span>
            </div>
          )}

          {card.projectId && (
            <div className="flex items-center gap-1.5 text-sm text-text-secondary">
              <FolderKanban className="h-4 w-4" />
              <span>{card.projectId}</span>
            </div>
          )}

          <div className="pt-2">
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-2 px-4 py-2 rounded-md bg-accent text-text-primary text-sm font-medium hover:bg-accent-hover transition-colors disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isSaving ? "Saving..." : "Save Changes"}
            </button>
          </div>
        </div>
      </div>

      <DeleteDialog
        open={showDelete}
        onClose={() => setShowDelete(false)}
        onConfirm={handleDelete}
        title="Delete Card"
        description="This action cannot be undone."
        itemName={card.title}
      />
    </div>
  );
}
