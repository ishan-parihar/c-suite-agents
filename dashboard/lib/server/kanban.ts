import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

export interface KanbanBoard {
  id: string;
  agentId: string;
  name: string;
  createdAt: Date | null;
}

export interface KanbanColumn {
  id: string;
  boardId: string;
  name: string;
  ord: number;
  createdAt: Date | null;
}

export interface KanbanCard {
  id: string;
  boardId: string;
  columnId: string;
  title: string;
  description: string | null;
  priority: string | null;
  due: Date | null;
  tags: string[] | null;
  assigneeAgentId: string | null;
  projectId: string | null;
  lastUpdate: Date | null;
  createdAt: Date | null;
}

export interface KanbanCardActivity {
  id: string;
  cardId: string;
  ts: Date;
  action: string;
  payload: Record<string, unknown> | null;
}

export async function getKanbanBoards(): Promise<KanbanBoard[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, agent_id, name, created_at
      FROM kanban_boards
      ORDER BY created_at DESC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      agentId: r.agent_id,
      name: r.name,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

export async function getKanbanColumns(boardId: string): Promise<KanbanColumn[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, board_id, name, ord, created_at
      FROM kanban_columns
      WHERE board_id = ${boardId}
      ORDER BY ord ASC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      boardId: r.board_id,
      name: r.name,
      ord: r.ord,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

export async function getKanbanCards(boardId: string): Promise<KanbanCard[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, board_id, column_id, title, description, priority,
             due, tags, assignee_agent_id, project_id, last_update, created_at
      FROM kanban_cards
      WHERE board_id = ${boardId}
      ORDER BY created_at DESC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      boardId: r.board_id,
      columnId: r.column_id,
      title: r.title,
      description: r.description,
      priority: r.priority,
      due: r.due,
      tags: r.tags,
      assigneeAgentId: r.assignee_agent_id,
      projectId: r.project_id,
      lastUpdate: r.last_update,
      createdAt: r.created_at,
    }));
  } catch {
    return [];
  }
}

export async function getKanbanCardActivity(cardId: string): Promise<KanbanCardActivity[]> {
  try {
    const result = await db.execute(sql`
      SELECT id, card_id, ts, action, payload
      FROM kanban_card_activity
      WHERE card_id = ${cardId}
      ORDER BY ts DESC
    `);
    return result.rows.map((r: any) => ({
      id: r.id,
      cardId: r.card_id,
      ts: r.ts,
      action: r.action,
      payload: r.payload,
    }));
  } catch {
    return [];
  }
}
