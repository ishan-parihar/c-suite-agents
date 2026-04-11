import { NextRequest } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { outboxEvents } from '@/drizzle/schema';
import { PermissionError } from '@/lib/agent-permissions';
import {
  extractAgentHeaders,
  validateAgentAction,
  successResponse,
  errorResponse,
} from '@/lib/api/factory';

function mapCardRow(r: any) {
  return {
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
  };
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = extractAgentHeaders(request);

  const { id } = await params;
  if (!id) return errorResponse('Missing card ID', 400);

  try {
    validateAgentAction(headers, 'read', 'kanban');

    const result = await db.execute(sql`
      SELECT id, board_id, column_id, title, description, priority,
             due, tags, assignee_agent_id, project_id, last_update, created_at
      FROM kanban_cards
      WHERE id = ${id}
    `);

    if (result.rows.length === 0) {
      return errorResponse('Card not found', 404);
    }

    return successResponse(mapCardRow(result.rows[0]));
  } catch (error: unknown) {
    if (error instanceof PermissionError) {
      return errorResponse('Forbidden', 403);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('GET /api/kanban/cards/[id] error:', message);
    return errorResponse('Failed to fetch card', 500);
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const headers = extractAgentHeaders(request);

  const { id } = await params;
  if (!id) return errorResponse('Missing card ID', 400);

  try {
    validateAgentAction(headers, 'delete', 'kanban');

    const deleted = await db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        DELETE FROM kanban_cards
        WHERE id = ${id}
        RETURNING id, title
      `);

      if (result.rows.length === 0) {
        return null;
      }

      await tx.insert(outboxEvents).values({
        eventType: 'kanban.card_deleted',
        entityId: result.rows[0].id as string,
        entityType: 'kanban',
        payload: { title: result.rows[0].title, agentId: headers.agentId, userId: headers.userId },
        published: false,
        attempts: 0,
      });

      return result.rows[0];
    });

    if (!deleted) {
      return errorResponse('Card not found', 404);
    }

    return successResponse({ deleted: true, cardId: deleted.id });
  } catch (error: unknown) {
    if (error instanceof PermissionError) {
      return errorResponse('Forbidden', 403);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('DELETE /api/kanban/cards/[id] error:', message);
    return errorResponse('Failed to delete card', 500);
  }
}
