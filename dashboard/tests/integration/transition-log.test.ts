/// <reference types="vitest/globals" />

import { describe, it, expect } from 'vitest';
import { db } from '@/lib/db';
import { eq, asc } from 'drizzle-orm';
import { tasks } from '@/drizzle/schema/lifeos/tasks';
import { transitionLog } from '@/drizzle/schema/operations/transition-log';
import {
  performTransition,
  recordTransition,
  enforceTransition,
  InvalidTransitionError,
  TerminalStateError,
} from '@/lib/state-transition';
import { TaskState } from '@/lib/task-state-machine';

describe('Transition Log Pipeline (Phase 5.4)', () => {
  const dataSourceId = crypto.randomUUID();

  async function createTask(status: string = 'draft') {
    const id = crypto.randomUUID();
    const rows = await db
      .insert(tasks)
      .values({
        id,
        name: `Transition Task ${id.slice(0, 8)}`,
        status,
        dataSourceId,
      })
      .returning() as typeof tasks.$inferSelect[];
    return rows[0];
  }

  async function getTransitionsForTask(taskId: string) {
    return await db
      .select()
      .from(transitionLog)
      .where(eq(transitionLog.taskId, taskId))
      .orderBy(asc(transitionLog.occurredAt)) as typeof transitionLog.$inferSelect[];
  }

  describe('recordTransition', () => {
    it('inserts row into transition_log table', async () => {
      const task = await createTask('active');

      await db.transaction(async (tx) => {
        await recordTransition(tx, task.id, 'active', 'in_progress', 'test');
      });

      const transitions = await getTransitionsForTask(task.id);
      expect(transitions.length).toBe(1);
      expect(transitions[0].taskId).toBe(task.id);
      expect(transitions[0].fromState).toBe('active');
      expect(transitions[0].toState).toBe('in_progress');
      expect(transitions[0].reason).toBe('test');
    });

    it('records correct from_state, to_state, reason, agent_id', async () => {
      const task = await createTask('draft');

      await db.transaction(async (tx) => {
        await recordTransition(tx, task.id, 'draft', 'active', 'user_action', 'coo-productivity');
      });

      const transitions = await getTransitionsForTask(task.id);
      expect(transitions[0].fromState).toBe('draft');
      expect(transitions[0].toState).toBe('active');
      expect(transitions[0].reason).toBe('user_action');
      expect(transitions[0].agentId).toBe('coo-productivity');
    });

    it('sets occurred_at timestamp', async () => {
      const task = await createTask('active');
      const before = new Date();

      await db.transaction(async (tx) => {
        await recordTransition(tx, task.id, 'active', 'review', 'automated');
      });

      const transitions = await getTransitionsForTask(task.id);
      const occurredAt = transitions[0].occurredAt;
      expect(occurredAt.getTime()).toBeGreaterThanOrEqual(before.getTime() - 1000);
      expect(occurredAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });

    it('allows null agent_id', async () => {
      const task = await createTask('active');

      await db.transaction(async (tx) => {
        await recordTransition(tx, task.id, 'active', 'review', 'system', undefined);
      });

      const transitions = await getTransitionsForTask(task.id);
      expect(transitions[0].agentId).toBeNull();
    });
  });

  describe('performTransition', () => {
    it('updates the task status in tasks table', async () => {
      const task = await createTask('draft');

      const result = await performTransition(task.id, TaskState.Active);
      expect(result.success).toBe(true);

      const rows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, task.id)) as typeof tasks.$inferSelect[];
      expect(rows[0].status).toBe('active');
    });

    it('creates transition_log entry within same transaction', async () => {
      const task = await createTask('draft');

      await performTransition(task.id, TaskState.Active);

      const transitions = await getTransitionsForTask(task.id);
      expect(transitions.length).toBe(1);
      expect(transitions[0].fromState).toBe('draft');
      expect(transitions[0].toState).toBe('active');
    });

    it('rejects invalid state transitions', async () => {
      const task = await createTask('done');

      const result = await performTransition(task.id, TaskState.Active);
      expect(result.success).toBe(false);
      expect(result.error).toContain('terminal state');
    });

    it('rejects unknown target state', async () => {
      const task = await createTask('draft');

      const result = await performTransition(task.id, 'nonexistent_state');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown target state');
    });

    it('returns error for non-existent task', async () => {
      const result = await performTransition(crypto.randomUUID(), TaskState.Active);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Task not found');
    });

    it('both succeed or both fail (atomic)', async () => {
      const task = await createTask('draft');

      const result = await performTransition(task.id, TaskState.Active);
      expect(result.success).toBe(true);

      const transitions = await getTransitionsForTask(task.id);
      expect(transitions.length).toBe(1);

      const taskRows = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, task.id)) as typeof tasks.$inferSelect[];
      expect(taskRows[0].status).toBe('active');
    });
  });

  describe('enforceTransition', () => {
    it('throws TerminalStateError for terminal states', () => {
      expect(() =>
        enforceTransition('task-1', 'done' as TaskState, 'active' as TaskState),
      ).toThrow(TerminalStateError);
    });

    it('throws InvalidTransitionError for illegal transitions', () => {
      expect(() =>
        enforceTransition('task-1', 'draft' as TaskState, 'in_progress' as TaskState),
      ).toThrow(InvalidTransitionError);
    });

    it('allows valid transitions', () => {
      expect(() =>
        enforceTransition('task-1', 'draft' as TaskState, 'active' as TaskState),
      ).not.toThrow();
    });

    it('allows blocked to resume to active', () => {
      expect(() =>
        enforceTransition('task-1', 'blocked' as TaskState, 'active' as TaskState),
      ).not.toThrow();
    });
  });
});
