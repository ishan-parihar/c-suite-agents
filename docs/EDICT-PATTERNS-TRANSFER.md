# Edict Architecture Patterns — Transfer to Operant

> Reflection on what edict's OpenClaw-specific Python backend teaches us, and which patterns elevate Operant's operational capacity.

---

## Executive Summary

Edict has **two independent backend modes** that share a state machine but differ fundamentally in architecture:

| Mode | Stack | Storage | Real-time | Use Case |
|------|-------|---------|-----------|----------|
| **JSON File Backend** | Python stdlib `http.server` (2800 lines) | Flat JSON files with `fcntl` locks | 15s polling | Default/Docker users |
| **FastAPI Backend** | FastAPI + SQLAlchemy + Redis | PostgreSQL + Redis Streams | WebSocket + Pub/Sub | Heavy usage, production |

Operant should borrow **concepts, not code**. Our stack (Next.js 16 + Drizzle + PostgreSQL) is fundamentally more capable than edict's stdlib server, but edict's architectural patterns are battle-tested.

---

## 1. State Machine (TRANSFER: HIGH)

### What Edict Does

14-state enum with explicit transition table:

```
Pending → Taizi → Zhongshu → Menxia → Assigned → Doing/Next → Review → Done/Cancelled
                              ↑                                        │
                              └────────── reject ──────────────────────┘
                              ↕ Blocked (universal hub)
```

Key properties:
- **`STATE_TRANSITIONS` dictionary** — each state maps to a `Set` of allowed next states
- **Terminal states** (`Done`, `Cancelled`) have empty sets — immutable
- **`Blocked` is a hub** — can transition to ANY non-terminal state (universal pause/resume)
- **`PendingConfirm`** — intermediate state for risky operations (two-phase commit)
- **Row-level locking** — `SELECT FOR UPDATE` prevents concurrent flow_log corruption
- **Auto-dispatch** — each state maps to an agent via `_STATE_AGENT_MAP`

### What Operant Should Borrow

```typescript
// lib/task-state-machine.ts

export const TaskState = {
  Draft: 'draft',
  Active: 'active',
  InProgress: 'in_progress',
  Review: 'review',
  Done: 'done',
  Cancelled: 'cancelled',
  Blocked: 'blocked',
} as const;

export const STATE_TRANSITIONS: Record<TaskState, Set<TaskState>> = {
  draft:      new Set(['active', 'cancelled']),
  active:     new Set(['in_progress', 'blocked', 'cancelled']),
  in_progress: new Set(['review', 'done', 'blocked', 'cancelled']),
  review:     new Set(['done', 'in_progress', 'blocked', 'cancelled']),
  done:       new Set(),              // terminal
  cancelled:  new Set(),              // terminal
  blocked:    new Set(['active', 'in_progress', 'review']),  // hub
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return STATE_TRANSITIONS[from]?.has(to) ?? false;
}
```

Add Zod validation on every state change:
```typescript
const TaskTransitionSchema = z.object({
  taskId: z.string().uuid(),
  from: z.enum(Object.values(TaskState) as [TaskState]),
  to: z.enum(Object.values(TaskState) as [TaskState]),
  reason: z.string().max(500),
}).refine(data => canTransition(data.from, data.to), {
  message: `Invalid transition: ${data.from} → ${data.to}`,
});
```

### Why This Matters

Operant's current Drizzle schema has task tables but **state transitions are implicit** — enforced by application logic scattered across server actions. Making them explicit:
- Single source of truth for what transitions are legal
- Zod rejects illegal transitions at the API boundary
- Terminal state protection is enforced by the data structure (empty sets)
- `Blocked` as hub eliminates the need for `_prev_state` storage

---

## 2. Scheduler with 4-Stage Recovery (TRANSFER: HIGH)

### What Edict Does

Every 60s, the OrchestratorWorker scans for stalled tasks:

```
Stall detected (no progress for N seconds)
  ↓
Stage 1: RETRY (up to maxRetry=2)
  → Re-dispatch to same agent
  → Backoff: 30s, 60s
  ↓ (if still stalled)
Stage 2: ESCALATE (up to maxLevel=3)
  → Level 1: Notify coordinator agent
  → Level 2: Notify senior coordinator
  → Level 3: Notify top-level agent
  ↓ (if still stalled)
Stage 3: ROLLBACK
  → Restore to last snapshot state
  → Reset retry/escalation counters
  ↓ (if still stalled after max rollbacks)
Stage 4: BLOCK
  → Mark as Blocked, requires human intervention
```

Each task embeds `_scheduler` metadata:
```json
{
  "_scheduler": {
    "enabled": true,
    "stallThresholdSec": 600,
    "maxRetry": 2,
    "retryCount": 0,
    "escalationLevel": 0,
    "autoRollback": true,
    "lastProgressAt": "2026-04-11T...",
    "stallSince": null,
    "snapshot": { "state": "active", "org": "...", "savedAt": "..." }
  }
}
```

### What Operant Should Borrow

```typescript
// lib/scheduler.ts

interface SchedulerState {
  enabled: boolean;
  stallThresholdMs: number;        // default: 600_000 (10 min)
  maxRetry: number;                // default: 2
  retryCount: number;
  escalationLevel: number;
  maxEscalationLevel: number;      // default: 3
  autoRollback: boolean;
  maxRollback: number;             // default: 3
  lastProgressAt: string;
  stallSince: string | null;
  snapshot: { state: TaskState; savedAt: string } | null;
}

async function scanStalledTasks() {
  const stalled = await db.query.tasks.findMany({
    where: and(
      notIn(tasks.state, ['done', 'cancelled', 'blocked']),
      lt(tasks.updatedAt, new Date(Date.now() - stallThresholdMs))
    ),
  });

  for (const task of stalled) {
    const sched = task.scheduler;
    if (sched.retryCount < sched.maxRetry) {
      await retryTask(task);
    } else if (sched.escalationLevel < sched.maxEscalationLevel) {
      await escalateTask(task);
    } else if (sched.autoRollback && sched.snapshot) {
      await rollbackTask(task, sched.snapshot.state);
    } else {
      await blockTask(task, 'All automated recovery exhausted');
    }
  }
}
```

Run via cron or a lightweight loop:
```typescript
// app/api/cron/scheduler/route.ts
import { scanStalledTasks } from '@/lib/scheduler';

export async function GET() {
  await scanStalledTasks();
  return Response.json({ ok: true });
}
```

### Why This Matters

Operant's AI agents can stall, crash, or enter infinite loops. Without automated recovery:
- Users see "stuck" tasks with no recourse
- Manual intervention is required for every failure
- No audit trail of what went wrong

The 4-stage recovery pipeline means **most failures self-heal** without user involvement.

---

## 3. Activity Stream Fusion (TRANSFER: MEDIUM)

### What Edict Does

Three data sources fused into a unified timeline per task:

| Source | What It Captures | Granularity |
|--------|-----------------|-------------|
| `flow_log` | State transitions | Event-level |
| `progress_log` | Agent progress reports + todos + cost | ~30min intervals |
| `session JSONL` | Agent thinking + tool calls + results | Message-level |

The fusion produces ~59 activity entries per task, giving complete visibility into what happened.

### What Operant Should Borrow

```typescript
// lib/activity-stream.ts

type ActivityKind = 
  | 'state_change'    // from Drizzle state transitions
  | 'crud_event'      // from Drizzle CRUD operations  
  | 'progress'        // from agent progress reports
  | 'agent_thinking'  // from OpenClaw session files
  | 'agent_tool'      // from OpenClaw tool calls
  | 'scheduler_action' // from recovery pipeline
  | 'user_action';    // from user interactions

interface ActivityEntry {
  at: string;              // ISO 8601
  kind: ActivityKind;
  taskId: string;
  entityId: string;
  entityType: 'goal' | 'task' | 'meeting' | 'journal';
  agentId?: string;
  userId?: string;
  data: Record<string, unknown>;
}

async function getEntityActivity(entityId: string, entity: EntityType) {
  const dbEvents = await getActivityFromDrizzle(entityId);
  const agentEvents = await getActivityFromOpenClaw(entityId);
  const schedulerEvents = await getSchedulerEvents(entityId);
  
  return [...dbEvents, ...agentEvents, ...schedulerEvents]
    .sort((a, b) => a.at.localeCompare(b.at));
}
```

### Why This Matters

Users want to see **what happened** to their goals/tasks/meetings. A unified timeline merges:
- "Goal created by user"
- "Agent updated goal status"
- "Task stalled, retry triggered"
- "Agent completed subtask"

Without fusion, each data source is a separate UI panel. With fusion, it's one coherent story.

---

## 4. Agent Permission Matrix (TRANSFER: HIGH)

### What Edict Does

```python
AGENT_POLICY = {
    "taizi":    {"role": "coordination", "commands": {"create", "state", "flow", "progress"}},
    "zhongshu": {"role": "coordination", "commands": {"state", "flow", "progress", "delegate"}},
    "bingbu":   {"role": "execution",    "commands": {"progress", "todo", "done", "block"}},
}
```

Each agent has:
- A **role** (coordination vs execution)
- A **command allowlist** (what operations it can perform)
- Unknown agents are NOT blocked (forward compatibility)

### What Operant Should Borrow

```typescript
// lib/agent-permissions.ts

export const AgentRole = {
  Coordinator: 'coordinator',
  Executor: 'executor',
  Observer: 'observer',
} as const;

export const AGENT_POLICY: Record<string, {
  role: AgentRole;
  canRead: EntityType[];
  canWrite: EntityType[];
  canDelete: EntityType[];
  canDispatch: string[];  // which other agents this agent can trigger
}> = {
  'goals-agent': {
    role: 'coordinator',
    canRead: ['goal', 'task', 'journal'],
    canWrite: ['goal', 'task'],
    canDelete: [],
    canDispatch: ['tasks-agent', 'meetings-agent'],
  },
  'tasks-agent': {
    role: 'executor',
    canRead: ['task', 'goal'],
    canWrite: ['task'],
    canDelete: ['task'],
    canDispatch: [],
  },
  // ...
};
```

Middleware enforcement:
```typescript
// lib/server/agent-auth.ts

export function assertAgentCan(agentId: string, action: 'read' | 'write' | 'delete', entityType: EntityType) {
  const policy = AGENT_POLICY[agentId];
  if (!policy) return; // Unknown agents not blocked (forward compat)
  
  const allowed = policy[`can${action.charAt(0).toUpperCase() + action.slice(1)}`];
  if (!allowed.includes(entityType)) {
    throw new PermissionError(`${agentId} cannot ${action} ${entityType}`);
  }
}
```

### Why This Matters

Operant will have multiple AI agents operating on shared data. Without a permission matrix:
- Any agent can modify any entity
- No audit trail of who was authorized to do what
- Rogue agents can corrupt data across domains

The permission matrix ensures **agent actions are scoped to their domain**.

---

## 5. Delegation with Anti-Deadlock (TRANSFER: MEDIUM)

### What Edict Does

```python
MAX_DELEGATION_DEPTH = 3

def cmd_delegate(task_id, from_agent, to_agent, instruction):
    depth = parent_delegation.get('depth', 0) + 1
    path = parent_delegation.get('path', []) + [to_agent]
    
    if depth > MAX_DELEGATION_DEPTH:
        reject("Delegation depth exceeded")
    if to_agent in path[:-1]:
        reject("Circular delegation detected")
```

### What Operant Should Borrow

```typescript
// lib/delegation.ts

const MAX_DELEGATION_DEPTH = 3;

interface DelegationContext {
  depth: number;
  path: string[];  // agent IDs
}

function validateDelegation(ctx: DelegationContext, targetAgent: string): Result {
  if (ctx.depth >= MAX_DELEGATION_DEPTH) {
    return { ok: false, error: `Max delegation depth (${MAX_DELEGATION_DEPTH}) exceeded` };
  }
  if (ctx.path.includes(targetAgent)) {
    return { ok: false, error: `Circular delegation detected: ${[...ctx.path, targetAgent].join(' → ')}` };
  }
  return { ok: true };
}
```

### Why This Matters

When agents delegate work to other agents, infinite loops are possible:
- Agent A delegates to B → B delegates to C → C delegates back to A

Depth limit + cycle detection prevents this.

---

## 6. Transactional Outbox Pattern (TRANSFER: HIGH for FastAPI mode)

### What Edict Does

The FastAPI backend uses the Transactional Outbox pattern:

```
1. Start DB transaction
2. INSERT/UPDATE task row
3. INSERT into outbox_events table (same transaction)
4. COMMIT → both task and outbox event are atomic
5. OutboxRelay worker polls for unpublished events
6. Publishes to Redis Streams → marks published=true
```

This eliminates the classic dual-write problem where the DB write succeeds but the event publish fails.

### What Operant Should Borrow

With Drizzle + PostgreSQL:

```typescript
// lib/outbox.ts

async function withOutbox(tx: AnyDrizzleTransaction, event: OutboxEvent) {
  await tx.insert(outboxEvents).values({
    eventType: event.type,
    entityId: event.entityId,
    entityType: event.entityType,
    payload: event.payload,
    published: false,
    attempts: 0,
  });
}

// Usage in server action:
await db.transaction(async (tx) => {
  await tx.update(goals).set({ state: 'done' }).where(eq(goals.id, goalId));
  await withOutbox(tx, {
    type: 'goal.completed',
    entityId: goalId,
    entityType: 'goal',
    payload: { title: goal.title },
  });
});
```

Polling worker (cron or setInterval):
```typescript
async function relayOutbox() {
  const unpublished = await db.query.outboxEvents.findMany({
    where: and(
      eq(outboxEvents.published, false),
      lt(outboxEvents.attempts, 5),
    ),
    limit: 50,
    orderBy: asc(outboxEvents.createdAt),
  });

  for (const event of unpublished) {
    try {
      await publishToRedis(event);
      await db.update(outboxEvents)
        .set({ published: true })
        .where(eq(outboxEvents.id, event.id));
    } catch {
      await db.update(outboxEvents)
        .set({ attempts: event.attempts + 1 })
        .where(eq(outboxEvents.id, event.id));
    }
  }
}
```

### Why This Matters

When Operant needs real-time event propagation (WebSocket updates, SSE, inter-service communication), the outbox pattern guarantees **no lost events** even if the publish fails. The event is persisted in the same transaction as the data change.

---

## 7. Fast/Slow Bucket Concurrency (TRANSFER: LOW for Now)

### What Edict Does

```python
"fast":  {agents: taizi, zhongshu, menxia, shangshu}  limit=4
"slow":  {agents: hubu, libu, bingbu, xingbu, gongbu} limit=3
```

Prevents heavy execution agents from starving lightweight coordination agents.

### What Operant Should Borrow

Later, when Operant has multiple agent types with different resource profiles. For now, not needed.

---

## 8. Input Validation & Sanitization (TRANSFER: MEDIUM)

### What Edict Does

```python
def _sanitize_text(raw, max_len=80):
    # Strip file paths, URLs, metadata prefixes
    t = re.split(r'\n*Conversation\b', t, maxsplit=1)[0].strip()
    t = re.split(r'\n*```', t, maxsplit=1)[0].strip()
    t = re.sub(r'[/\\.~][A-Za-z0-9_\-./]+(?:\.(?:py|js|ts|...))?', '', t)
    t = re.sub(r'https?://\S+', '', t)
    t = re.sub(r'^(传旨|下旨)[：:\uff1a]\s*', '', t)
    t = re.sub(r'(message_id|session_id|...)\s*[:=]\s*\S+', '', t)
    t = re.sub(r'\s+', ' ', t).strip()
    if len(t) > max_len: t = t[:max_len] + '…'
    return t
```

Junk title detection:
```python
_JUNK_TITLES = {'?', '好', '好的', 'ok', 'yes', 'no', '测试', ...}
```

### What Operant Should Borrow

```typescript
// lib/sanitize.ts

export function sanitizeInput(raw: string, maxLen: number = 200): string {
  let t = raw.trim();
  // Strip code blocks
  t = t.split(/```/)[0].trim();
  // Strip URLs
  t = t.replace(/https?:\/\/\S+/g, '');
  // Strip system metadata
  t = t.replace(/(message_id|session_id|chat_id|open_id)\s*[:=]\s*\S+/g, '');
  // Normalize whitespace
  t = t.replace(/\s+/g, ' ').trim();
  // Truncate
  if (t.length > maxLen) t = t.slice(0, maxLen) + '…';
  return t;
}

const JUNK_TITLES = new Set(['?', 'ok', 'yes', 'no', 'test', 'testing', '...']);

export function isValidTitle(title: string): Result {
  const cleaned = sanitizeInput(title, 200);
  if (cleaned.length < 3) return { ok: false, error: 'Title too short' };
  if (JUNK_TITLES.has(cleaned.toLowerCase())) return { ok: false, error: 'Invalid title' };
  return { ok: true, cleaned };
}
```

### Why This Matters

Operant's CRUD operations accept user and agent input. Without sanitization:
- Garbage data enters the database
- Agent outputs with metadata pollution create unreadable titles
- Code injection via titles/descriptions is possible

---

## 9. What's NOT Transferable

| Edict Feature | Why Not Transfer |
|---------------|-----------------|
| Imperial metaphor (皇上, 太子, 圣旨) | Irrelevant to professional workspace |
| Python stdlib server | Next.js App Router is vastly more capable |
| SOUL.md personality files | Operant has its own agent architecture |
| Notification channels (Feishu, Telegram) | Operant will have its own notification layer |
| Morning brief / news aggregation | Feature bloat, not core to CRUD |
| Court discussion LLM debates | Gimmicky, low practical value |
| Flat JSON file storage | Operant uses PostgreSQL via Drizzle |
| 15s short-polling | Operant will use SSE or WebSocket |

---

## 10. OpenClaw Integration Points

Operant is built on OpenClaw. Edict shows us **how to integrate**:

### What OpenClaw Provides
- **Agent gateway** — WebSocket-based communication (port 18789)
- **Session management** — JSONL files per agent at `~/.openclaw/agents/{id}/sessions/`
- **Skill system** — `SKILL.md` files that extend agent capabilities
- **Workspace isolation** — `~/.openclaw/workspace-{agent_id}/`
- **Subagent permissions** — `allowAgents` in `openclaw.json`

### What Operant Should Do
1. **Read** agent sessions from `~/.openclaw/agents/{id}/sessions/*.jsonl`
2. **Write** task state changes that trigger agent dispatches via `openclaw agent --agent {id} -m "{msg}"`
3. **Monitor** agent health via gateway HTTP probe + session timestamps
4. **Extend** with CRUD operations that agents can use as skills

### What Operant Should NOT Do
- Duplicate OpenClaw's agent management
- Reimplement the gateway protocol
- Copy SOUL.md patterns

---

## 11. Strategic Recommendation

### Borrow the architecture, not the implementation

| Pattern | Edict | Operant Implementation |
|---------|-------|----------------------|
| State machine | Python dict + enum | TypeScript const + Zod |
| Scheduler | asyncio loop + Redis | Node.js cron + Drizzle queries |
| Activity fusion | flow_log + progress_log + JSONL | Drizzle events + OpenClaw sessions |
| Permission matrix | AGENT_POLICY dict | TypeScript const + middleware |
| Delegation tracking | depth + path fields | Foreign keys + cycle detection |
| Outbox pattern | OutboxEvent table + relay worker | Drizzle table + polling route |
| Input validation | Regex sanitization | Zod schemas + sanitizeInput() |

### Reference priorities
1. **openclaw-mission-control** — Best technical reference (same stack: Next.js 16 + FastAPI + SQLModel + PostgreSQL)
2. **edict** — Best conceptual reference (state machines, scheduler, permissions)
3. **Star-Office-UI** — Skip (gimmicky, no CRUD patterns)
4. **BlockNote** — Block editor integration only

---

## 12. Next Steps

1. Add state machine const + Zod schemas to existing Drizzle schemas
2. Design the scheduler as a cron endpoint with retry/escalate/rollback
3. Create permission matrix for existing agent types
4. Add input validation/sanitization to all CRUD server actions
5. Plan activity stream fusion for unified entity timelines
