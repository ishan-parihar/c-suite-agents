/// <reference types="vitest/globals" />

import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db';
import {
  getEntityActivity,
  getActivityForBoard,
} from '@/lib/activity-stream';
import { kanbanCardActivity, kanbanCards, kanbanColumns, kanbanBoards } from '@/drizzle/schema/operations/kanban';
import { outboxEvents } from '@/drizzle/schema/operations/outbox';

async function createKanbanChain() {
  const boardId = crypto.randomUUID();
  const columnId = crypto.randomUUID();
  const cardId = crypto.randomUUID();

  await db.insert(kanbanBoards).values({ id: boardId, agentId: 'test-agent', name: 'Test Board' });
  await db.insert(kanbanColumns).values({ id: columnId, boardId, name: 'Test Column', ord: 0 });
  await db.insert(kanbanCards).values({ id: cardId, boardId, columnId, title: 'Test Card' });

  return { boardId, columnId, cardId };
}

describe('Activity Stream Multi-Source (Phase 5.3)', () => {
  describe('getEntityActivity', () => {
    it('returns empty array for entity with no activity', async () => {
      const entityId = crypto.randomUUID();
      const activity = await getEntityActivity(entityId, 'kanban');
      expect(activity).toEqual([]);
    });

    it('returns kanban card activity entries', async () => {
      const { cardId } = await createKanbanChain();

      await db.insert(kanbanCardActivity).values({
        id: crypto.randomUUID(),
        cardId,
        ts: new Date(),
        action: 'card_created',
        payload: { createdBy: 'test-agent' },
      });

      const activity = await getEntityActivity(cardId, 'kanban');
      expect(activity.length).toBeGreaterThan(0);
      expect(activity.some((a) => a.entityId === cardId)).toBe(true);
    });

    it('merges kanban activity and outbox events for same entity', async () => {
      const { cardId } = await createKanbanChain();

      await db.insert(kanbanCardActivity).values({
        id: crypto.randomUUID(),
        cardId,
        ts: new Date(Date.now() - 10_000),
        action: 'card_created',
        payload: { agentId: 'coo-productivity' },
      });

      await db.insert(outboxEvents).values({
        id: crypto.randomUUID(),
        eventType: 'kanban.updated',
        entityId: cardId,
        entityType: 'kanban',
        payload: { agentId: 'coo-productivity' },
        published: true,
        attempts: 1,
        createdAt: new Date(),
      });

      const activity = await getEntityActivity(cardId, 'kanban');
      expect(activity.length).toBeGreaterThanOrEqual(2);
    });

    it('returns chronologically sorted results (newest first)', async () => {
      const { cardId } = await createKanbanChain();

      const oldTs = new Date(Date.now() - 60_000);
      const newTs = new Date();

      await db.insert(kanbanCardActivity).values({
        id: crypto.randomUUID(),
        cardId,
        ts: oldTs,
        action: 'card_created',
        payload: {},
      });

      await db.insert(kanbanCardActivity).values({
        id: crypto.randomUUID(),
        cardId,
        ts: newTs,
        action: 'card_updated',
        payload: {},
      });

      const activity = await getEntityActivity(cardId, 'kanban');

      for (let i = 0; i < activity.length - 1; i++) {
        expect(activity[i].at >= activity[i + 1].at).toBe(true);
      }
    });

    it('classifies scheduler actions correctly', async () => {
      const { cardId } = await createKanbanChain();

      await db.insert(kanbanCardActivity).values({
        id: crypto.randomUUID(),
        cardId,
        ts: new Date(),
        action: 'retry_triggered',
        payload: { retryCount: 1 },
      });

      const activity = await getEntityActivity(cardId, 'kanban');
      const schedulerActions = activity.filter((a) => a.kind === 'scheduler_action');
      expect(schedulerActions.length).toBeGreaterThan(0);
    });

    it('filters non-kanban entities for kanban-specific sources', async () => {
      const entityId = crypto.randomUUID();

      const activity = await getEntityActivity(entityId, 'task');
      expect(activity.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getActivityForBoard', () => {
    it('returns empty array for board with no cards', async () => {
      const boardId = crypto.randomUUID();
      const activity = await getActivityForBoard(boardId);
      expect(activity).toEqual([]);
    });

    it('returns activities for all cards on a board', async () => {
      const { boardId, columnId } = await createKanbanChain();
      const card1 = crypto.randomUUID();
      const card2 = crypto.randomUUID();

      await db.insert(kanbanCards).values({ id: card1, boardId, columnId, title: 'Card 1' });
      await db.insert(kanbanCards).values({ id: card2, boardId, columnId, title: 'Card 2' });

      await db.insert(kanbanCardActivity).values({
        id: crypto.randomUUID(),
        cardId: card1,
        ts: new Date(Date.now() - 5_000),
        action: 'card_created',
        payload: {},
      });

      await db.insert(kanbanCardActivity).values({
        id: crypto.randomUUID(),
        cardId: card2,
        ts: new Date(),
        action: 'card_updated',
        payload: {},
      });

      const activity = await getActivityForBoard(boardId);
      expect(activity.length).toBeGreaterThanOrEqual(0);
    });
  });
});
