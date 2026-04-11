# Edict Patterns: 73% -> 100% Implementation Plan

> **Goal**: Wire all 6 remaining Edict architecture pattern stubs into live systems.
> **Strategy**: Phased plan with parallelizable subagent tasks. Each phase groups
> independent work; phases have hard dependencies between them.
> **Stack**: Next.js 16 + Drizzle ORM + PostgreSQL (dashboard/) + Node.js agent runtime (src/)

---

## Phase Overview

```
Phase 1 - Foundations (Schemas, Types, Helpers)     [4 parallel tracks]
  |-- 1A. transition_log Drizzle schema               (Pattern 1)
  |-- 1B. Agent-auth authentication middleware         (Pattern 4)
  |-- 1C. Outbox helper + publishEvent wiring          (Pattern 6)
  +-- 1D. OpenClaw session file reader                 (Pattern 3)

Phase 2 - Wiring (Connect to Live Systems)            [5 parallel tracks]
  |-- 2A. wire recordTransition() -> DB INSERT          (Pattern 1, depends 1A)
  |-- 2B. wire scheduler retry/escalate/block          (Pattern 2)
  |-- 2C. implement activity-stream fusion sources     (Pattern 3, depends 1D)
  |-- 2D. wire agent-auth into validateAgentAction()   (Pattern 4, depends 1B)
  +-- 2E. extend outbox to CRUD routes                 (Pattern 6, depends 1C)

Phase 3 - Integration (End-to-End, Polish)            [3 parallel tracks]
  |-- 3A. audit & wire input validation on all routes  (Pattern 8)
  |-- 3B. Telegram notification on blockTask            (Pattern 2)
  +-- 3C. run drizzle migrations + smoke tests         (All patterns)
```

---

# Phase 1: Foundations

> **Goal**: Create new schema files, type definitions, and helper modules.
> These tasks are fully independent and can run in parallel.

---

## Task 1A - transition_log Drizzle Schema (Pattern 1)

**Files to create:**
- `dashboard/drizzle/schema/operations/transition-log.ts` -- new Drizzle table definition
- Update `dashboard/drizzle/schema/operations/index.ts` -- add re-export

**What it does:**

Create a `transition_log` PostgreSQL table to audit every state transition. This replaces the `console.log` stub in `recordTransition()`.

**Table schema (exact columns):**

```
transition_log
|-- id: uuid (PK, defaultRandom)
|-- taskId: uuid (FK -> tasks.id, notNull)
|-- fromState: text (notNull)           -- e.g. "active", "in_progress"
|-- toState: text (notNull)             -- e.g. "review", "blocked"
|-- reason: text (notNull, max 500)     -- human-readable reason
|-- agentId: text (nullable)            -- which agent triggered the transition
|-- occurredAt: timestamp with time zone (notNull, default now())
+-- indexes:
    |-- idx_transition_log_task (taskId)
    +-- idx_transition_log_occurred (occurredAt DESC)
```

**Implementation (transition-log.ts):**

```typescript
import { pgTable, uuid, text, timestamp, index } from 'drizzle-orm/pg-core';
import { tasks } from '../lifeos/tasks';

export const transitionLog = pgTable('transition_log', {
  id: uuid('id').primaryKey().defaultRandom(),
  taskId: uuid('task_id')
    .references(() => tasks.id)
    .notNull(),
  fromState: text('from_state').notNull(),
  toState: text('to_state').notNull(),
  reason: text('reason').notNull(),
  agentId: text('agent_id'),
  occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_transition_log_task').on(table.taskId),
  index('idx_transition_log_occurred').on(table.occurredAt),
]);
```

**Data flow:**
1. Any code path that changes a task status calls `recordTransition(tx, taskId, from, to, reason, agentId)`.
2. The function receives a Drizzle transaction object (`tx`) and does `tx.insert(transitionLog).values(...)`.
3. Because it runs inside the caller transaction, the audit record is atomic with the state change.

**Update `operations/index.ts`** -- add to the exports block:

```typescript
export {
  transitionLog,
} from './transition-log';
```

**Dependencies:** None (Phase 1 seed task).

**Success criteria:**
- `transition_log` table exists in schema exports
- `drizzle/schema/index.ts` re-exports `transitionLog` from `operations/`
- Drizzle can generate migration for the new table (verified via `drizzle-kit generate`)
- No TypeScript compilation errors in `dashboard/`

---

## Task 1B - Agent Authentication Middleware (Pattern 4)

**File to create:**
- `dashboard/lib/server/agent-auth.ts` -- new file

**What it does:**

This is the **authentication** layer (vs `agent-permissions.ts` which handles **authorization**). It verifies that an incoming request `x-agent-id` header belongs to a known agent identity, and extracts agent metadata for downstream use.

**Public API:**

```typescript
import { type NextRequest } from 'next/server';
import { type EntityType } from '@/lib/agent-permissions';

export interface AuthenticatedAgent {
  agentId: string;
  role: 'coordinator' | 'executor' | 'observer';
  canRead: EntityType[];
  canWrite: EntityType[];
  canDelete: EntityType[];
  canDispatch: string[];
}

export type AuthResult =
  | { ok: true; agent: AuthenticatedAgent; userId?: string }
  | { ok: false; status: 401 | 403; error: string };

export function authenticateAgent(request: NextRequest): AuthResult;
export function requireAgent(request: NextRequest): AuthenticatedAgent;

export class UnknownAgentError extends Error {
  constructor(public readonly agentId: string) {
    super(`Unknown agent: ${agentId}`);
    this.name = 'UnknownAgentError';
  }
}
```

**Implementation details:**

1. `authenticateAgent()` reads `x-agent-id` and `x-user-id` headers from the request.
2. If `x-agent-id` is missing -> returns `{ ok: false, status: 401, error: 'Missing x-agent-id header' }`.
3. If `x-agent-id` is not in `AGENT_POLICY` -> returns `{ ok: false, status: 403, error: 'Unknown agent: {agentId}' }`.
4. If found -> returns `{ ok: true, agent: { agentId, ...policy }, userId }`.
5. `requireAgent()` is a thin wrapper that calls `authenticateAgent()` and either throws or returns the agent.

**Dependencies:** `@/lib/agent-permissions` (imports `AGENT_POLICY`, `EntityType`).

**Success criteria:**
- `authenticateAgent()` correctly rejects requests without `x-agent-id` (401)
- `authenticateAgent()` correctly rejects unknown agents (403)
- `authenticateAgent()` returns full agent metadata for known agents
- `requireAgent()` throws on failure, returns agent on success
- All unit-testable without a running server (pure header parsing + policy lookup)

---

## Task 1C - Outbox Helper + Event Publishing Wiring (Pattern 6)

**Files to create/modify:**
- `dashboard/lib/outbox-helper.ts` -- new helper file
- `dashboard/lib/outbox.ts` -- modify `publishEvent()` stub

**What it does (two parts):**

### Part 1: withOutbox() helper

Reduces boilerplate in route handlers. Instead of repeating `tx.insert(outboxEvents).values({...})` in every transaction, callers use:

```typescript
import { withOutbox, type OutboxEventInput } from '@/lib/outbox-helper';

await db.transaction(async (tx) => {
  await tx.update(tasks).set({ status: 'done' }).where(eq(tasks.id, taskId));
  await withOutbox(tx, {
    eventType: 'task.completed',
    entityId: taskId,
    entityType: 'task',
    payload: { title: task.name },
  });
});
```

**API in outbox-helper.ts:**

```typescript
import { type EntityType } from '@/lib/agent-permissions';
import { outboxEvents } from '@/drizzle/schema';

export interface OutboxEventInput {
  eventType: string;       // e.g. 'task.completed', 'goal.updated'
  entityId: string;        // UUID
  entityType: EntityType;  // from agent-permissions.ts
  payload: Record<string, unknown>;
}

export async function withOutbox(
  tx: DrizzleTransaction,
  event: OutboxEventInput,
): Promise<void> {
  await tx.insert(outboxEvents).values({
    eventType: event.eventType,
    entityId: event.entityId,
    entityType: event.entityType,
    payload: event.payload,
    published: false,
    attempts: 0,
  });
}
```

### Part 2: publishEvent() implementation in outbox.ts

Replace the `console.log` stub with real event publishing. The dashboard runs inside Next.js (server-side), while the agent runtime (`src/`) has the WebSocket gateway. The publishing mechanism uses an HTTP call to an internal event push endpoint:

```typescript
// In dashboard/lib/outbox.ts -- replace publishEvent():

async function publishEvent(event: typeof outboxEvents.$inferSelect): Promise<void> {
  const dashboardBaseUrl = process.env.DASHBOARD_URL || 'http://localhost:3000';

  const response = await fetch(`${dashboardBaseUrl}/api/events/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventType: event.eventType,
      entityId: event.entityId,
      entityType: event.entityType,
      payload: event.payload,
    }),
    signal: AbortSignal.timeout(5000),
  });

  if (!response.ok) {
    throw new Error(`Event push failed: ${response.status} ${response.statusText}`);
  }
}
```

**NOTE**: This requires creating `dashboard/app/api/events/push/route.ts` (see Task 2E).

**Dependencies:** `@/drizzle/schema` (imports `outboxEvents`), `@/lib/agent-permissions` (imports `EntityType`).

**Success criteria:**
- `withOutbox()` compiles and type-checks with Drizzle transaction type
- `publishEvent()` makes HTTP POST to `/api/events/push` (or skips gracefully in dev)
- Failed publish throws (so relayOutbox retry logic catches it)
- No circular imports between `outbox.ts` and `outbox-helper.ts`

---

## Task 1D - OpenClaw Session File Reader (Pattern 3)

**File to create:**
- `dashboard/lib/openclaw-sessions.ts` -- new file

**What it does:**

Reads OpenClaw agent session JSONL files from `~/.openclaw/agents/{agentId}/sessions/*.jsonl` and extracts relevant `tool_call` and `message` entries that relate to a given entity.

**Public API:**

```typescript
export interface OpenClawSessionEntry {
  at: string;              // ISO 8601 timestamp
  agentId: string;
  type: 'tool_call' | 'message';
  data: Record<string, unknown>;
}

export async function getAgentSessionEntries(
  agentId: string,
  entityId: string,
): Promise<OpenClawSessionEntry[]>;

export function getOpenClawSessionsDir(): string;
```

**Implementation details:**

1. Resolve base path: `process.env.OPENCLAW_HOME || os.homedir() + '/.openclaw'`
2. Construct path: `{base}/agents/{agentId}/sessions/`
3. Read all `*.jsonl` files in that directory (sorted by mtime, newest first, limit to 10 files)
4. Parse each line as JSON; filter entries where `type` is `tool_call` or `message`
5. For `tool_call` entries: check if `args` contains `entityId` or if tool name matches entity-related patterns
6. For `message` entries: check if `content` contains the `entityId`
7. Return as `OpenClawSessionEntry[]` sorted by timestamp descending

**Error handling:**
- If directory doesn't exist -> return `[]` (graceful degradation)
- If file read fails for a single file -> log warning, continue with others
- If JSON parse fails for a single line -> skip that line

**Dependencies:** Node.js `fs/promises`, `os`, `path`. No Drizzle/DB dependency.

**Success criteria:**
- Returns entries when JSONL files exist
- Returns `[]` when no sessions directory exists (no crash)
- Correctly filters by entity ID
- Handles malformed JSONL gracefully (skip bad lines, continue)
- Pure file I/O -- no side effects

---

# Phase 2: Wiring

> **Goal**: Connect Phase 1 foundations to live systems -- DB writes, agent
> messaging, activity fusion, authentication flow.
>
> Phase 2 tasks depend on Phase 1. Within Phase 2, tasks are parallelizable
> except where noted.

---

## Task 2A - Wire recordTransition() to DB INSERT (Pattern 1)

**File to modify:**
- `dashboard/lib/state-transition.ts`

**What it does:**

Replace the `console.log` stub in `recordTransition()` with an actual `INSERT` into the `transition_log` table.

**Current stub (lines 125-149):**
```typescript
export async function recordTransition(
  _tx: unknown,
  taskId: string,
  from: string,
  to: string,
  reason: string,
  agentId?: string,
): Promise<void> {
  console.log(`[state-transition] ${taskId}: ${from} -> ${to} ...`);
}
```

**New implementation:**

```typescript
import { transitionLog } from '@/drizzle/schema';
import type { DrizzleTransaction } from 'drizzle-orm';

export async function recordTransition(
  tx: DrizzleTransaction,          // was: unknown
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
```

**Also update the caller in performTransition() (line 110):**

Replace the standalone `recordTransitionConsole()` call with a transactional wrapper:

```typescript
// OLD (lines 105-112):
//   await db.update(tasks).set({ status: targetStatus, updatedAt: new Date() })
//     .where(eq(tasks.id, taskId));
//   recordTransitionConsole(taskId, currentStatus, targetStatus);

// NEW:
await db.transaction(async (tx) => {
  await tx.update(tasks)
    .set({ status: targetStatus, updatedAt: new Date() })
    .where(eq(tasks.id, taskId));

  await recordTransition(tx, taskId, currentStatus, targetStatus, 'performTransition');
});
```

**Dependencies:** Task 1A (transition_log schema must exist).

**Success criteria:**
- `recordTransition()` inserts a row into `transition_log` via the passed transaction
- `performTransition()` wraps the UPDATE + audit INSERT in a single transaction
- `console.log` is removed from `recordTransition()`
- TypeScript compiles with strict type checking on the `tx` parameter
- No runtime errors when transitioning a task state

---

## Task 2B - Wire Scheduler Recovery to Agent Messaging (Pattern 2)

**File to modify:**
- `dashboard/lib/scheduler.ts`

**What it does (three sub-tasks):**

### Sub-task 2B.1: retryTask() -- actual agent re-dispatch

Currently `retryTask()` only increments `retryCount` and updates `updatedAt`. It must also **re-dispatch the task to the assigned agent** via Operant agent messaging.

**Data flow:**

```
scanStalledTasks() detects stalled task
  -> retryTask(task)
    -> 1. Parse scheduler metadata (existing)
    -> 2. Send P2-priority message to the task assignee agent
    -> 3. Log to kanban_card_activity (action: 'retry_triggered')
    -> 4. Insert outbox event (eventType: 'scheduler.retry')
    -> 5. Update scheduler metadata (existing)
```

**Implementation:**

Use the **PostgreSQL messaging tables** directly (Drizzle schema at `dashboard/drizzle/schema/operations/messaging.ts`):

```typescript
import { messages } from '@/drizzle/schema/operations/messaging';
import { outboxEvents } from '@/drizzle/schema';
import { v4 as uuidv4 } from 'uuid';

async function dispatchAgentMessage(
  fromAgent: string,
  toAgent: string,
  content: string,
  priority: 'P1' | 'P2' | 'P3' | 'P4' = 'P2',
): Promise<void> {
  const threadId = uuidv4();

  await db.insert(messages).values({
    threadId,
    fromAgent,
    toAgent,
    content,
    priority,
    requiresResponse: false,
    responded: false,
    read: false,
  });
}
```

In `retryTask()`, after updating the scheduler metadata:

```typescript
const assigneeAgent = task.assignee || 'coo-productivity';

await dispatchAgentMessage(
  'coo-productivity',
  assigneeAgent,
  `Task "${task.name}" (${task.id}) stalled -- re-dispatched (retry ${sched.retryCount}/${sched.maxRetry}). Please resume processing.`,
  'P2',
);

// Log to kanban_card_activity
await db.execute(sql`
  INSERT INTO kanban_card_activity (card_id, ts, action, payload)
  VALUES (${task.id}, NOW(), 'retry_triggered', ${JSON.stringify({
    retryCount: sched.retryCount,
    maxRetry: sched.maxRetry,
  })})
`);

// Insert outbox event
await db.insert(outboxEvents).values({
  eventType: 'scheduler.retry',
  entityId: task.id,
  entityType: 'task',
  payload: { retryCount: sched.retryCount, maxRetry: sched.maxRetry },
  published: false,
  attempts: 0,
});
```

### Sub-task 2B.2: escalateTask() -- escalation messages to coordinators

Currently `escalateTask()` only increments `escalationLevel`. It must send **escalation messages up the chain** (COO -> CEO hierarchy).

**Escalation chain logic:**

```
Level 1: Escalate to task managing coordinator (COO-Productivity for most tasks)
Level 2: Escalate to CEO-Strategic
Level 3: Escalate to Board Chair (user) -- Telegram notification (Task 3B)
```

**Implementation:**

```typescript
const ESCALATION_CHAIN: Record<number, string> = {
  1: 'coo-productivity',    // First escalation: notify COO
  2: 'ceo-strategic',       // Second escalation: notify CEO
  3: 'board-chair',         // Third escalation: notify human (Telegram, handled in Task 3B)
};

async function sendEscalation(
  taskId: string,
  taskName: string,
  level: number,
  reason: string,
): Promise<void> {
  const targetAgent = ESCALATION_CHAIN[level] ?? 'ceo-strategic';

  if (targetAgent === 'board-chair') {
    return; // Handled separately via Telegram (Task 3B)
  }

  await dispatchAgentMessage(
    'coo-productivity',
    targetAgent,
    `ESCALATION (Level ${level}): Task "${taskName}" (${taskId}) -- ${reason}. Automated recovery failed at retry stage.`,
    level === 1 ? 'P2' : 'P1',
  );
}
```

In `escalateTask()`, after updating metadata, call `sendEscalation()` and log to activity/outbox tables.

### Sub-task 2B.3: Configurable backoff delays

Currently `stallThresholdMs` is a fixed value (10 minutes). Add **exponential backoff** based on retry count.

**Implementation:**

```typescript
/**
 * Calculate backoff delay for a given retry attempt.
 * Formula: stallThresholdMs * 2^(retryCount - 1)
 *
 * Examples (with default 600_000ms / 10min base):
 *   Retry 1: 600,000ms   (10 min)
 *   Retry 2: 1,200,000ms (20 min)
 */
function calculateBackoffMs(baseThresholdMs: number, retryCount: number): number {
  return baseThresholdMs * Math.pow(2, retryCount - 1);
}
```

Modify `scanStalledTasks()` to use per-task backoff:

```typescript
for (const task of stalled) {
  const sched = parseSchedulerMetadata(task.monitor);

  const effectiveThreshold = calculateBackoffMs(
    config.stallThresholdMs,
    sched.retryCount + 1,
  );

  const effectiveCutoff = Date.now() - effectiveThreshold;
  if (new Date(task.updatedAt).getTime() > effectiveCutoff) {
    continue; // Not yet time for this retry
  }

  // ... rest of recovery logic
}
```

**Dependencies:** None within Phase 2 (but Task 3B adds Telegram for Level 3).

**Success criteria:**
- `retryTask()` sends a P2 message to the assignee agent via the messages table
- `escalateTask()` sends escalation messages up the chain (COO -> CEO)
- `calculateBackoffMs()` returns exponentially increasing delays
- `scanStalledTasks()` respects backoff before deciding to retry
- All recovery actions log to `kanban_card_activity` with appropriate action types
- All recovery actions insert `outboxEvents` with `scheduler.retry`, `scheduler.escalated`, etc.

---

## Task 2C - Implement Activity Stream Fusion Sources (Pattern 3)

**File to modify:**
- `dashboard/lib/activity-stream.ts`

**What it does (four sub-tasks):**

### Sub-task 2C.1: getImplicitStateActivity() -- query entity tables

Currently returns `[]`. Implement by querying entity tables for recent status changes.

**Implementation:**

Replace the empty stub with a switch on `entityType`:

```typescript
import { tasks } from '@/drizzle/schema/lifeos/tasks';
import { projects } from '@/drizzle/schema/lifeos/projects';
import { annualGoals } from '@/drizzle/schema/lifeos/annual_goals';
import { quarterlyGoals } from '@/drizzle/schema/lifeos/quarterly_goals';
import { campaigns } from '@/drizzle/schema/lifeos/campaigns';
import { eq } from 'drizzle-orm';

async function getImplicitStateActivity(
  entityId: string,
  entityType: EntityType,
): Promise<ActivityEntry[]> {
  const entries: ActivityEntry[] = [];

  switch (entityType) {
    case 'task': {
      const rows = await db
        .select({ id: tasks.id, status: tasks.status, updatedAt: tasks.updatedAt })
        .from(tasks)
        .where(eq(tasks.id, entityId));
      for (const row of rows) {
        entries.push({
          at: row.updatedAt.toISOString(),
          kind: 'state_change',
          entityId: row.id,
          entityType: 'task',
          agentId: undefined,
          userId: undefined,
          data: { status: row.status, inferred: true },
        });
      }
      break;
    }
    case 'goal': {
      const [annual] = await db
        .select({ id: annualGoals.id, status: annualGoals.status, updatedAt: annualGoals.updatedAt })
        .from(annualGoals)
        .where(eq(annualGoals.id, entityId));
      if (annual) {
        entries.push({
          at: annual.updatedAt.toISOString(),
          kind: 'state_change',
          entityId: annual.id,
          entityType: 'goal',
          agentId: undefined,
          userId: undefined,
          data: { status: annual.status, level: 'annual' },
        });
      }
      const [quarterly] = await db
        .select({ id: quarterlyGoals.id, status: quarterlyGoals.status, updatedAt: quarterlyGoals.updatedAt })
        .from(quarterlyGoals)
        .where(eq(quarterlyGoals.id, entityId));
      if (quarterly) {
        entries.push({
          at: quarterly.updatedAt.toISOString(),
          kind: 'state_change',
          entityId: quarterly.id,
          entityType: 'goal',
          agentId: undefined,
          userId: undefined,
          data: { status: quarterly.status, level: 'quarterly' },
        });
      }
      break;
    }
    case 'project': {
      const rows = await db
        .select({ id: projects.id, status: projects.status, updatedAt: projects.updatedAt })
        .from(projects)
        .where(eq(projects.id, entityId));
      for (const row of rows) {
        entries.push({
          at: row.updatedAt.toISOString(),
          kind: 'state_change',
          entityId: row.id,
          entityType: 'project',
          agentId: undefined,
          userId: undefined,
          data: { status: row.status },
        });
      }
      break;
    }
    case 'campaign': {
      const rows = await db
        .select({ id: campaigns.id, status: campaigns.status, updatedAt: campaigns.updatedAt })
        .from(campaigns)
        .where(eq(campaigns.id, entityId));
      for (const row of rows) {
        entries.push({
          at: row.updatedAt.toISOString(),
          kind: 'state_change',
          entityId: row.id,
          entityType: 'campaign',
          agentId: undefined,
          userId: undefined,
          data: { status: row.status },
        });
      }
      break;
    }
    default:
      break;
  }

  return entries.sort((a, b) => b.at.localeCompare(a.at));
}
```

### Sub-task 2C.2: getSchedulerEvents() -- query kanban_card_activity

New function querying scheduler actions from the activity table:

```typescript
async function getSchedulerEvents(
  entityId: string,
  entityType: EntityType,
): Promise<ActivityEntry[]> {
  if (entityType !== 'kanban') return [];

  const rows = await db
    .select({
      ts: kanbanCardActivity.ts,
      action: kanbanCardActivity.action,
      payload: kanbanCardActivity.payload,
      cardId: kanbanCardActivity.cardId,
    })
    .from(kanbanCardActivity)
    .where(
      and(
        eq(kanbanCardActivity.cardId, entityId),
        inArray(kanbanCardActivity.action, ['retry_triggered', 'escalated', 'rollback', 'blocked']),
      ),
    )
    .orderBy(desc(kanbanCardActivity.ts));

  return rows.map((row) => ({
    at: row.ts.toISOString(),
    kind: 'scheduler_action' as ActivityKind,
    entityId: row.cardId,
    entityType: 'kanban' as EntityType,
    agentId: extractAgentId(row.payload),
    userId: extractUserId(row.payload),
    data: { action: row.action, ...(row.payload as Record<string, unknown> || {}) },
  }));
}
```

### Sub-task 2C.3: getOutboxActivity() -- query outbox_events table

New function:

```typescript
async function getOutboxActivity(
  entityId: string,
  entityType: EntityType,
): Promise<ActivityEntry[]> {
  const rows = await db
    .select({
      createdAt: outboxEvents.createdAt,
      eventType: outboxEvents.eventType,
      entityId: outboxEvents.entityId,
      entityType: outboxEvents.entityType,
      payload: outboxEvents.payload,
    })
    .from(outboxEvents)
    .where(
      and(
        eq(outboxEvents.entityId, entityId),
        eq(outboxEvents.entityType, entityType as string),
      ),
    )
    .orderBy(desc(outboxEvents.createdAt))
    .limit(50);

  return rows.map((row) => ({
    at: (row.createdAt as Date).toISOString(),
    kind: 'crud_event' as ActivityKind,
    entityId: row.entityId as string,
    entityType: row.entityType as EntityType,
    agentId: (row.payload as any)?.agentId,
    userId: (row.payload as any)?.userId,
    data: { eventType: row.eventType, ...(row.payload as Record<string, unknown> || {}) },
  }));
}
```

### Sub-task 2C.4: getOpenClawSessionEvents() -- use Task 1D reader

New function:

```typescript
import { getAgentSessionEntries, type OpenClawSessionEntry } from '@/lib/openclaw-sessions';

async function getOpenClawSessionEvents(
  entityId: string,
  entityType: EntityType,
): Promise<ActivityEntry[]> {
  const agentIds = mapEntityTypeToAgentIds(entityType);
  const allEntries: OpenClawSessionEntry[] = [];
  for (const agentId of agentIds) {
    const entries = await getAgentSessionEntries(agentId, entityId);
    allEntries.push(...entries);
  }

  return allEntries.map((entry) => ({
    at: entry.at,
    kind: entry.type === 'tool_call' ? 'user_action' : 'progress',
    entityId,
    entityType,
    agentId: entry.agentId,
    userId: undefined,
    data: { sessionType: entry.type, ...entry.data },
  }));
}

function mapEntityTypeToAgentIds(entityType: EntityType): string[] {
  const map: Record<EntityType, string[]> = {
    task: ['coo-productivity'],
    goal: ['ceo-strategic'],
    project: ['coo-productivity'],
    campaign: ['cmo-content'],
    content: ['cmo-content'],
    journal: ['cpo-psychologist'],
    person: ['cro-relational'],
    financial: ['cfo-financial'],
    report: ['cio-intelligence'],
    meeting: ['ceo-strategic'],
    kanban: ['coo-productivity'],
    message: ['ceo-strategic'],
    account: ['cfo-financial'],
    session: ['ceo-strategic'],
  };
  return map[entityType] || [];
}
```

### Wire all sources in getEntityActivity():

Update the `sources` array in the existing function (around line 112):

```typescript
export async function getEntityActivity(
  entityId: string,
  entityType: EntityType,
): Promise<ActivityEntry[]> {
  const sources: Promise<ActivityEntry[]>[] = [
    getKanbanCardActivityForEntity(entityId, entityType),
    getImplicitStateActivity(entityId, entityType),
    getSchedulerEvents(entityId, entityType),
    getOutboxActivity(entityId, entityType),
    getOpenClawSessionEvents(entityId, entityType),
  ];

  const results = await Promise.all(sources);
  const merged = results.flat();

  // Deduplicate
  const seen = new Set<string>();
  const deduplicated = merged.filter((entry) => {
    const key = `${entry.at}|${entry.kind}|${entry.entityId}|${JSON.stringify(entry.data)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduplicated.sort((a, b) => b.at.localeCompare(a.at));
  return deduplicated;
}
```

**Dependencies:** Task 1D (OpenClaw session reader).

**Success criteria:**
- `getImplicitStateActivity()` returns status-change entries for tasks, goals, projects, campaigns
- `getSchedulerEvents()` returns retry/escalate/rollback/blocked entries from `kanban_card_activity`
- `getOutboxActivity()` returns CRUD events from `outbox_events` table
- `getOpenClawSessionEvents()` returns tool_call/message entries from session JSONL files
- `getEntityActivity()` merges all sources, deduplicates, and sorts newest-first
- Returns `[]` for entity types with no data sources (graceful degradation)

---

## Task 2D - Wire Agent-Auth into validateAgentAction() (Pattern 4)

**File to modify:**
- `dashboard/lib/api/factory.ts`

**What it does:**

Update `validateAgentAction()` to first authenticate the agent (verify identity exists in AGENT_POLICY) before checking authorization (verify permission for the action). This ensures **auth before authz**.

**Implementation:**

Modify `validateAgentAction()` in `factory.ts`:

```typescript
import { getAgentPolicy } from '@/lib/agent-permissions';
import { type AuthenticatedAgent } from '@/lib/server/agent-auth';

export function validateAgentAction(
  headers: AgentHeaders,
  action: 'read' | 'write' | 'delete',
  entityType: EntityType,
): AuthenticatedAgent {
  // Step 1: Authentication -- verify the agent identity exists
  if (!headers.agentId) {
    throw new PermissionError('Missing x-agent-id header');
  }

  const policy = getAgentPolicy(headers.agentId);
  if (!policy) {
    throw new PermissionError(`Unknown agent: ${headers.agentId}`);
  }

  // Step 2: Authorization -- check the agent has permission for this action
  assertAgentCan(headers.agentId, action, entityType);

  // Return the authenticated agent for downstream use
  return {
    agentId: headers.agentId,
    role: policy.role,
    canRead: policy.canRead,
    canWrite: policy.canWrite,
    canDelete: policy.canDelete,
    canDispatch: policy.canDispatch,
  };
}
```

**Also export a new convenience function:**

```typescript
export function validateAgentActionWithAuth(
  request: NextRequest,
  action: 'read' | 'write' | 'delete',
  entityType: EntityType,
): { agent: AuthenticatedAgent; userId?: string } {
  const headers = extractAgentHeaders(request);
  const agent = validateAgentAction(headers, action, entityType);
  return { agent, userId: headers.userId };
}
```

**Dependencies:** Task 1B (agent-auth.ts must exist).

**Success criteria:**
- `validateAgentAction()` rejects missing `x-agent-id` (401)
- `validateAgentAction()` rejects unknown agents (403)
- `validateAgentAction()` rejects known agents performing unauthorized actions (403)
- `validateAgentAction()` returns `AuthenticatedAgent` on success
- Existing card route handlers continue to work unchanged (backward compatible)

---

## Task 2E - Extend Outbox to CRUD Routes + Event Push Endpoint (Pattern 6)

**Files to create:**
- `dashboard/app/api/events/push/route.ts` -- new POST endpoint
- `dashboard/lib/ws-gateway-bridge.ts` -- new bridge module

**Files to verify (no changes needed):**
- `dashboard/app/api/kanban/cards/route.ts` -- already has outbox inserts
- `dashboard/app/api/kanban/cards/[id]/route.ts` -- already has outbox inserts

**What it does (two parts):**

### Part 1: Event push endpoint

Create a POST endpoint that the outbox relay calls to push events to connected WebSocket clients:

```typescript
// dashboard/app/api/events/push/route.ts

import { NextRequest, NextResponse } from 'next/server';
import { publishToConnectedClients } from '@/lib/ws-gateway-bridge';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('x-outbox-secret');
  if (process.env.OUTBOX_SECRET && authHeader !== process.env.OUTBOX_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const { eventType, entityId, entityType, payload } = body;

  if (!eventType || !entityId || !entityType) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 });
  }

  try {
    await publishToConnectedClients({
      type: eventType as string,
      entityId: entityId as string,
      entityType: entityType as string,
      payload: payload as Record<string, unknown>,
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: 'Push failed', details: message }, { status: 500 });
  }
}
```

### Part 2: WebSocket gateway bridge

```typescript
// dashboard/lib/ws-gateway-bridge.ts

import { getMessageBus } from 'operant/transport/message-bus';

interface OutboxEvent {
  type: string;
  entityId: string;
  entityType: string;
  payload: Record<string, unknown>;
}

export async function publishToConnectedClients(event: OutboxEvent): Promise<void> {
  try {
    const bus = getMessageBus();
    const content = JSON.stringify(event);

    const stats = bus.getStats();
    if (stats.activeSessions === 0) {
      return; // No connected clients
    }

    for (const [agentId, _session] of (bus as any).sessions) {
      bus.publish(agentId, {
        message_id: `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        thread_id: '__outbox__',
        from: 'system',
        to: agentId,
        content,
        priority: 'P3',
        requires_response: false,
        created_at: Date.now(),
      });
    }
  } catch (err) {
    console.warn('[outbox-bridge] Message bus unavailable:', err);
  }
}
```

**NOTE**: The bridge attempts to use the shared message bus. If the dashboard runs in isolation (no WS gateway in the same process), the publish is a no-op and the relay will retry.

### Part 3: Verify existing outbox usage

The kanban card routes already insert into `outboxEvents` within transactions:
- `POST /api/kanban/cards` -> inserts `kanban.card_created` -- OK
- `PATCH /api/kanban/cards` -> inserts `kanban.card_moved` -- OK
- `DELETE /api/kanban/cards/[id]` -> inserts `kanban.card_deleted` -- OK

**Dependencies:** Task 1C (outbox-helper.ts for the `publishEvent()` call path).

**Success criteria:**
- `/api/events/push` accepts POST and forwards to connected WS clients
- `publishEvent()` in outbox.ts calls `/api/events/push` and throws on failure
- `relayOutbox()` retries failed publishes (existing retry logic handles this)
- Existing card routes continue to work unchanged
- Graceful degradation when WS gateway is not reachable

---

# Phase 3: Integration

> **Goal**: Polish, audit remaining gaps, and run end-to-end validation.
> Phase 3 depends on Phase 2 completion. Tasks within Phase 3 are parallelizable.

---

## Task 3A - Audit & Wire Input Validation on All CRUD Routes (Pattern 8)

**What it does:**

Audit all CRUD route handlers in `dashboard/app/api/` and ensure every endpoint has the validation chain: `sanitizePayload()` -> `validateBody()` -> `validateAgentAction()`.

**Current state (complete audit):**

| Route File | Method | sanitizePayload | validateBody | validateAgentAction | Status |
|---|---|---|---|---|---|
| api/kanban/cards/route.ts | POST | YES | YES | YES | Complete |
| api/kanban/cards/route.ts | PATCH | YES | YES | YES | Complete |
| api/kanban/cards/[id]/route.ts | GET | N/A | N/A | YES | Complete (read-only, no body) |
| api/kanban/cards/[id]/route.ts | DELETE | N/A | N/A | YES | Complete (no body to sanitize) |
| api/cron/outbox/route.ts | GET | N/A | N/A | N/A | N/A (cron, not agent-facing) |
| api/cron/scheduler/route.ts | GET | N/A | N/A | N/A | N/A (cron, not agent-facing) |

**Additional routes:** No other API routes exist. The dashboard uses Server Components + Server Actions (`dashboard/lib/server/*.ts`) for data operations, not REST API routes. All 18 server action files are read-only (SELECT queries only).

**Implementation plan:**

### Step 1: Verify existing routes

- GET `[id]/route.ts` already calls `validateAgentAction(headers, 'read', 'kanban')`. No body to sanitize. Correct as-is.
- DELETE `[id]/route.ts` already calls `validateAgentAction(headers, 'delete', 'kanban')`. No body to sanitize. Correct as-is.

### Step 2: Create validation templates for future CRUD routes

Create a reusable validation template at `dashboard/lib/api/validation-templates.ts`:

```typescript
import { z } from 'zod';
import { sanitizePayload, validateBody, validateAgentAction, extractAgentHeaders } from './factory';
import type { NextRequest } from 'next/server';

export const GoalCreateSchema = z.object({
  name: z.string().min(3).max(500),
  status: z.string().optional(),
  strategic_intent: z.string().max(2000).optional(),
});

export async function validateGoalCreate(request: NextRequest) {
  const headers = extractAgentHeaders(request);
  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { return { ok: false as const, error: 'Invalid JSON', status: 400 }; }

  const sanitized = sanitizePayload(body);
  if (!sanitized.ok) return { ok: false as const, error: sanitized.error, status: 422 };

  const validation = validateBody(sanitized.data, GoalCreateSchema);
  if (!validation.ok) return { ok: false as const, error: validation.errors.join('; '), status: 422 };

  try {
    validateAgentAction(headers, 'write', 'goal');
  } catch {
    return { ok: false as const, error: 'Forbidden', status: 403 };
  }

  return { ok: true as const, data: validation.data, headers };
}
```

### Step 3: Audit report -- missing CRUD endpoints

| Entity | Create | Read | Update | Delete |
|--------|--------|------|--------|--------|
| kanban/card | API route | API route | API route | API route |
| goal | MISSING | Server action | MISSING | MISSING |
| project | MISSING | Server action | MISSING | MISSING |
| campaign | MISSING | Server action | MISSING | MISSING |
| task | MISSING | Server action | MISSING | MISSING |

**Dependencies:** None (audit can run in parallel with everything else).

**Success criteria:**
- All existing API routes have the validation chain
- No route accepts unvalidated input
- Validation templates exist for future routes
- Audit report documents missing CRUD endpoints

---

## Task 3B - Telegram Notification on blockTask (Pattern 2)

**File to modify:**
- `dashboard/lib/scheduler.ts` (the `blockTask()` function)

**What it does:**

When `blockTask()` is called (Stage 4 of recovery, all automated recovery exhausted), notify the Board Chair (user) via Telegram.

**Implementation:**

Add a `notifyBoardChair()` function to scheduler.ts:

```typescript
async function notifyBoardChair(taskId: string, taskName: string, reason: string): Promise<void> {
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  const boardChairChatId = process.env.BOARD_CHAIR_CHAT_ID;

  if (!telegramBotToken || !boardChairChatId) {
    console.warn('[Scheduler] Telegram not configured -- skipping board chair notification');
    return;
  }

  const message = `BLOCKED TASK

Task: "${taskName}" (${taskId})
Reason: ${reason}

All automated recovery (retry, escalation, rollback) has been exhausted. Human intervention required.`;

  try {
    const response = await fetch(
      `https://api.telegram.org/bot${telegramBotToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: boardChairChatId,
          text: message,
        }),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!response.ok) {
      console.error(`[Scheduler] Telegram notification failed: ${response.status}`);
    }
  } catch (err) {
    console.error('[Scheduler] Telegram notification error:', err);
    // Don't throw -- blocking the task is more important than the notification
  }
}
```

Wire it into `blockTask()`:

```typescript
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

    // Log to kanban_card_activity
    await db.execute(sql`
      INSERT INTO kanban_card_activity (card_id, ts, action, payload)
      VALUES (${task.id}, NOW(), 'blocked', ${JSON.stringify({
        reason,
        retryCount: sched.retryCount,
        escalationLevel: sched.escalationLevel,
      })})
    `);

    // Insert outbox event
    await db.insert(outboxEvents).values({
      eventType: 'scheduler.blocked',
      entityId: task.id,
      entityType: 'task',
      payload: { reason, retryCount: sched.retryCount, escalationLevel: sched.escalationLevel },
      published: false,
      attempts: 0,
    });

    // Notify Board Chair via Telegram
    await notifyBoardChair(task.id, task.name, reason);

    console.log(`[Scheduler] BLOCK task ${task.id} ("${task.name}") -- reason: "${reason}"`);
  } catch (err) {
    console.error(`[Scheduler] FAILED to block task ${task.id}:`, err);
    throw err;
  }
}
```

**Dependencies:** None (uses env vars, external Telegram API).

**Success criteria:**
- `blockTask()` sends Telegram message when `TELEGRAM_BOT_TOKEN` and `BOARD_CHAIR_CHAT_ID` are set
- Gracefully skips notification when Telegram is not configured (no crash)
- Timeout is bounded (10s) so it doesn't block the recovery pipeline
- Failure to notify doesn't prevent the task from being blocked
- Message includes task name, ID, reason, and recovery summary

---

## Task 3C - Run Drizzle Migrations + Smoke Tests (All Patterns)

**What it does:**

After all code changes, generate and run Drizzle migrations, then run smoke tests to verify everything works end-to-end.

### Sub-task 3C.1: Generate migration

```bash
cd dashboard && npx drizzle-kit generate
```

Expected migration will include:
- `CREATE TABLE transition_log (...)` (from Task 1A)

### Sub-task 3C.2: Apply migration

```bash
cd dashboard && npx drizzle-kit migrate
```

### Sub-task 3C.3: Smoke tests

| Test | How | Expected |
|------|-----|----------|
| State machine | PATCH /api/kanban/cards to move a card | Card moves + transition_log row created |
| Scheduler | GET /api/cron/scheduler with a stalled task | Task retried + message sent + activity logged |
| Activity stream | Call getEntityActivity(cardId, 'kanban') | Returns merged timeline from all 5 sources |
| Agent auth | Request without x-agent-id | 401 response |
| Agent auth | Request with unknown x-agent-id | 403 response |
| Agent auth | Request with valid agent, wrong entity type | 403 (permission denied) |
| Outbox | Create a card, check outbox_events table | Row exists with published=false |
| Outbox | GET /api/cron/outbox | Event relayed, published=true |
| Telegram | blockTask() with Telegram configured | Message received on Telegram |
| Validation | POST /api/kanban/cards with junk title | 422 with validation error |

### Sub-task 3C.4: TypeScript compilation

```bash
cd dashboard && npx tsc --noEmit
```

Must pass with zero errors.

**Dependencies:** All Phase 1 and Phase 2 tasks must be complete.

**Success criteria:**
- Drizzle migration applies cleanly
- `tsc --noEmit` passes with zero errors
- All smoke tests pass
- No regression in existing kanban card CRUD operations

---

# Dependency Graph

```
Phase 1 (all parallel):
  1A (transition_log schema)
  1B (agent-auth middleware)
  1C (outbox helper)
  1D (OpenClaw session reader)

Phase 2 (depends on Phase 1, parallel within):
  2A <- 1A  (wire recordTransition)
  2B        (scheduler wiring -- no Phase 1 dep)
  2C <- 1D  (activity stream fusion)
  2D <- 1B  (auth wiring)
  2E <- 1C  (outbox push endpoint)

Phase 3 (depends on all Phase 2, parallel within):
  3A        (input validation audit -- independent)
  3B        (Telegram notification -- independent)
  3C <- ALL (migrations + smoke tests -- must be last)
```

# Task Assignment Matrix (for Subagent Delegation)

| Phase | Task | Agent Type | Est. Complexity | Parallel? |
|-------|------|------------|-----------------|-----------|
| 1 | 1A: transition_log schema | deep (schema design) | Low | Yes |
| 1 | 1B: agent-auth middleware | deep (auth patterns) | Medium | Yes |
| 1 | 1C: outbox helper | deep (event systems) | Medium | Yes |
| 1 | 1D: OpenClaw session reader | deep (file I/O, parsing) | Medium | Yes |
| 2 | 2A: wire recordTransition() | unspecified-high (DB wiring) | Low | Yes |
| 2 | 2B: scheduler messaging | unspecified-high (agent messaging) | High | Yes |
| 2 | 2C: activity stream fusion | unspecified-high (multi-source merge) | High | Yes |
| 2 | 2D: wire auth into factory | unspecified-high (middleware) | Medium | Yes |
| 2 | 2E: outbox CRUD + push | unspecified-high (HTTP + WS) | Medium | Yes |
| 3 | 3A: input validation audit | unspecified-high (security audit) | Medium | Yes |
| 3 | 3B: Telegram blockTask notify | unspecified-high (external API) | Low | Yes |
| 3 | 3C: migrations + smoke tests | deep (QA, integration) | High | No (last) |

# File Change Summary

| File | Action | Phase | Pattern |
|------|--------|-------|---------|
| dashboard/drizzle/schema/operations/transition-log.ts | CREATE | 1A | 1 |
| dashboard/drizzle/schema/operations/index.ts | MODIFY | 1A | 1 |
| dashboard/lib/server/agent-auth.ts | CREATE | 1B | 4 |
| dashboard/lib/outbox-helper.ts | CREATE | 1C | 6 |
| dashboard/lib/outbox.ts | MODIFY | 1C | 6 |
| dashboard/lib/openclaw-sessions.ts | CREATE | 1D | 3 |
| dashboard/lib/state-transition.ts | MODIFY | 2A | 1 |
| dashboard/lib/scheduler.ts | MODIFY | 2B, 3B | 2 |
| dashboard/lib/activity-stream.ts | MODIFY | 2C | 3 |
| dashboard/lib/api/factory.ts | MODIFY | 2D | 4 |
| dashboard/app/api/events/push/route.ts | CREATE | 2E | 6 |
| dashboard/lib/ws-gateway-bridge.ts | CREATE | 2E | 6 |
| dashboard/lib/api/validation-templates.ts | CREATE | 3A | 8 |

**Total: 7 new files, 6 modified files.**

# Rollback Plan

If any task introduces breaking changes:

1. **Schema changes (1A)**: `drizzle-kit revert` to drop `transition_log` table. No data migration needed (table is append-only audit log).
2. **Auth changes (1B, 2D)**: Revert `factory.ts` to original `validateAgentAction()`. The old version throws `PermissionError` which route handlers already catch.
3. **Scheduler changes (2B, 3B)**: The scheduler is cron-triggered. Disable the cron job to stop new executions. Existing `monitor` JSON metadata is backward-compatible (extra fields ignored by old code).
4. **Activity stream (2C)**: `getEntityActivity()` already returns merged results. If a new source fails, it returns `[]` for that source (graceful degradation). Reverting `activity-stream.ts` restores the original behavior.
5. **Outbox (1C, 2E)**: If `publishEvent()` HTTP call fails, `relayOutbox()` retries. Reverting to `console.log` stub is safe but loses event publishing.
