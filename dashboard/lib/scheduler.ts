import { and, notInArray, lt, eq, sql } from 'drizzle-orm';
import { db } from '@/lib/db';
import { tasks } from '@/drizzle/schema/lifeos/tasks';

/**
 * Edict-Inspired 4-Stage Stalled Task Recovery System
 *
 * When a task shows no progress for longer than the configured threshold,
 * the scheduler applies escalating recovery stages:
 *
 *   Stage 1: RETRY    — Re-dispatch to the same agent (up to maxRetry)
 *   Stage 2: ESCALATE — Notify higher-level coordinators (up to maxEscalationLevel)
 *   Stage 3: ROLLBACK — Restore to last known-good snapshot state (up to maxRollback)
 *   Stage 4: BLOCK    — Mark as blocked, requires human intervention
 *
 * This pipeline ensures most failures self-heal without manual involvement.
 * Only when all automated recovery is exhausted does the task require human attention.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SchedulerState {
  enabled: boolean;
  stallThresholdMs: number;
  maxRetry: number;
  retryCount: number;
  escalationLevel: number;
  maxEscalationLevel: number;
  autoRollback: boolean;
  maxRollback: number;
  lastProgressAt: string | null;
  stallSince: string | null;
  snapshot: { state: string; savedAt: string } | null;
}

export interface ScanResult {
  scanned: number;
  retried: number;
  escalated: number;
  rolledback: number;
  blocked: number;
}

const TERMINAL_STATES = ['done', 'cancelled', 'blocked'] as const;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Returns a fresh SchedulerState with sensible defaults.
 */
export function defaultSchedulerState(): SchedulerState {
  return {
    enabled: true,
    stallThresholdMs: 600_000,     // 10 minutes
    maxRetry: 2,
    retryCount: 0,
    escalationLevel: 0,
    maxEscalationLevel: 3,
    autoRollback: true,
    maxRollback: 3,
    lastProgressAt: new Date().toISOString(),
    stallSince: null,
    snapshot: null,
  };
}

// ---------------------------------------------------------------------------
// Recovery stubs (actual agent dispatch wired later)
// ---------------------------------------------------------------------------

/**
 * Helper: parse scheduler metadata from the task's monitor column (text/JSON).
 */
function parseSchedulerMetadata(monitorText: string | null): SchedulerState {
  const base = defaultSchedulerState();
  if (!monitorText) return base;
  try {
    const parsed = JSON.parse(monitorText);
    return { ...base, ...parsed };
  } catch {
    return base;
  }
}

/**
 * Helper: serialize scheduler metadata back into a JSON string for the monitor column.
 */
function serializeSchedulerMetadata(sched: SchedulerState): string {
  return JSON.stringify(sched);
}

/**
 * Stage 1: Retry — re-dispatch the task to the same agent.
 * Updates `updated_at` to NOW() and increments retryCount in embedded metadata.
 */
export async function retryTask(task: any): Promise<void> {
  try {
    const sched = parseSchedulerMetadata(task.monitor);
    sched.retryCount += 1;
    sched.stallSince = null;
    sched.lastProgressAt = new Date().toISOString();

    await db
      .update(tasks)
      .set({
        updatedAt: sql`NOW()`,
        monitor: serializeSchedulerMetadata(sched),
      })
      .where(eq(tasks.id, task.id));

    console.log(`[Scheduler] RETRY task ${task.id} ("${task.name}") — retryCount now ${sched.retryCount}/${sched.maxRetry}`);
  } catch (err) {
    console.error(`[Scheduler] FAILED to retry task ${task.id}:`, err);
    throw err;
  }
}

/**
 * Stage 2: Escalate — notify a higher-level coordinator.
 * Increments escalationLevel in embedded metadata and updates `updated_at`.
 */
export async function escalateTask(task: any): Promise<void> {
  try {
    const sched = parseSchedulerMetadata(task.monitor);
    sched.escalationLevel += 1;
    sched.stallSince = null;

    await db
      .update(tasks)
      .set({
        updatedAt: sql`NOW()`,
        monitor: serializeSchedulerMetadata(sched),
      })
      .where(eq(tasks.id, task.id));

    console.log(`[Scheduler] ESCALATE task ${task.id} ("${task.name}") — escalationLevel now ${sched.escalationLevel}/${sched.maxEscalationLevel}`);
  } catch (err) {
    console.error(`[Scheduler] FAILED to escalate task ${task.id}:`, err);
    throw err;
  }
}

/**
 * Stage 3: Rollback — restore the task to a previously saved snapshot state.
 * Updates `status` to targetState and resets retry/escalation counters.
 */
export async function rollbackTask(task: any, targetState: string): Promise<void> {
  try {
    if (!targetState || typeof targetState !== 'string' || targetState.trim().length === 0) {
      throw new Error('rollbackTask: targetState must be a non-empty string');
    }
    const sched = parseSchedulerMetadata(task.monitor);
    sched.retryCount = 0;
    sched.escalationLevel = 0;
    sched.stallSince = null;
    sched.lastProgressAt = new Date().toISOString();

    await db
      .update(tasks)
      .set({
        status: targetState,
        updatedAt: sql`NOW()`,
        monitor: serializeSchedulerMetadata(sched),
      })
      .where(eq(tasks.id, task.id));

    console.log(`[Scheduler] ROLLBACK task ${task.id} ("${task.name}") — restored to state "${targetState}"`);
  } catch (err) {
    console.error(`[Scheduler] FAILED to rollback task ${task.id}:`, err);
    throw err;
  }
}

/**
 * Stage 4: Block — mark the task as blocked, requiring human intervention.
 * Updates `status` to 'blocked' and stores the reason in embedded metadata.
 */
export async function blockTask(task: any, reason: string): Promise<void> {
  try {
    const sched = parseSchedulerMetadata(task.monitor);
    sched.stallSince = new Date().toISOString();

    await db
      .update(tasks)
      .set({
        status: 'blocked',
        updatedAt: sql`NOW()`,
        monitor: serializeSchedulerMetadata(sched),
      })
      .where(eq(tasks.id, task.id));

    console.log(`[Scheduler] BLOCK task ${task.id} ("${task.name}") — reason: "${reason}"`);
  } catch (err) {
    console.error(`[Scheduler] FAILED to block task ${task.id}:`, err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

/**
 * Scan the tasks table for stalled tasks and apply the 4-stage recovery pipeline.
 *
 * A task is considered stalled when:
 *   - It is NOT in a terminal state (done, cancelled, blocked)
 *   - Its updatedAt timestamp is older than stallThresholdMs
 *
 * For each stalled task the scheduler decides which recovery stage to apply
 * based on the task's embedded scheduler metadata (retryCount, escalationLevel, etc).
 */
export async function scanStalledTasks(state?: Partial<SchedulerState>): Promise<ScanResult> {
  const config = { ...defaultSchedulerState(), ...state };
  const result: ScanResult = { scanned: 0, retried: 0, escalated: 0, rolledback: 0, blocked: 0 };

  if (!config.enabled) {
    console.log('[Scheduler] Scheduler is disabled — skipping scan');
    return result;
  }

  const cutoffMs = Date.now() - config.stallThresholdMs;

  const stalled = await db
    .select()
    .from(tasks)
    .where(
      and(
        notInArray(tasks.status, [...TERMINAL_STATES]),
        lt(tasks.updatedAt, new Date(cutoffMs)),
      ),
    );

  result.scanned = stalled.length;

  for (const task of stalled) {
    // Parse embedded scheduler metadata or fall back to defaults
    const sched: SchedulerState = parseSchedulerMetadata(task.monitor);

    if (sched.retryCount < sched.maxRetry) {
      await retryTask(task);
      result.retried++;
    } else if (sched.escalationLevel < sched.maxEscalationLevel) {
      await escalateTask(task);
      result.escalated++;
    } else if (sched.autoRollback && sched.snapshot) {
      await rollbackTask(task, sched.snapshot.state);
      result.rolledback++;
    } else {
      await blockTask(task, 'All automated recovery exhausted');
      result.blocked++;
    }
  }

  console.log(`[Scheduler] Scan complete — ${result.scanned} stalled: ${result.retried} retried, ${result.escalated} escalated, ${result.rolledback} rolled back, ${result.blocked} blocked`);

  return result;
}
