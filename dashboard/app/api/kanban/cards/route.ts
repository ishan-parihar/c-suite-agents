import { z } from 'zod';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { sql } from 'drizzle-orm';
import { outboxEvents } from '@/drizzle/schema';
import { PermissionError } from '@/lib/agent-permissions';
import {
  extractAgentHeaders,
  validateAgentAction,
  sanitizePayload,
  validateBody,
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

const CreateCardSchema = z.object({
  boardId: z.string().uuid(),
  columnId: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().optional(),
  priority: z.string().optional(),
  due: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
});

const MoveCardSchema = z.object({
  cardId: z.string().uuid(),
  columnId: z.string().uuid(),
});

async function logCardActivity(cardId: string, action: string, payload: Record<string, unknown>) {
  await db.execute(sql`
    INSERT INTO kanban_card_activity (card_id, ts, action, payload)
    VALUES (${cardId}, NOW(), ${action}, ${JSON.stringify(payload)})
  `);
}

export async function PATCH(request: NextRequest) {
  const headers = extractAgentHeaders(request);

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return errorResponse('Invalid JSON', 400); }

  const sanitized = sanitizePayload(body);
  if (!sanitized.ok) return errorResponse(sanitized.error, 422);

  const validation = validateBody(sanitized.data, MoveCardSchema);
  if (!validation.ok) return errorResponse(validation.errors, 422);

  try {
    validateAgentAction(headers, 'write', 'kanban');

    const cardRow = await db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        UPDATE kanban_cards
        SET column_id = ${validation.data.columnId}, last_update = NOW()
        WHERE id = ${validation.data.cardId}
        RETURNING id, board_id, column_id, title, description, priority,
                  due, tags, assignee_agent_id, project_id, last_update, created_at
      `);

      if (result.rows.length === 0) {
        return null;
      }

      await tx.insert(outboxEvents).values({
        eventType: 'kanban.card_moved',
        entityId: validation.data.cardId as string,
        entityType: 'kanban',
        payload: { columnId: validation.data.columnId, agentId: headers.agentId, userId: headers.userId },
        published: false,
        attempts: 0,
      });

      return result.rows[0];
    });

    if (!cardRow) {
      return errorResponse('Card not found', 404);
    }

    const card = mapCardRow(cardRow);

    await logCardActivity(validation.data.cardId, 'column_changed', { columnId: validation.data.columnId });

    return successResponse({ card });
  } catch (error: unknown) {
    if (error instanceof PermissionError) {
      return errorResponse('Forbidden', 403);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('PATCH /api/kanban/cards error:', message);
    return errorResponse('Failed to update card', 500);
  }
}

export async function POST(request: NextRequest) {
  const headers = extractAgentHeaders(request);

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return errorResponse('Invalid JSON', 400); }

  const sanitized = sanitizePayload(body);
  if (!sanitized.ok) return errorResponse(sanitized.error, 422);

  const validation = validateBody(sanitized.data, CreateCardSchema);
  if (!validation.ok) return errorResponse(validation.errors, 422);

  try {
    validateAgentAction(headers, 'write', 'kanban');

    const cardRow = await db.transaction(async (tx) => {
      const result = await tx.execute(sql`
        INSERT INTO kanban_cards (
          board_id, column_id, title, description, priority, due, tags, created_at
        )
        VALUES (
          ${validation.data.boardId}, ${validation.data.columnId}, ${validation.data.title},
          ${validation.data.description ?? null}, ${validation.data.priority ?? null},
          ${validation.data.due ? new Date(validation.data.due) : null},
          ${validation.data.tags ? JSON.stringify(validation.data.tags) : null},
          NOW()
        )
        RETURNING id, board_id, column_id, title, description, priority,
                  due, tags, assignee_agent_id, project_id, last_update, created_at
      `);

      if (result.rows.length === 0) {
        return null;
      }

      await tx.insert(outboxEvents).values({
        eventType: 'kanban.card_created',
        entityId: result.rows[0].id as string,
        entityType: 'kanban',
        payload: { title: validation.data.title, agentId: headers.agentId, userId: headers.userId },
        published: false,
        attempts: 0,
      });

      return result.rows[0];
    });

    if (!cardRow) {
      return errorResponse('Failed to create card', 500);
    }

    const card = mapCardRow(cardRow);

    await logCardActivity(card.id, 'card_created', { title: validation.data.title });

    return successResponse({ card }, 201);
  } catch (error: unknown) {
    if (error instanceof PermissionError) {
      return errorResponse('Forbidden', 403);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('POST /api/kanban/cards error:', message);
    return errorResponse('Failed to create card', 500);
  }
}
