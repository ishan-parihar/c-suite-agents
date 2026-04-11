/// <reference types="vitest/globals" />

import { describe, it, expect, vi } from 'vitest';
import { db } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { tasks } from '@/drizzle/schema/lifeos/tasks';
import {
  scanStalledTasks,
  retryTask,
  escalateTask,
  blockTask,
  rollbackTask,
  defaultSchedulerState,
} from '@/lib/scheduler';

// Mock external dependencies before importing scheduler internals
vi.mock('../../src/transport/message-bus', () => ({
  getMessageBus: () => ({
    publish: vi.fn().mockReturnValue(true),
    isConnected: vi.fn().mockReturnValue(true),
  }),
}));

vi.mock('../../src/integrations/telegram', () => ({
  getTelegramBot: () => ({
    telegram: { sendMessage: vi.fn().mockResolvedValue(undefined) },
  }),
}));

// Re-import parseSchedulerMetadata (it's not exported, we need to test through scanStalledTasks)
// Since parseSchedulerMetadata is not exported, we test through the public API

describe('Scheduler Recovery Pipeline (Phase 5.1)', () => {
  const dataSourceId = crypto.randomUUID();

  async function createStalledTask(overrides: Record<string, unknown> = {}) {
    const id = crypto.randomUUID();
    const monitor = JSON.stringify({
      ...defaultSchedulerState(),
      ...overrides,
      lastProgressAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
    });
    const staleDate = new Date(Date.now() - 20 * 60 * 1000);
    const rows = await db
      .insert(tasks)
      .values({
        id,
        name: `Stalled Task ${id.slice(0, 8)}`,
        status: 'active',
        dataSourceId,
        monitor,
        updatedAt: staleDate,
      })
      .returning() as typeof tasks.$inferSelect[];
    return rows[0];
  }

  async function getTask(id: string) {
    const rows = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, id)) as typeof tasks.$inferSelect[];
    return rows[0];
  }

  describe('scanStalledTasks', () => {
    it('returns empty result when no stalled tasks exist', async () => {
      const result = await scanStalledTasks({ stallThresholdMs: 600_000 });
      expect(result.scanned).toBe(0);
      expect(result.retried).toBe(0);
    });

    it('skips tasks in terminal states', async () => {
      await db.insert(tasks).values({
        id: crypto.randomUUID(),
        name: 'Done Task',
        status: 'done',
        dataSourceId,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      });
      await db.insert(tasks).values({
        id: crypto.randomUUID(),
        name: 'Cancelled Task',
        status: 'cancelled',
        dataSourceId,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      });
      await db.insert(tasks).values({
        id: crypto.randomUUID(),
        name: 'Blocked Task',
        status: 'blocked',
        dataSourceId,
        updatedAt: new Date(Date.now() - 20 * 60 * 1000),
      });

      const result = await scanStalledTasks({ stallThresholdMs: 600_000 });
      expect(result.scanned).toBe(0);
    });

    it('skips recently updated tasks', async () => {
      await db.insert(tasks).values({
        id: crypto.randomUUID(),
        name: 'Recent Task',
        status: 'active',
        dataSourceId,
        updatedAt: new Date(),
      });

      const result = await scanStalledTasks({ stallThresholdMs: 600_000 });
      expect(result.scanned).toBe(0);
    });

    it('retries tasks with retryCount < maxRetry', async () => {
      const task = await createStalledTask({ retryCount: 0, maxRetry: 2 });

      const result = await scanStalledTasks({ stallThresholdMs: 600_000 });
      expect(result.scanned).toBe(1);
      expect(result.retried).toBe(1);

      const updated = await getTask(task.id);
      const monitor = JSON.parse(updated.monitor || '{}');
      expect(monitor.retryCount).toBe(1);
    });

    it('escalates tasks when retry limit reached', async () => {
      const task = await createStalledTask({ retryCount: 2, maxRetry: 2, escalationLevel: 0 });

      const result = await scanStalledTasks({ stallThresholdMs: 600_000 });
      expect(result.escalated).toBe(1);

      const updated = await getTask(task.id);
      const monitor = JSON.parse(updated.monitor || '{}');
      expect(monitor.escalationLevel).toBe(1);
    });

    it('blocks tasks when all recovery exhausted', async () => {
      const task = await createStalledTask({
        retryCount: 2,
        maxRetry: 2,
        escalationLevel: 3,
        maxEscalationLevel: 3,
        autoRollback: false,
      });

      const result = await scanStalledTasks({ stallThresholdMs: 600_000 });
      expect(result.blocked).toBe(1);

      const updated = await getTask(task.id);
      expect(updated.status).toBe('blocked');
    });

    it('rolls back tasks when snapshot available', async () => {
      const task = await createStalledTask({
        retryCount: 2,
        maxRetry: 2,
        escalationLevel: 3,
        maxEscalationLevel: 3,
        autoRollback: true,
        snapshot: { state: 'active', savedAt: new Date().toISOString() },
      });

      const result = await scanStalledTasks({ stallThresholdMs: 600_000 });
      expect(result.rolledback).toBe(1);

      const updated = await getTask(task.id);
      expect(updated.status).toBe('active');
      const monitor = JSON.parse(updated.monitor || '{}');
      expect(monitor.retryCount).toBe(0);
      expect(monitor.escalationLevel).toBe(0);
    });

    it('does nothing when scheduler is disabled', async () => {
      await createStalledTask({ retryCount: 0 });

      const result = await scanStalledTasks({ enabled: false });
      expect(result.scanned).toBe(0);
      expect(result.retried).toBe(0);
    });
  });

  describe('retryTask (Stage 1)', () => {
    it('increments retryCount and clears stallSince', async () => {
      const task = await createStalledTask({ retryCount: 0 });

      await retryTask(task);

      const updated = await getTask(task.id);
      const monitor = JSON.parse(updated.monitor || '{}');
      expect(monitor.retryCount).toBe(1);
      expect(monitor.stallSince).toBeNull();
      expect(monitor.lastProgressAt).toBeDefined();
    });

    it('updates updatedAt timestamp', async () => {
      const task = await createStalledTask({ retryCount: 0 });
      const beforeTime = task.updatedAt.getTime();

      await retryTask(task);

      const updated = await getTask(task.id);
      expect(updated.updatedAt.getTime()).toBeGreaterThan(beforeTime);
    });
  });

  describe('escalateTask (Stage 2)', () => {
    it('increments escalationLevel and clears stallSince', async () => {
      const task = await createStalledTask({ escalationLevel: 0 });

      await escalateTask(task);

      const updated = await getTask(task.id);
      const monitor = JSON.parse(updated.monitor || '{}');
      expect(monitor.escalationLevel).toBe(1);
      expect(monitor.stallSince).toBeNull();
    });
  });

  describe('blockTask (Stage 4)', () => {
    it('sets status to blocked and stores stallSince', async () => {
      const task = await createStalledTask();

      await blockTask(task, 'All recovery exhausted');

      const updated = await getTask(task.id);
      expect(updated.status).toBe('blocked');
      const monitor = JSON.parse(updated.monitor || '{}');
      expect(monitor.stallSince).toBeDefined();
    });
  });

  describe('rollbackTask (Stage 3)', () => {
    it('restores target state and resets counters', async () => {
      const task = await createStalledTask({
        retryCount: 2,
        escalationLevel: 1,
      });

      await rollbackTask(task, 'draft');

      const updated = await getTask(task.id);
      expect(updated.status).toBe('draft');
      const monitor = JSON.parse(updated.monitor || '{}');
      expect(monitor.retryCount).toBe(0);
      expect(monitor.escalationLevel).toBe(0);
    });

    it('throws on empty targetState', async () => {
      const task = await createStalledTask();
      await expect(rollbackTask(task, '')).rejects.toThrow('targetState must be a non-empty string');
    });
  });
});
