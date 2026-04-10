import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";

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

async function logCardActivity(cardId: string, action: string, payload: Record<string, unknown>) {
  await db.execute(sql`
    INSERT INTO kanban_card_activity (card_id, ts, action, payload)
    VALUES (${cardId}, NOW(), ${action}, ${JSON.stringify(payload)})
  `);
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { cardId, columnId } = body as { cardId: string; columnId: string };

    if (!cardId || !columnId) {
      return NextResponse.json(
        { error: "cardId and columnId are required" },
        { status: 400 }
      );
    }

    const result = await db.execute(sql`
      UPDATE kanban_cards
      SET column_id = ${columnId}, last_update = NOW()
      WHERE id = ${cardId}
      RETURNING id, board_id, column_id, title, description, priority,
                due, tags, assignee_agent_id, project_id, last_update, created_at
    `);

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Card not found" }, { status: 404 });
    }

    const card = mapCardRow(result.rows[0]);

    await logCardActivity(cardId, "column_changed", { columnId });

    return NextResponse.json({ card });
  } catch (error) {
    console.error("PATCH /api/kanban/cards error:", error);
    return NextResponse.json(
      { error: "Failed to update card" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { boardId, columnId, title, description, priority, due, tags } = body as {
      boardId: string;
      columnId: string;
      title: string;
      description?: string;
      priority?: string;
      due?: string;
      tags?: string[];
    };

    if (!boardId || !columnId || !title) {
      return NextResponse.json(
        { error: "boardId, columnId, and title are required" },
        { status: 400 }
      );
    }

    const result = await db.execute(sql`
      INSERT INTO kanban_cards (
        board_id, column_id, title, description, priority, due, tags, created_at
      )
      VALUES (
        ${boardId}, ${columnId}, ${title},
        ${description ?? null}, ${priority ?? null},
        ${due ? new Date(due) : null},
        ${tags ? JSON.stringify(tags) : null},
        NOW()
      )
      RETURNING id, board_id, column_id, title, description, priority,
                due, tags, assignee_agent_id, project_id, last_update, created_at
    `);

    if (result.rows.length === 0) {
      return NextResponse.json(
        { error: "Failed to create card" },
        { status: 500 }
      );
    }

    const card = mapCardRow(result.rows[0]);

    await logCardActivity(card.id, "card_created", { title });

    return NextResponse.json({ card }, { status: 201 });
  } catch (error) {
    console.error("POST /api/kanban/cards error:", error);
    return NextResponse.json(
      { error: "Failed to create card" },
      { status: 500 }
    );
  }
}
