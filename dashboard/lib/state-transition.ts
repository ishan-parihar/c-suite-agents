import { eq } from 'drizzle-orm';
import { canTransition, TaskState, getTerminalStates } from '@/lib/task-state-machine';
import { db } from '@/lib/db';
import { tasks } from '@/drizzle/schema/lifeos/tasks';
import { transitionLog } from '@/drizzle/schema/operations/transition-log';

const OLD_TO_NEW_STATE_MAP: Record<string, TaskState> = {
  'Up Next': 'active',
  'Active': 'active',
  'Focus': 'active',
  'Waiting': 'blocked',
  'Paused': 'blocked',
  'Done': 'done',
  'Archived': 'cancelled',
  'Cancelled': 'cancelled',
};

function normalizeState(state: string): TaskState {
  return OLD_TO_NEW_STATE_MAP[state] ?? (state as TaskState);
}

// -- Errors ----------------------------------------------------------------

export class InvalidTransitionError extends Error {
  public readonly code = 'INVALID_TRANSITION' as const;

  constructor(
    public readonly from: string,
    public readonly to: string,
    public readonly taskId: string,
  ) {
    super(`Invalid transition: ${from} -> ${to} for task ${taskId}`);
    this.name = 'InvalidTransitionError';
  }
}

export class TerminalStateError extends Error {
  public readonly code = 'TERMINAL_STATE' as const;

  constructor(
    public readonly state: string,
    public readonly taskId: string,
  ) {
    super(`Task ${taskId} is in terminal state: ${state}`);
    this.name = 'TerminalStateError';
  }
}

// -- Synchronous enforcement -----------------------------------------------

/**
 * Validate a state transition synchronously.
 *
 * Throws TerminalStateError if `from` is a terminal state.
 * Throws InvalidTransitionError if the transition is not allowed.
 */
export function enforceTransition(
  taskId: string,
  from: TaskState,
  to: TaskState,
): void {
  const terminalStates = getTerminalStates();

  if (terminalStates.has(from)) {
    throw new TerminalStateError(from, taskId);
  }

  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to, taskId);
  }
}

// -- Async transition with DB round-trip -----------------------------------

const validStateValues = new Set<string>(Object.values(TaskState));

export async function performTransition(
  taskId: string,
  newStatus: string,
): Promise<{ success: boolean; error?: string }> {
  if (!validStateValues.has(newStatus)) {
    return { success: false, error: `Unknown target state: ${newStatus}` };
  }

  const [task] = await db
    .select({ id: tasks.id, status: tasks.status })
    .from(tasks)
    .where(eq(tasks.id, taskId));

  if (!task) {
    return { success: false, error: `Task not found: ${taskId}` };
  }

  const currentStatus = normalizeState(task.status);
  const targetStatus = newStatus as TaskState;

  try {
    enforceTransition(taskId, currentStatus, targetStatus);
  } catch (err) {
    if (err instanceof InvalidTransitionError || err instanceof TerminalStateError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(tasks)
      .set({ status: targetStatus, updatedAt: new Date() })
      .where(eq(tasks.id, taskId));

    await recordTransition(tx, taskId, currentStatus, targetStatus, 'performTransition');
  });

  return { success: true };
}

// -- Audit trail ------------------------------------------------------------

export async function recordTransition(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  taskId: string,
  from: string,
  to: string,
  reason: string,
  agentId?: string,
): Promise<void> {
  await tx.insert(transitionLog).values({
    taskId,
    fromState: from,
    toState: to,
    reason,
    agentId: agentId ?? null,
    occurredAt: new Date(),
  });
}

