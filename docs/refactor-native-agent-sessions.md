# Refactor Plan: Native Agent Sessions + Persistent Session Management (v2)

## Problem Analysis

### Problem 1: Session Bloat
**Root cause**: Three independent components each maintain their own in-memory session cache:
- `agent-executor.ts`: `sessionCache: Map<agentId, {sessionId, lastUsed}>` (line 35)
- `message-processor.ts`: `sessionCache: Map<agentId, AgentSessionCache>` (line 22)
- `telegram.ts`: `ocSessions: Map<chatId, Map<agentId, sessionId>>` (line 42)

On every service restart, all caches are lost → every agent creates a new session. With 8 agents × 30-min heartbeat, this produces 100+ orphaned sessions per day (confirmed via `/session` API — 80+ sessions visible).

### Problem 2: Prompt Injection Bloat
**Root cause**: Every `sendMessage` call concatenates the full system prompt (~15KB from `getPromptForRole()`) with wake context, memories, and user message:

```
telegram.ts:454    → ${systemPrompt}\n${injection}\n${wakeCtx}\n${text}  (~16KB)
agent-executor:289 → ${systemPrompt}\n${memorySection}\n${boardSummary}  (~17KB)
message-processor:155 → ${systemPrompt}\n${message.content}             (~15KB)
```

Each message sends the full prompt regardless of whether the agent already has it. For 8 agents × ~50 messages/day × 15KB = **6MB/day of redundant prompt tokens**.

### Problem 3: No Native Agent Identity
OpenCode sessions are created with default "build" agent. The system prompt is injected as user text, not as a native agent identity. This means:
- No prompt caching (system prompt changes every message → prefix mismatch → session fork)
- OpenCode logs confirm: `prefixCause: "system_prompt_changed"` causes session forking
- Agents lose their identity between restarts

## OpenCode Architecture Understanding (Updated)

### ACP (Agent Client Protocol) v1
OpenCode implements ACP v1 (`@agentclientprotocol/sdk`). Key protocol methods:
- `session/new` — Create new conversation session
- `session/load` — Resume existing session (basic support, full history restoration is future enhancement)
- `prompt` — Process incoming prompt and return response

The ACP layer maintains `cwd` context per session and supports MCP server configurations.

### HTTP REST API (what Strategos uses)
**Confirmed endpoints via testing:**
- `GET /config` — Server configuration
- `GET /session` — List all sessions
- `POST /session` — Create session (body: `{title?, agent?, mode?}`)
- `GET /session/:id` — Get session details
- `POST /session/:id/message` — Send message, wait for response (body: `{parts[], agent?, model?, system?, tools[]?}`)
- `POST /session/:id/prompt_async` — Send message async (body: `{parts[], agent?, noReply?, system?, tools[]?}`) — **Returns 204 No Content**
- `GET /event` — Server-Sent Events stream
- `DELETE /session/:id` — Delete session

**NOT available via HTTP REST** (web UI only):
- `POST /session/:id/prompt` — Returns HTML, not JSON

### Agent System
OpenCode supports two agent definition methods:

1. **Markdown files** in `~/.config/opencode/agent/{name}.md`:
```markdown
# agent-name

**Mode:** all|primary|subagent
**Color:**
**Description:** One-line description
**Primary Triggers:** When to use
**Do NOT use for:** When not to use

---

Full system instructions here...
```

2. **JSON config** in `opencode.json`:
```json
{
  "agent": {
    "agent-name": {
      "description": "...",
      "mode": "primary|subagent",
      "model": "provider/model",
      "prompt": "{file:./prompts/agent.txt}",
      "tools": {"write": true, "edit": true, "bash": true}
    }
  }
}
```

**Key discovery**: Agents can be specified per-message via `"agent": "agent-name"` in the request body of `/session/:id/message` and `/session/:id/prompt_async`. The agent's system prompt is loaded natively by OpenCode from the `.md` file, NOT from the message content.

### Session Context Management
- **Compaction**: OpenCode auto-compacts sessions when context window fills (`compaction.auto: true`)
- **Pruning**: Old tool outputs are pruned to save tokens (`compaction.prune: true`)
- **Reserved buffer**: Token buffer for compaction (`compaction.reserved: 10000`)
- **Prefix caching**: OpenCode uses prompt prefix caching for efficient context reuse. Changing the system prompt causes a cache miss and session fork (`prefixCause: "system_prompt_changed"`)
- **Session summarize**: AI-based session summarization available via SDK (`session.summarize()`)

### Plugin System
OpenCode supports plugins with hooks including:
- `experimental.session.compacting` — Inject custom context into compaction, or replace compaction prompt entirely

## Solution Architecture

### Core Principle
**Leverage OpenCode's native features** rather than fighting against them:
1. Native agent files for system prompts (loaded once by OpenCode)
2. Native session persistence (OpenCode stores sessions on disk)
3. Native context compaction (OpenCode manages context window)
4. Minimal delta injection only (memories + wake context + user message)

### Architecture Diagram

```
~/.config/opencode/
├── opencode.json                  (agent definitions — NOT global config changes)
├── agent/
│   ├── strategos-ceo.md           (native system prompt)
│   ├── coo-productivity.md
│   ├── cfo-financial.md
│   ├── cmo-content.md
│   ├── cro-relational.md
│   ├── cpso-health.md
│   ├── cpo-psychologist.md
│   └── cio-intelligence.md
└── prompts/
    └── (optional: external prompt files)

strategos/
├── src/scheduler/
│   ├── session-registry.ts        (NEW: persistent session mapping)
│   ├── agent-executor.ts          (REFACTORED: deltas only)
│   └── message-processor.ts       (REFACTORED: deltas only)
├── src/acp/
│   └── opencode-client.ts         (EXTENDED: agent parameter, context injection)
├── src/integrations/
│   └── telegram.ts                (REFACTORED: deltas only)
└── src/staff/
    └── prompts.ts                 (KEPT as source of truth, generates agent files)
```

## Implementation Phases

### Phase 1: Generate Native Agent Files from Existing Prompts

**Approach**: Use `getPromptForRole()` as the source of truth, generate `.md` agent files programmatically or manually.

**Agent file format** (verified from `strategos-orchestrator.md`):

```markdown
# strategos-ceo

**Mode:** all
**Color:** 
**Description:** CEO — Strategic leadership, portfolio oversight, and cross-agent coordination
**Primary Triggers:** User asks for strategic direction, OKR planning, project synthesis, cross-domain decisions
**Do NOT use for:** Domain-specific tasks (delegate to specialists), routine database queries

---

{Full prompt from getPromptForRole("strategos")}
```

**Agent definitions** (to be added to `~/.config/opencode/agent/`):

| Agent File | Agent ID | Source | Mode |
|-----------|----------|--------|------|
| `strategos-ceo.md` | `strategos-ceo` | `getPromptForRole("strategos")` | all |
| `coo-productivity.md` | `coo-productivity` | `getPromptForRole("coo-productivity")` | all |
| `cfo-financial.md` | `cfo-financial` | `getPromptForRole("cfo-financial")` | all |
| `cmo-content.md` | `cmo-content` | `getPromptForRole("cmo-content")` | all |
| `cro-relational.md` | `cro-relational` | `getPromptForRole("cro-relational")` | all |
| `cpso-health.md` | `cpso-health` | `getPromptForRole("cpso-health")` | all |
| `cpo-psychologist.md` | `cpo-psychologist` | `getPromptForRole("cpo-psychologist")` | all |
| `cio-intelligence.md` | `cio-intelligence` | `getPromptForRole("cio-intelligence")` | all |

**Key changes to prompts during conversion**:
- Remove redundant "You are {name}, the {title}" prefix (agent name handles identity)
- Keep all role-specific instructions, database access, tool definitions
- Keep all communication rules, workflow instructions, and examples
- Keep all LifeOS MCP tool references

**Verification**:
```bash
opencode agent list  # Should show all 8 new agents + build + plan
```

### Phase 2: Create Persistent Session Registry

**New file**: `src/scheduler/session-registry.ts`

```typescript
interface SessionRecord {
  agent_id: string;        // Maps to OpenCode agent name (e.g., "strategos-ceo")
  session_id: string;      // OpenCode session ID (e.g., "ses_abc123")
  chat_id: string | null;  // null for internal/heartbeat, chatId for Telegram
  title: string;           // Human-readable session title
  created_at: number;      // Unix timestamp
  last_used: number;       // Unix timestamp (updated on each message)
  message_count: number;   // Track session size for compaction triggers
}

class SessionRegistry {
  private db: Database;  // better-sqlite3 or existing SQLite

  /**
   * Get existing session or create new one.
   * One session per agent per chat context.
   * Reuses sessions across restarts.
   */
  async getOrCreate(agentId: string, context: { chatId?: string }): Promise<string>;

  /**
   * Mark session as used (update last_used, message_count)
   */
  async touch(sessionId: string): Promise<void>;

  /**
   * Invalidate a session (marks for recreation, doesn't delete from OpenCode)
   */
  async invalidate(agentId: string, chatId?: string): Promise<void>;

  /**
   * Cleanup old sessions (beyond max age or max count per agent)
   */
  async cleanup(options?: { maxAgeMs?: number; maxPerAgent?: number }): Promise<void>;

  /**
   * List all active sessions
   */
  async list(): Promise<SessionRecord[]>;

  /**
   * Get session record by OpenCode session ID
   */
  async findByOpenCodeSessionId(sessionId: string): Promise<SessionRecord | null>;
}
```

**Design decisions**:
- Use a separate `sessions.db` SQLite file in `~/.config/strategos/` or project data directory
- One row per (agent_id, chat_id) tuple — not per message
- Sessions persist across service restarts (OpenCode already persists sessions on disk)
- 30-min timeout is a **soft** threshold: prefer reusing existing session, create new only if session is unhealthy
- Track `message_count` to trigger proactive compaction before context window fills

**Session reuse logic**:
```
1. Look up (agentId, chatId) in registry
2. If found AND session exists in OpenCode (verify via GET /session/:id):
   → Return existing session_id
3. If found but OpenCode session is gone:
   → Remove stale record, create new session
4. If not found:
   → Create new OpenCode session, store in registry
```

### Phase 3: Extend OpenCode Client

**File**: `src/acp/opencode-client.ts`

**New methods**:

```typescript
class OpenCodeClient extends EventEmitter {
  /**
   * Send message with optional agent identity.
   * When agent is specified, OpenCode loads the agent's native system prompt.
   */
  async sendMessage(
    sessionId: string, 
    message: string, 
    options?: { agent?: string; system?: string }
  ): Promise<SendMessageResult>;

  /**
   * Inject context into session WITHOUT triggering AI response.
   * Uses POST /session/:id/prompt_async with noReply: true.
   * Useful for pre-loading memories, wake context before the actual message.
   */
  async injectContext(sessionId: string, context: string): Promise<void>;

  /**
   * Verify session exists and is healthy.
   */
  async verifySession(sessionId: string): Promise<boolean>;

  /**
   * Delete session from OpenCode.
   */
  async deleteSession(sessionId: string): Promise<void>;
}
```

**Implementation details**:

```typescript
async sendMessage(sessionId: string, message: string, options?: { agent?: string; system?: string }): Promise<SendMessageResult> {
  const body: any = {
    parts: [{ type: "text", text: message }],
  };
  if (options?.agent) body.agent = options.agent;
  if (options?.system) body.system = options.system;

  const response = await fetch(`${this.serverUrl}/session/${sessionId}/message`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // ... handle response (existing logic)
}

async injectContext(sessionId: string, context: string): Promise<void> {
  await fetch(`${this.serverUrl}/session/${sessionId}/prompt_async`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      noReply: true,
      parts: [{ type: "text", text: context }],
    }),
  });
  // Returns 204 No Content — context is injected, no AI response triggered
}
```

### Phase 4: Refactor All Entry Points

#### 4a. `src/integrations/telegram.ts` (lines 398-519)

**Before**:
```
1. ensureAcPSession(chatId, agentId) → creates new session every restart
2. getPromptForRole(agentId) → ~15KB system prompt
3. memoryFacade.injectForSession(agentId, text, systemPrompt, wakeCtx)
4. Concatenate: systemPrompt + injection + wakeCtx + text → ~16KB message
5. acp.sendMessage(sessionId, prompt) → full prompt sent every time
```

**After**:
```
1. sessionRegistry.getOrCreate(agentId, { chatId }) → persistent session
2. acp.verifySession(sessionId) → ensure session is healthy
3. Build delta only:
   - Memory injection (relevant memories)
   - Wake context summary
   - User message
   Total: ~1-2KB
4. acp.sendMessage(sessionId, delta, { agent: agentId }) → native agent loads system prompt
5. sessionRegistry.touch(sessionId) → update last_used
```

**Code change**:
```typescript
// Replace lines 438-480
const sessionRegistry = await getSessionRegistry();
const acpSessionId = await sessionRegistry.getOrCreate(agentId, { chatId });

// Verify session is still valid in OpenCode
if (!(await acp.verifySession(acpSessionId))) {
  await sessionRegistry.invalidate(agentId, chatId);
  acpSessionId = await sessionRegistry.getOrCreate(agentId, { chatId });
}

// Build delta only (no system prompt)
const memoryInjection = await memoryFacade.injectForDelta(agentId, text);
const delta = [
  memoryInjection,
  `---`,
  `[User Message]`,
  text,
  `[/User Message]`,
].filter(Boolean).join('\n');

// Send with native agent identity
const result = await acp.sendMessage(acpSessionId, delta, { agent: agentId });

await sessionRegistry.touch(acpSessionId);
```

#### 4b. `src/scheduler/agent-executor.ts`

**Heartbeat flow** (lines 156-221):

**Before**: `buildProactiveWorkPrompt` returns full system prompt + board + inbox + instructions (~17KB)

**After**: Build context delta only (~2KB), pass agent identity:

```typescript
private async runAgentHeartbeat(agentId: string, acp: any, messaging: any): Promise<void> {
  const staff = getStaffById(agentId);
  if (!staff || staff.autonomyLevel < 2) return;

  const sessionId = await this.sessionRegistry.getOrCreate(agentId, {});
  if (!(await acp.verifySession(sessionId))) {
    await this.sessionRegistry.invalidate(agentId);
    sessionId = await this.sessionRegistry.getOrCreate(agentId, {});
  }

  const board = await this.kanban.getBoard(agentId);
  const inbox = await messaging.getActiveContext(agentId);
  
  // Delta only — agent already knows its role from native system prompt
  const delta = this.buildHeartbeatDelta(agentId, staff, board, inbox);
  
  const result = await acp.sendMessage(sessionId, delta, { agent: agentId });
  await this.sessionRegistry.touch(sessionId);
  
  // ... handle result (existing logic)
}

private buildHeartbeatDelta(agentId: string, staff: any, board: any, inbox: any): string {
  const lines: string[] = [];
  
  // Current state — not "who you are"
  lines.push(`## Domain Check — ${staff.name}`);
  lines.push('');
  
  if (board) {
    lines.push(`### Kanban`);
    lines.push(this.summarizeBoard(board));
    lines.push('');
  }
  
  if (inbox.unread_count > 0) {
    lines.push(`### Inbox: ${inbox.unread_count} unread, ${inbox.pending_responses.length} pending`);
    if (agentId === 'strategos') {
      lines.push('⚠️ READ AGENT REPORTS FIRST before doing anything else.');
    }
    lines.push('');
  }
  
  // Action directives (not role definition)
  lines.push('## What to do:');
  lines.push(`1. Query your databases for anything needing attention`);
  lines.push(`2. Check Kanban for blocked/stale cards`);
  lines.push(`3. Take action if needed (update cards, send messages)`);
  lines.push(`4. Store findings in memory`);
  
  return lines.join('\n');
}
```

**Message response flow** (lines 88-131):

Similar pattern — build delta, pass agent identity.

#### 4c. `src/scheduler/message-processor.ts`

**Before** (lines 147-175): `buildAgentResponsePrompt` returns full system prompt + message

**After**:
```typescript
private buildAgentResponseDelta(message: any, wakeCtx: any): string {
  const staff = getStaffById(message.from);
  const fromName = staff ? `${staff.avatar} ${staff.name}` : message.from;
  
  const lines: string[] = [
    `## Message from ${fromName}`,
    `Priority: ${message.priority}`,
    `Thread: ${message.thread_id}`,
    '',
    message.content,
  ];
  
  if (wakeCtx.summary) {
    lines.push('');
    lines.push(`## Your Context`);
    lines.push(wakeCtx.summary);
  }
  
  return lines.join('\n');
}

// In processAgent:
const delta = this.buildAgentResponseDelta(msg, wakeCtx);
const result = await acp.sendMessage(sessionId, delta, { agent: message.to });
```

### Phase 5: Remove Redundant Session Caches

**Remove**:
- `agent-executor.ts`: `sessionCache` Map (line 35) and `ensureAgentSession` method (lines 392-408)
- `message-processor.ts`: `sessionCache` Map (line 22) and `ensureAgentSession` method (lines 130-145)
- `telegram.ts`: `ocSessions` Map (line 42) and `ensureAcPSession` function (lines 58-73)

**Replace**: All three use `SessionRegistry` singleton.

### Phase 6: MemoryFacade Delta Injection

**New method** in MemoryFacade:

```typescript
/**
 * Inject relevant memories for a session delta.
 * Does NOT include system prompt — that's loaded natively by OpenCode agent.
 */
async injectForDelta(agentId: string, queryText: string): Promise<string> {
  const memories = await this.searchRelevant(agentId, queryText);
  if (!memories.length) return '';
  
  return [
    `## Relevant Context from Memory`,
    ...memories.map((m, i) => `${i + 1}. ${m.content}`),
  ].join('\n');
}
```

### Phase 7: Session Health & Auto-Healing

**Problem**: OpenCode sessions can become stale or corrupted. The registry needs to detect and recover.

**Health check on startup**:
```typescript
async startup(): Promise<void> {
  const sessions = await this.list();
  for (const session of sessions) {
    const healthy = await acp.verifySession(session.session_id);
    if (!healthy) {
      logger.warn({ sessionId: session.session_id, agentId: session.agent_id }, 'Stale session detected, invalidating');
      await this.invalidate(session.agent_id, session.chat_id || undefined);
    }
  }
}
```

**Compaction awareness**:
```typescript
// Track message count per session
// When approaching context window limits, trigger proactive summarization
async shouldCompact(sessionId: string): Promise<boolean> {
  const session = await this.findByOpenCodeSessionId(sessionId);
  if (!session) return false;
  
  // OpenCode handles auto-compaction, but we can trigger it proactively
  // for long-lived agent sessions that accumulate many heartbeats
  return session.message_count > 50; // Threshold before 262K context window fills
}
```

## Token Savings Estimate

| Scenario | Before | After | Savings |
|----------|--------|-------|---------|
| Telegram message (1 agent) | ~16KB prompt + 1KB delta | ~1KB delta | **94%** |
| Heartbeat (8 agents) | ~17KB × 8 = 136KB | ~2KB × 8 = 16KB | **88%** |
| Inter-agent message | ~15KB prompt + 0.5KB | ~0.5KB delta | **97%** |

**Daily savings** (estimated 50 Telegram messages + 48 heartbeats + 20 inter-agent):
- Before: ~3.5MB/day in prompt tokens
- After: ~0.2MB/day in delta tokens
- **Savings: ~3.3MB/day (~94%)**

**Additional savings from prompt caching**: OpenCode's prefix caching means the agent system prompt is cached on disk. With native agents, the cache key is stable (agent name doesn't change). Previously, changing context on every message caused `prefixCause: "system_prompt_changed"` → cache miss → session fork → new full prompt send.

## Files Changed

| File | Action | Lines Changed |
|------|--------|---------------|
| `~/.config/opencode/agent/strategos-ceo.md` | Create | ~300 |
| `~/.config/opencode/agent/coo-productivity.md` | Create | ~300 |
| `~/.config/opencode/agent/cfo-financial.md` | Create | ~300 |
| `~/.config/opencode/agent/cmo-content.md` | Create | ~350 |
| `~/.config/opencode/agent/cro-relational.md` | Create | ~300 |
| `~/.config/opencode/agent/cpso-health.md` | Create | ~300 |
| `~/.config/opencode/agent/cpo-psychologist.md` | Create | ~300 |
| `~/.config/opencode/agent/cio-intelligence.md` | Create | ~320 |
| `src/scheduler/session-registry.ts` | Create | ~200 |
| `src/acp/opencode-client.ts` | Modify | +40 |
| `src/integrations/telegram.ts` | Modify | -40, +30 |
| `src/scheduler/agent-executor.ts` | Modify | -80, +60 |
| `src/scheduler/message-processor.ts` | Modify | -50, +30 |

**Total**: ~3,000 lines (mostly new agent definition files, net reduction in existing code)

## Risks & Mitigations

1. **Agent file format changes**: OpenCode may update the agent file spec. Mitigation: Pin the format, test after updates, use the simplest format (frontmatter + markdown body).

2. **Session corruption**: SQLite corruption could lose session mappings. Mitigation: WAL mode, auto-recreate on failure, health check on startup.

3. **Agent identity mismatch**: If agent ID in code doesn't match agent file name. Mitigation: Validation on startup, log warning if `opencode agent list` doesn't include expected agents.

4. **OpenCode version compatibility**: The `agent` parameter in message API may change. Mitigation: Graceful fallback to prompt injection if agent parameter fails (detect via response inspection).

5. **Context window overflow**: Long-lived sessions with many heartbeats could fill the 262K context window. Mitigation: Track `message_count`, trigger proactive compaction, or rotate sessions after N messages.

6. **Concurrent message race**: Two simultaneous messages to same agent could both try to create sessions. Mitigation: SessionRegistry uses SQLite with exclusive locks, `getOrCreate` is atomic.

## Testing Strategy

1. **Unit**: SessionRegistry CRUD operations, atomic getOrCreate
2. **Integration**: Verify `opencode agent list` shows all 8 agents
3. **E2E**: Send Telegram message → verify agent responds with correct identity (check `"agent":"agent-name"` in response)
4. **Load**: Run heartbeat for 2 hours → verify session count stays at 8 (not growing)
5. **Restart**: Kill service, restart → verify sessions are reused, not recreated
6. **Token audit**: Log input token counts before/after refactor to verify ~94% reduction
7. **Health check**: Corrupt a session in OpenCode, verify auto-healing on next message

## Migration Plan

1. **Deploy agent files first** — No code changes needed, just verify `opencode agent list` shows them
2. **Deploy SessionRegistry** — Runs in parallel with existing caches, logs differences
3. **Switch entry points one by one** — Telegram first (highest impact), then agent-executor, then message-processor
4. **Remove old caches** — After all entry points use SessionRegistry, delete the Maps
5. **Monitor** — Watch session count, token usage, error rates for 48 hours
