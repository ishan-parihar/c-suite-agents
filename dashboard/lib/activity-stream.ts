/**
 * Activity Stream Fusion — Unified Entity Timeline
 *
 * Activity fusion merges multiple event sources into a single, chronologically
 * sorted timeline per entity. Instead of siloed panels for each data source,
 * users see one coherent story: "Goal created → Task assigned → Card stalled,
 * retry triggered → Goal completed."
 *
 * Current sources:
 *   - kanban_card_activity (Drizzle)
 *   - State transitions (implicit via entity updatedAt/status changes)
 *
 * Future sources (planned extension points):
 *   - OpenClaw session JSONL files (agent thinking, tool calls)
 *   - Scheduler events (retry, escalate, rollback)
 *   - Outbox events (published domain events)
 *   - User actions (CRUD via server actions)
 *
 * @see docs/EDICT-PATTERNS-TRANSFER.md §3 — Activity Stream Fusion
 */

import { eq, inArray, desc, asc } from 'drizzle-orm';
import { db } from '@/lib/db';
import {
  kanbanCardActivity,
  kanbanCards,
} from '@/drizzle/schema';
import { type EntityType } from '@/lib/agent-permissions';
export { type EntityType };

// ── Types ──────────────────────────────────────────────────────────────────

export type ActivityKind =
  | 'state_change'
  | 'crud_event'
  | 'progress'
  | 'scheduler_action'
  | 'user_action';

export interface ActivityEntry {
  at: string;
  kind: ActivityKind;
  entityId: string;
  entityType: EntityType;
  agentId: string | undefined;
  userId: string | undefined;
  data: Record<string, unknown>;
}

// ── Activity source: Kanban Card Activity ──────────────────────────────────

async function getKanbanCardActivityForEntity(
  entityId: string,
  entityType: EntityType,
): Promise<ActivityEntry[]> {
  // Only kanban cards have direct activity entries
  if (entityType !== 'kanban') return [];

  const rows = await db
    .select({
      ts: kanbanCardActivity.ts,
      action: kanbanCardActivity.action,
      payload: kanbanCardActivity.payload,
      cardId: kanbanCardActivity.cardId,
    })
    .from(kanbanCardActivity)
    .where(eq(kanbanCardActivity.cardId, entityId))
    .orderBy(desc(kanbanCardActivity.ts));

  return rows.map((row) => ({
    at: row.ts.toISOString(),
    kind: classifyKanbanAction(row.action),
    entityId,
    entityType,
    agentId: extractAgentId(row.payload),
    userId: extractUserId(row.payload),
    data: { action: row.action, ...(row.payload as Record<string, unknown> || {}) },
  }));
}

// ── Activity source: Implicit State Transitions ────────────────────────────

/**
 * Infer state-change events from entity updatedAt timestamps.
 * This is a fallback when explicit activity logs don't exist.
 * Future: replace with explicit transition tables.
 */
async function getImplicitStateActivity(
  entityId: string,
  entityType: EntityType,
): Promise<ActivityEntry[]> {
  // Stub — returns empty. Real implementation would query entity tables
  // and compare current vs previous status snapshots.
  // For kanban cards, the kanbanCardActivity table already captures transitions.
  return [];
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch all activity for a specific entity, merging every available source
 * and returning a unified, descending-sorted timeline.
 *
 * @param entityId — UUID of the entity
 * @param entityType — Discriminated entity type
 * @returns ActivityEntry[] sorted newest-first
 */
export async function getEntityActivity(
  entityId: string,
  entityType: EntityType,
): Promise<ActivityEntry[]> {
  const sources: Promise<ActivityEntry[]>[] = [
    getKanbanCardActivityForEntity(entityId, entityType),
    getImplicitStateActivity(entityId, entityType),
    // Future: getActivityFromOpenClaw(entityId, entityType),
    // Future: getSchedulerEvents(entityId, entityType),
    // Future: getOutboxEvents(entityId, entityType),
  ];

  const results = await Promise.all(sources);
  const merged = results.flat();

  merged.sort((a, b) => b.at.localeCompare(a.at));

  return merged;
}

/**
 * Fetch all activity across every card on a kanban board.
 * Useful for board-level dashboards and audit trails.
 *
 * @param boardId — UUID of the kanban board
 * @returns ActivityEntry[] sorted newest-first
 */
export async function getActivityForBoard(
  boardId: string,
): Promise<ActivityEntry[]> {
  // Step 1: Get all card IDs on this board
  const cards = await db
    .select({ id: kanbanCards.id })
    .from(kanbanCards)
    .where(eq(kanbanCards.boardId, boardId));

  if (cards.length === 0) return [];

  const cardIds = cards.map((c) => c.id);

  // Step 2: Batch-fetch activity for all cards
  const rows = await db
    .select({
      ts: kanbanCardActivity.ts,
      action: kanbanCardActivity.action,
      payload: kanbanCardActivity.payload,
      cardId: kanbanCardActivity.cardId,
    })
    .from(kanbanCardActivity)
    .where(inArray(kanbanCardActivity.cardId, cardIds))
    .orderBy(desc(kanbanCardActivity.ts));

  return rows.map((row) => ({
    at: row.ts.toISOString(),
    kind: classifyKanbanAction(row.action),
    entityId: row.cardId,
    entityType: 'kanban' as EntityType,
    agentId: extractAgentId(row.payload),
    userId: extractUserId(row.payload),
    data: { action: row.action, ...(row.payload as Record<string, unknown> || {}) },
  }));
}

// ── Formatting ─────────────────────────────────────────────────────────────

const KANBAN_ACTION_LABELS: Record<string, string> = {
  'card_created': 'Card created',
  'card_updated': 'Card updated',
  'card_moved': 'Card moved',
  'card_deleted': 'Card deleted',
  'card_archived': 'Card archived',
  'column_changed': 'Column changed',
  'priority_changed': 'Priority changed',
  'assignee_changed': 'Assignee changed',
  'title_changed': 'Title changed',
  'description_changed': 'Description updated',
  'due_date_changed': 'Due date changed',
  'tag_added': 'Tag added',
  'tag_removed': 'Tag removed',
  'comment_added': 'Comment added',
  'status_changed': 'Status changed',
  'retry_triggered': 'Stalled — retry triggered',
  'escalated': 'Escalated',
  'rollback': 'Rolled back',
  'blocked': 'Card blocked',
  'unblocked': 'Card unblocked',
};

/**
 * Format an ActivityEntry into a human-readable string.
 *
 * Examples:
 *   "Task moved to Review by agent CIO-Intelligence"
 *   "Goal created by user Ishan"
 *   "Card stalled — retry triggered by agent COO-Productivity"
 *
 * @param entry — ActivityEntry to format
 * @returns Human-readable description
 */
export function formatActivityEntry(entry: ActivityEntry): string {
  const { kind, data, agentId, userId } = entry;
  const action = (data.action as string) || '';

  // Build the action label
  let label = KANBAN_ACTION_LABELS[action];

  // Fallback: derive label from action string
  if (!label) {
    label = action
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  // Enrich with context from payload
  label = enrichActionLabel(label, data);

  // Append attribution
  const actor = agentId
    ? ` by agent ${agentId}`
    : userId
      ? ` by user ${userId}`
      : '';

  return `${label}${actor}`;
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Classify a kanban action string into an ActivityKind.
 */
function classifyKanbanAction(action: string): ActivityKind {
  const schedulerActions = ['retry_triggered', 'escalated', 'rollback', 'blocked'];
  if (schedulerActions.includes(action)) return 'scheduler_action';

  const stateActions = ['card_moved', 'column_changed', 'status_changed', 'card_archived'];
  if (stateActions.includes(action)) return 'state_change';

  return 'user_action';
}

/**
 * Extract agent ID from a JSONB payload.
 */
function extractAgentId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  return (
    (p.agentId as string) ||
    (p.agent_id as string) ||
    (p.assigneeAgentId as string) ||
    (p.assignee_agent_id as string) ||
    undefined
  );
}

/**
 * Extract user ID from a JSONB payload.
 */
function extractUserId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const p = payload as Record<string, unknown>;
  return (
    (p.userId as string) ||
    (p.user_id as string) ||
    (p.actor as string) ||
    (p.createdBy as string) ||
    (p.created_by as string) ||
    undefined
  );
}

/**
 * Enrich an action label with contextual details from payload.
 */
function enrichActionLabel(label: string, data: Record<string, unknown>): string {
  // For card moves, include the target column name if available
  if (label === 'Card moved' || label === 'Column changed') {
    const toColumn = data.toColumn as string | undefined;
    if (toColumn) {
      return `Card moved to ${toColumn}`;
    }
    const columnName = data.columnName as string | undefined;
    if (columnName) {
      return `Card moved to ${columnName}`;
    }
  }

  // For priority changes, include the new priority
  if (label === 'Priority changed') {
    const newPriority = data.newPriority as string | undefined
      || data.priority as string | undefined;
    if (newPriority) {
      return `Priority changed to ${newPriority}`;
    }
  }

  // For assignee changes, include the new assignee
  if (label === 'Assignee changed') {
    const newAssignee = data.newAssignee as string | undefined
      || data.assignee as string | undefined;
    if (newAssignee) {
      return `Assignee changed to ${newAssignee}`;
    }
  }

  // For stalled/retry, make it more descriptive
  if (label.includes('retry') || label.includes('Stalled')) {
    const retryCount = data.retryCount as number | undefined;
    if (retryCount !== undefined) {
      return `Card stalled — retry triggered (attempt ${retryCount})`;
    }
  }

  return label;
}
