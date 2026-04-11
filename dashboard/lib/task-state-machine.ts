import { z } from "zod";

/**
 * Task State Machine — Edict-inspired explicit transition model.
 *
 * Design rationale:
 * - STATE_TRANSITIONS is the single source of truth for legal transitions.
 * - Terminal states (done, cancelled) map to empty Sets — no transitions out,
 *   enforcing immutability at the data-structure level.
 * - Blocked is a "hub" state — it can transition to any active workflow state
 *   (active, in_progress, review), eliminating the need to store a _prev_state.
 *   This models "paused, awaiting unblocking" without losing workflow context.
 */

export const TaskState = {
  Draft: "draft",
  Active: "active",
  InProgress: "in_progress",
  Review: "review",
  Done: "done",
  Cancelled: "cancelled",
  Blocked: "blocked",
} as const;

export type TaskState = (typeof TaskState)[keyof typeof TaskState];

/**
 * Transition table: each state maps to the Set of states it may transition to.
 *
 * Terminal states (done, cancelled) have empty sets — once reached, the task
 * is immutable. Blocked acts as a hub that can resume to any mid-workflow state.
 */
export const STATE_TRANSITIONS: Record<TaskState, Set<TaskState>> = {
  draft: new Set(["active", "cancelled"]),
  active: new Set(["in_progress", "blocked", "cancelled"]),
  in_progress: new Set(["review", "done", "blocked", "cancelled"]),
  review: new Set(["done", "in_progress", "blocked", "cancelled"]),
  done: new Set(),
  cancelled: new Set(),
  blocked: new Set(["active", "in_progress", "review"]),
};

/**
 * Returns true if transitioning from `from` to `to` is a legal state change.
 */
export function canTransition(from: TaskState, to: TaskState): boolean {
  return STATE_TRANSITIONS[from].has(to);
}

/**
 * Returns the set of terminal states — states with no valid outgoing transitions.
 */
export function getTerminalStates(): ReadonlySet<TaskState> {
  return new Set(["done", "cancelled"]);
}

/**
 * Returns the set of valid next states for a given state.
 */
export function getValidTransitions(from: TaskState): ReadonlySet<TaskState> {
  return STATE_TRANSITIONS[from] ?? new Set();
}

// -- Zod schemas -----------------------------------------------------------

const stateValues = Object.values(TaskState) as [TaskState, ...TaskState[]];

export const TaskStateSchema = z.enum(stateValues);

export const TaskTransitionSchema = z
  .object({
    taskId: z.string().uuid(),
    from: TaskStateSchema,
    to: TaskStateSchema,
    reason: z.string().max(500),
  })
  .superRefine((data, ctx) => {
    if (!canTransition(data.from, data.to)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Invalid state transition: ${data.from} \u2192 ${data.to}`,
        path: ["to"],
      });
    }
  });

export type TaskTransition = z.infer<typeof TaskTransitionSchema>;

// -- Task metadata interface -----------------------------------------------

/**
 * State machine metadata that can be embedded on task objects.
 * Tracks scheduling info, retry/escalation counters, and snapshot state
 * for recovery purposes.
 */
export interface TaskStateMachineMeta {
  scheduler: {
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
    snapshot: {
      state: TaskState;
      savedAt: string;
    } | null;
  };
}
