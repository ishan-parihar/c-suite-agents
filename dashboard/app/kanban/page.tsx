import { getKanbanBoards, getKanbanColumns, getKanbanCards } from "@/lib/server/kanban";
import { KanbanBoard } from "./_components/kanban-board";
import { Kanban as KanbanIcon } from "lucide-react";

export default async function KanbanPage() {
  const boards = await getKanbanBoards();

  const boardId = boards[0]?.id;
  if (!boardId) {
    return (
      <div>
        <div className="mb-8">
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-text-primary">
            Kanban Board
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Task management with drag-and-drop
          </p>
        </div>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="mb-4 rounded-full bg-hover p-4 text-text-muted">
            <KanbanIcon className="h-8 w-8" />
          </div>
          <h3 className="mb-1 text-lg font-medium text-text-primary">No boards found</h3>
          <p className="text-sm text-text-secondary">
            Create a board from an agent to get started.
          </p>
        </div>
      </div>
    );
  }

  const [columns, cards] = await Promise.all([
    getKanbanColumns(boardId),
    getKanbanCards(boardId),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-mono text-2xl font-semibold tracking-tight text-text-primary">
            Kanban Board
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Drag cards between columns to update their status
          </p>
        </div>
        {boards.length > 1 && (
          <select
            className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-text-primary outline-none focus:border-border-strong"
            defaultValue={boardId}
            aria-label="Select board"
          >
            {boards.map((board) => (
              <option key={board.id} value={board.id}>
                {board.name}
              </option>
            ))}
          </select>
        )}
      </div>

      <KanbanBoard columns={columns} cards={cards} />
    </div>
  );
}
