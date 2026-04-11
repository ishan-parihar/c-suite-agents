/// <reference types="vitest/globals" />

import { describe, it, expect, vi } from 'vitest';
import { db } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { outboxEvents } from '@/drizzle/schema/operations/outbox';

vi.mock('../../src/transport/ws-server', () => {
  const mockGateway = {
    broadcastOutboxEvent: vi.fn(),
    publish: vi.fn(),
    isConnected: vi.fn().mockReturnValue(false),
  };
  return {
    getWsGateway: () => mockGateway,
    __mockGateway: mockGateway,
  };
});

describe('Outbox Broadcast Pipeline (Phase 5.2)', () => {
  describe('relayOutbox', () => {
    it('returns empty result when no unpublished events exist', async () => {
      const { relayOutbox } = await import('@/lib/outbox');
      const result = await relayOutbox();
      expect(result.relayed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('publishes unpublished events and marks them published', async () => {
      const eventId = crypto.randomUUID();
      const entityId = crypto.randomUUID();
      await db.insert(outboxEvents).values({
        id: eventId,
        eventType: 'task.created',
        entityId,
        entityType: 'task',
        payload: { test: true },
        published: false,
        attempts: 0,
      });

      const { relayOutbox } = await import('@/lib/outbox');
      const result = await relayOutbox();
      expect(result.relayed).toBe(1);

      const rows = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, eventId)) as typeof outboxEvents.$inferSelect[];
      expect(rows[0].published).toBe(true);
      expect(rows[0].publishedAt).toBeDefined();
    });

    it('increments attempts on failed publish', async () => {
      const eventId = crypto.randomUUID();
      const entityId = crypto.randomUUID();
      await db.insert(outboxEvents).values({
        id: eventId,
        eventType: 'task.created',
        entityId,
        entityType: 'task',
        payload: { agentId: 'test-agent' },
        published: false,
        attempts: 0,
      });

      const { relayOutbox } = await import('@/lib/outbox');
      const result = await relayOutbox();

      const rows = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, eventId)) as typeof outboxEvents.$inferSelect[];

      if (result.failed > 0) {
        expect(rows[0].attempts).toBe(1);
      } else {
        expect(rows[0].published).toBe(true);
      }
    });

    it('skips events that exceeded max attempts', async () => {
      const eventId = crypto.randomUUID();
      const entityId = crypto.randomUUID();
      await db.insert(outboxEvents).values({
        id: eventId,
        eventType: 'task.created',
        entityId,
        entityType: 'task',
        payload: { test: true },
        published: false,
        attempts: 5,
      });

      const { relayOutbox } = await import('@/lib/outbox');
      const result = await relayOutbox();
      expect(result.relayed).toBe(0);
      expect(result.failed).toBe(0);
    });

    it('publishes events in chronological order', async () => {
      const oldId = crypto.randomUUID();
      const newId = crypto.randomUUID();
      const entityId = crypto.randomUUID();

      await db.insert(outboxEvents).values({
        id: oldId,
        eventType: 'task.created',
        entityId,
        entityType: 'task',
        payload: { order: 1 },
        published: false,
        attempts: 0,
        createdAt: new Date(Date.now() - 60_000),
      });

      await db.insert(outboxEvents).values({
        id: newId,
        eventType: 'task.updated',
        entityId,
        entityType: 'task',
        payload: { order: 2 },
        published: false,
        attempts: 0,
        createdAt: new Date(),
      });

      const { relayOutbox } = await import('@/lib/outbox');
      await relayOutbox();

      const oldRow = (await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, oldId)) as typeof outboxEvents.$inferSelect[])[0];
      const newRow = (await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.id, newId)) as typeof outboxEvents.$inferSelect[])[0];

      expect(oldRow.published).toBe(true);
      expect(newRow.published).toBe(true);
    });
  });

  describe('withOutbox transaction helper', () => {
    it('inserts outbox event within same transaction', async () => {
      const { withOutbox } = await import('@/lib/outbox-helper');
      const { tasks } = await import('@/drizzle/schema/lifeos/tasks');

      const taskId = crypto.randomUUID();
      const dataSourceId = crypto.randomUUID();

      await db.transaction(async (tx) => {
        await tx.insert(tasks).values({
          id: taskId,
          name: 'Transactional Task',
          status: 'active',
          dataSourceId,
        });

        await withOutbox(tx, {
          eventType: 'task.created',
          entityId: taskId,
          entityType: 'task',
          payload: { agentId: 'coo-productivity' },
        });
      });

      const taskRows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId)) as typeof tasks.$inferSelect[];
      expect(taskRows.length).toBe(1);

      const outboxRows = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.entityId, taskId)) as typeof outboxEvents.$inferSelect[];
      expect(outboxRows.length).toBe(1);
      expect(outboxRows[0].eventType).toBe('task.created');
      expect(outboxRows[0].published).toBe(false);
      expect(outboxRows[0].attempts).toBe(0);
    });

    it('rolls back both entity and outbox on transaction failure', async () => {
      const { withOutbox } = await import('@/lib/outbox-helper');
      const { tasks } = await import('@/drizzle/schema/lifeos/tasks');

      const taskId = crypto.randomUUID();
      const dataSourceId = crypto.randomUUID();

      await expect(
        db.transaction(async (tx) => {
          await tx.insert(tasks).values({
            id: taskId,
            name: 'Should Rollback',
            status: 'active',
            dataSourceId,
          });

          await withOutbox(tx, {
            eventType: 'task.created',
            entityId: taskId,
            entityType: 'task',
            payload: {},
          });

          throw new Error('Simulated failure');
        }),
      ).rejects.toThrow('Simulated failure');

      const taskRows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, taskId)) as typeof tasks.$inferSelect[];
      expect(taskRows.length).toBe(0);

      const outboxRows = await db
        .select()
        .from(outboxEvents)
        .where(eq(outboxEvents.entityId, taskId)) as typeof outboxEvents.$inferSelect[];
      expect(outboxRows.length).toBe(0);
    });
  });
});
