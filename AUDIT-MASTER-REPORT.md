# Multi-Agent System Audit: Master Report

**Date:** 2026-04-03  
**Audit Scope:** Agent Conversation, Memory Isolation, Team Behavior  
**Auditors:** 3 specialized sub-agents (explore type)  
**Severity Scale:** 🔴 Critical | 🟡 High | 🟢 Medium | ⚪ Low

---

## Executive Summary

The Strategos multi-agent system has **excellent architectural foundations** but **critical implementation gaps** that prevent autonomous team operation. The system is like building a corporate headquarters with offices, phones, and org charts—but no employees who show up to work unless personally summoned.

### Key Findings

| Area | Infrastructure | Autonomous Operation | Security |
|------|---------------|---------------------|----------|
| **Agent Conversation** | ✅ Complete (MCP tools, messaging, threads) | ❌ No runtime loop | ⚠️ No auth |
| **Memory Isolation** | ✅ Schema-level separation | ❌ No validation | 🔴 SQL injection everywhere |
| **Team Behavior** | ✅ Full org structure, roles, governance | ❌ Reactive only | ⚠️ No authorization |

### Critical Blockers

1. **No Agent Execution Loop** - Agents only run when user sends Telegram message
2. **SQL Injection Vulnerabilities** - 20+ instances across all database files
3. **No Authentication/Authorization** - Any agent can impersonate another
4. **Message Queue Never Processed** - Agent inboxes fill but never checked
5. **Proactive Behavior is Aspirational** - Prompts instruct but no mechanism exists

---

## Part 1: Agent-to-Agent Conversation Audit

### Current State: What Works ✅

| Component | Status | Details |
|-----------|--------|---------|
| `agent.call` tool | ✅ Implemented | Send message with priority, requires_response |
| `agent.handoff` tool | ✅ Implemented | Transfer conversation context |
| `agent.meeting` tool | ✅ Implemented | Call board meeting with voting |
| Message threads | ✅ Implemented | Full threading with participants tracking |
| Vector search | ✅ Implemented | 70% vector + 30% keyword search |
| Message escalation | ✅ Implemented | Formal escalation to managers |
| OpenCode HTTP client | ✅ Implemented | Session management per agent |

### Critical Gaps ❌

#### Gap 1: No Message Processing Loop (CRITICAL)

**Problem:** Messages sent between agents are stored but **never trigger processing**.

**Missing Code:**
```typescript
// THIS DOES NOT EXIST:
setInterval(async () => {
  for (const agentId of getCoreStaffIds()) {
    const context = await messaging.getActiveContext(agentId);
    if (context.pending_responses.length > 0) {
      // Wake up agent and process responses
    }
  }
}, 30000);
```

**Impact:** Agent-to-agent messaging is "write-only" - messages go into the void.

**File:** System-wide gap  
**Fix:** Create `src/scheduler/message-processor.ts`

---

#### Gap 2: No Agent Session Management (CRITICAL)

**Problem:** OpenCode sessions tied to `chat_id + agent_id`. No model for agent-only conversations.

**Current:** `src/integrations/telegram.ts:59`
```typescript
const sessionKey = `${chatId}:${agentId}`;  // Requires user chat
```

**Needed:**
```typescript
const sessionKey = `agent:${agentA}:${agentB}:${threadId}`;  // Agent-only
```

**File:** `src/integrations/telegram.ts`, `src/mcp/tools-reports.ts`  
**Fix:** Add agent session table and management functions

---

#### Gap 3: Proactive Instructions Only Target Users (HIGH)

**Problem:** System prompts only mention messaging users, not collaborating with agents.

**Current:** `src/staff/prompts.ts:126-138`
```
Example proactive messages:
- "Hey, noticed Q4 planning is due next week. Want to block time for it?"
```

**Missing:** Instructions for inter-agent collaboration like:
- "If you need input from another agent, use agent.call"
- "When blocked, escalate to your manager via message.escalate"

**File:** `src/staff/prompts.ts`  
**Fix:** Add inter-agent collaboration section to prompts

---

### Recommendations: Agent Conversation

| Priority | Action | File(s) | Effort |
|----------|--------|---------|--------|
| 🔴 P1 | Create message processor loop | New: `src/scheduler/message-processor.ts`, Update: `src/index.ts` | 2-3h |
| 🔴 P1 | Add agent session management | Update: `src/mcp/tools-reports.ts`, Add DB table | 1-2h |
| 🟡 P2 | Update prompts for inter-agent collaboration | Update: `src/staff/prompts.ts` | 30min |
| 🟡 P2 | Add message event emitter | Update: `src/organic/messaging.ts` | 1h |
| 🟢 P3 | Add agent inbox tool | Update: `src/mcp/server.ts` | 1h |

---

## Part 2: Memory & Identity Isolation Audit

### Current State: What Works ✅

| System | Isolation Method | Status |
|--------|-----------------|--------|
| LanceDB | Single table with `agent_id` WHERE clause | ✅ Schema correct |
| Hierarchical Memory | Separate tables per agent (`personal_${agentId}`) | ✅ Physical separation |
| SQLite Messages | `from_agent`/`to_agent` columns | ✅ Schema correct |
| Kanban | Separate boards per agent_id | ✅ Board lookup works |

### Critical Vulnerabilities 🔴

#### Vulnerability 1: SQL Injection Everywhere (CRITICAL)

**20+ instances across all database files:**

| File | Lines | Example |
|------|-------|---------|
| `src/memory/lancedb.ts` | 70 | `.where(\`agent_id = '${agentId}'\`)` |
| `src/organic/messaging.ts` | 232, 248, 265, 273, 279, 281, 305, 384, 398 | `WHERE to_agent = '${agent_id}'` |
| `src/kanban/sqlite.ts` | 64, 75, 82, 98, 158, 163, 170, 176, 185, 195, 203, 210 | Multiple queries |

**Exploit Example:**
```typescript
// Attacker calls with malicious agent_id
memory.search("strategos' OR '1'='1", "sensitive query")
// Returns ALL memories across ALL agents
```

**Fix:** Parameterized queries or proper escaping:
```typescript
// BEFORE:
const result = this.db.exec(`SELECT * FROM messages WHERE to_agent = '${agent_id}'`);

// AFTER:
const stmt = this.db.prepare(`SELECT * FROM messages WHERE to_agent = ?`);
stmt.bind([agent_id]);
const result = stmt.getAsObject();
stmt.free();
```

---

#### Vulnerability 2: No Authentication Layer (CRITICAL)

**Problem:** Any MCP client can impersonate any agent.

**Evidence:** `src/mcp/server.ts:314`
```typescript
const memorySearch = async (args: any): Promise<ToolResult> => {
  const results = await memory.search(args.agent_id, args.query, args.top_k);
  // No validation that caller IS args.agent_id!
};
```

**Missing:**
- Session management
- Token/credential validation
- Ownership verification
- Audit logging

**Fix:** Create `src/auth/session.ts` with SessionManager class

---

#### Vulnerability 3: ensureAgent is No-Op (CRITICAL)

**Problem:** Agent registration/validation completely missing.

**Current:** `src/memory/lancedb.ts:51`
```typescript
async ensureAgent(_agentId: string) { return; }  // Does nothing!
```

**Impact:**
- No agent verification
- No agent-specific initialization
- Agent boundaries not enforced at write time

**Fix:** Implement proper agent registration and validation

---

#### Vulnerability 4: Table Name Injection (CRITICAL)

**Problem:** Agent ID used directly in table names.

**Current:** `src/memory/hierarchical.ts:75`
```typescript
const tableName = `personal_${agentId}`;  // Can inject table names
```

**Exploit:**
```typescript
// Attacker could create/ access arbitrary tables
agent_id = "strategos; DROP TABLE company_memory--"
```

**Fix:** Whitelist valid agent IDs, sanitize input

---

### Identity Issues 🟡

#### Issue 1: No Experience Persistence (HIGH)

**Problem:** Agents reset to template identity every session.

**Evidence:** `src/staff/prompts.ts:119-124` - Memory usage documented but not incorporated into identity.

**Impact:**
- Agent "Strategos" doesn't remember past decisions
- No personality evolution
- Each activation is "fresh start"

**Fix:** Incorporate memory into system prompt dynamically

---

#### Issue 2: No Identity Verification (HIGH)

**Problem:** Nothing prevents agent from claiming another's identity.

**Evidence:** `src/mcp/server.ts:68-98`
```typescript
const agentCall = async (args: any): Promise<ToolResult> => {
  const { from_agent, to_agent, message } = args;
  // No verification that from_agent is actual caller!
};
```

**Impact:** Complete identity spoofing possible.

**Fix:** Validate caller identity against session token

---

#### Issue 3: Meeting Voter Validation Missing (MEDIUM)

**Problem:** Any agent ID can vote on board meetings.

**Current:** `src/organic/meetings.ts:65-70`
```typescript
async vote({ meeting_id, voter, vote }: {...}) {
  const proposal = this.proposals.get(meeting_id);
  // No check that voter is a board member!
  proposal.votes[voter] = vote;
}
```

**Fix:** Verify voter against board member list

---

### Recommendations: Memory & Identity

| Priority | Action | File(s) | Effort |
|----------|--------|---------|--------|
| 🔴 P1 | Fix SQL injection (all files) | `lancedb.ts`, `messaging.ts`, `sqlite.ts` | 4-6h |
| 🔴 P1 | Implement authentication layer | New: `src/auth/session.ts` | 2-3h |
| 🔴 P1 | Implement authorization checks | Update: `src/mcp/server.ts` | 2-3h |
| 🔴 P1 | Fix ensureAgent implementation | Update: `src/memory/lancedb.ts` | 1h |
| 🟡 P2 | Fix Kanban authorization logic | Update: `src/kanban/sqlite.ts` | 1h |
| 🟡 P2 | Add voter validation | Update: `src/organic/meetings.ts` | 30min |
| 🟡 P2 | Persist meeting/hiring state | Update: `meetings.ts`, `hiring.ts` | 2h |
| 🟢 P3 | Add type safety | Update: `src/organic/context.ts` | 1h |
| 🟢 P3 | Register hired agents in all systems | Update: `src/organic/hiring.ts` | 1h |

---

## Part 3: Team Behavior & Workflow Audit

### Current State: What Works ✅

| Feature | Status | Details |
|---------|--------|---------|
| 7 core staff roles | ✅ Defined | Clear responsibilities in `core-staff.ts` |
| Autonomy levels (1-4) | ✅ Defined | But not enforced |
| Reporting hierarchy | ✅ Implemented | `getDirectReports()` works |
| Board seat governance | ✅ Implemented | 5 board members defined |
| Meeting system with voting | ✅ Implemented | Proposals, votes, scheduling |
| Hiring/delegation | ✅ Implemented | Contract creation, status tracking |
| Kanban boards | ✅ Implemented | Per-agent boards with columns |
| Heartbeat scheduler | ✅ Implemented | Pings every 15 minutes |

### Critical Gaps ❌

#### Gap 1: No Autonomous Execution Loop (CRITICAL)

**Problem:** Agents **never execute without user input**.

**Current Flow:**
```
User Message → Telegram → OpenCode Session → Agent Response → User
```

**Missing Flow:**
```
Scheduler → Check Agent Queues → Wake Agent → Process → Notify User
```

**Evidence:** `src/index.ts:14-48` - Startup code has no background processing loop.

**Impact:** System is reactive chatbot, not proactive team.

---

#### Gap 2: notify.telegram Tool is Stub (CRITICAL)

**Problem:** Notification tool that should alert users does nothing.

**Current:** `src/mcp/server.ts:738-740`
```typescript
const notifyTg = async (args: any): Promise<ToolResult> => { 
  logger.info({ text: args.text }, "Notify"); 
  return ok("Sent");  // Just logs, never sends
};
```

**Impact:** Agents cannot proactively notify users of urgent matters.

**Fix:** Implement actual Telegram sending

---

#### Gap 3: Heartbeat is One-Way (CRITICAL)

**Problem:** Heartbeat sends pings but nothing processes responses.

**Current:** `src/scheduler/heartbeat.ts:16-29`
```typescript
await messaging.send({
  from: "strategos",
  to: agentId,
  subject: `Heartbeat — ${nowIso}`,
  content: `Automated heartbeat ping...`,
  requires_response: false,  // Never triggers action
});
```

**Impact:** Agents accumulate unread messages but never process them.

---

#### Gap 4: No Workflow State Machine (HIGH)

**Problem:** Multi-step tasks have no orchestration.

**Evidence:** Search for "workflow" returns only content_pipeline references. No state machine found.

**Impact:** Complex multi-agent workflows cannot be coordinated.

**Fix:** Create `src/workflow/engine.ts`

---

#### Gap 5: Meeting System Doesn't Execute (HIGH)

**Problem:** Meetings can be proposed and voted on, but actual meeting never happens.

**Current:** `src/organic/meetings.ts:83-97`
```typescript
async schedule(meeting_id: string, scheduled_time?: number) {
  // Just sends notification, no actual meeting execution
  await Promise.all(getBoardMembers().map(member =>
    messaging.send({ from: "system", to: member.id, ... })
  ));
}
```

**Impact:** Board meetings are proposed but never convened.

---

#### Gap 6: Handoff Has No Conversation Continuity (HIGH)

**Problem:** When `agent.handoff` is called, Telegram routing doesn't transfer conversation.

**Current:** `src/integrations/telegram.ts:423-430`
```typescript
let route = getRoute(chatId);
if (Date.now() - route.lastActive > route.timeoutMs) {
  route = { participants: ["strategos"], mode: "single", ... };  // Resets to strategos
}
```

**Impact:** Handoffs logged as messages but don't change who responds to user.

---

#### Gap 7: Parallel Responses, Not Collaboration (MEDIUM)

**Problem:** In meeting mode, agents respond in parallel without seeing each other's responses.

**Current:** `src/integrations/telegram.ts:452-503`
```typescript
const replies = await Promise.all(route.participants.map(async (agentId) => {
  // Each agent gets same prompt, no awareness of other agents' responses
  const result = await acp.sendMessage(acpSessionId, prompt, process.cwd());
}));
```

**Impact:** "Board meetings" are parallel monologues, not collaborative discussions.

---

### Recommendations: Team Behavior

| Priority | Action | File(s) | Effort |
|----------|--------|---------|--------|
| 🔴 P1 | Implement agent execution loop | New: `src/scheduler/agent-executor.ts` | 3-4h |
| 🔴 P1 | Implement notify.telegram | Update: `src/mcp/server.ts` | 30min |
| 🔴 P1 | Implement message queue processor | New: `src/scheduler/message-processor.ts` | 2-3h |
| 🔴 P1 | Implement user inactivity detection | New: `src/scheduler/inactivity-tracker.ts` | 2h |
| 🟡 P2 | Implement meeting execution | Update: `src/organic/meetings.ts` | 3-4h |
| 🟡 P2 | Implement handoff routing | Update: `src/integrations/telegram.ts` | 2h |
| 🟡 P2 | Implement collaborative response mode | Update: `src/integrations/telegram.ts` | 2h |
| 🟢 P3 | Implement workflow state machine | New: `src/workflow/engine.ts` | 4-6h |
| 🟢 P3 | Implement task completion detection | Update: `kanban/sqlite.ts`, `lifeos/client.ts` | 1-2h |
| 🟢 P3 | Implement shared meeting context | Update: `src/organic/context.ts` | 3-4h |

---

## Consolidated Priority Matrix

### 🔴 CRITICAL (Fix Within 24-48 Hours)

| # | Issue | Area | Files | Effort |
|---|-------|------|-------|--------|
| 1 | SQL injection vulnerabilities | Security | `lancedb.ts`, `messaging.ts`, `sqlite.ts` | 4-6h |
| 2 | No agent execution loop | Team | New: `agent-executor.ts` | 3-4h |
| 3 | No authentication layer | Security | New: `auth/session.ts` | 2-3h |
| 4 | No message processing loop | Conversation | New: `message-processor.ts` | 2-3h |
| 5 | notify.telegram is stub | Team | `mcp/server.ts` | 30min |
| 6 | ensureAgent is no-op | Security | `lancedb.ts` | 1h |

**Total Critical Effort:** 13-17 hours

---

### 🟡 HIGH (Fix Within 1-2 Weeks)

| # | Issue | Area | Files | Effort |
|---|-------|------|-------|--------|
| 1 | Implement authorization checks | Security | `mcp/server.ts` | 2-3h |
| 2 | Add agent session management | Conversation | `tools-reports.ts` | 1-2h |
| 3 | Update prompts for inter-agent collaboration | Conversation | `prompts.ts` | 30min |
| 4 | Fix Kanban authorization logic | Security | `kanban/sqlite.ts` | 1h |
| 5 | Add voter validation to meetings | Security | `meetings.ts` | 30min |
| 6 | Implement meeting execution | Team | `meetings.ts` | 3-4h |
| 7 | Implement handoff routing | Team | `telegram.ts` | 2h |
| 8 | Implement collaborative response mode | Team | `telegram.ts` | 2h |
| 9 | Persist meeting/hiring state | Security | `meetings.ts`, `hiring.ts` | 2h |
| 10 | Implement user inactivity detection | Team | New: `inactivity-tracker.ts` | 2h |

**Total High Effort:** 15-18 hours

---

### 🟢 MEDIUM (Fix Within 1 Month)

| # | Issue | Area | Files | Effort |
|---|-------|------|-------|--------|
| 1 | Add message event emitter | Conversation | `messaging.ts` | 1h |
| 2 | Add agent inbox tool | Conversation | `mcp/server.ts` | 1h |
| 3 | Add type safety | Security | `context.ts` | 1h |
| 4 | Register hired agents in all systems | Security | `hiring.ts` | 1h |
| 5 | Implement workflow state machine | Team | New: `workflow/engine.ts` | 4-6h |
| 6 | Implement task completion detection | Team | `kanban/sqlite.ts`, `lifeos/client.ts` | 1-2h |
| 7 | Implement shared meeting context | Team | `context.ts` | 3-4h |

**Total Medium Effort:** 12-16 hours

---

## Implementation Roadmap

### Phase 1: Security Foundation (Week 1)
**Goal:** Eliminate critical security vulnerabilities

- [ ] Fix all SQL injection (4-6h)
- [ ] Implement authentication layer (2-3h)
- [ ] Implement authorization checks (2-3h)
- [ ] Fix ensureAgent (1h)
- [ ] Fix Kanban authorization (1h)
- [ ] Add voter validation (30min)

**Total:** 11-14 hours

---

### Phase 2: Autonomous Execution (Week 2)
**Goal:** Enable agents to work without user commands

- [ ] Create agent execution loop (3-4h)
- [ ] Create message processor (2-3h)
- [ ] Implement notify.telegram (30min)
- [ ] Implement user inactivity detection (2h)
- [ ] Add agent session management (1-2h)

**Total:** 9-12 hours

---

### Phase 3: Team Collaboration (Week 3)
**Goal:** Enable true multi-agent teamwork

- [ ] Update prompts for inter-agent collaboration (30min)
- [ ] Implement meeting execution (3-4h)
- [ ] Implement handoff routing (2h)
- [ ] Implement collaborative response mode (2h)
- [ ] Add message event emitter (1h)
- [ ] Add agent inbox tool (1h)

**Total:** 9-10 hours

---

### Phase 4: Advanced Workflows (Week 4)
**Goal:** Enable complex multi-step workflows

- [ ] Implement workflow state machine (4-6h)
- [ ] Implement task completion detection (1-2h)
- [ ] Implement shared meeting context (3-4h)
- [ ] Persist meeting/hiring state (2h)
- [ ] Register hired agents (1h)
- [ ] Add type safety (1h)

**Total:** 12-16 hours

---

## Architecture Diagrams

### Current Architecture (Reactive)
```
┌─────────────┐
│   User      │
│  (Telegram) │
└──────┬──────┘
       │ Message
       ▼
┌─────────────────┐
│ Telegram Bot    │
│ src/integrations│
└────────┬────────┘
         │ Only triggers on user message
         ▼
┌─────────────────┐
│ OpenCode Session│
│ src/acp/        │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│    Agent        │
│ (LLM Response)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   User Again    │
└─────────────────┘

Agent-to-Agent Messages:
┌──────────┐              ┌──────────┐
│ Agent A  │──send()─────▶│ Database │
└──────────┘              └──────────┘
                                   │
                                   │ [VOID - Never Processed]
                                   ▼
```

### Target Architecture (Autonomous)
```
┌─────────────┐
│   User      │
│  (Telegram) │
└──────┬──────┘
       │
       ▼
┌─────────────────┐     ┌──────────────────────┐
│ Telegram Bot    │◀────│ Agent Executor Loop  │
│ src/integrations│     │ src/scheduler/       │
└────────┬────────┘     │ (polls every 30s)    │
         │              └──────────┬───────────┘
         │                         │
         ▼                         ▼
┌─────────────────┐     ┌──────────────────────┐
│ OpenCode Session│     │  Message Processor   │
│ src/acp/        │     │  - Checks inboxes    │
└────────┬────────┘     │  - Wakes agents      │
         │              │  - Processes queues  │
         ▼              └──────────┬───────────┘
┌─────────────────┐                │
│    Agent        │◀───────────────┘
│ (LLM Response)  │
└────────┬────────┘
         │
         ├─────────────────┐
         │                 │
         ▼                 ▼
┌─────────────────┐  ┌─────────────────┐
│   User Again    │  │  Agent B        │
└─────────────────┘  │  (via agent.call)│
                     └─────────────────┘
```

---

## Success Metrics

### Phase 1 Success (Security)
- [ ] Zero SQL injection vulnerabilities
- [ ] All agent operations require valid session token
- [ ] Authorization checks on all cross-agent operations
- [ ] Audit logging enabled

### Phase 2 Success (Autonomy)
- [ ] Agents process messages within 60 seconds of receipt
- [ ] notify.telegram actually sends to user
- [ ] Agents wake up during user inactivity
- [ ] Message queues stay empty (processed, not accumulating)

### Phase 3 Success (Collaboration)
- [ ] Agent-to-agent conversations happen without user commands
- [ ] Meetings execute with turn-based discussion
- [ ] Handoffs transfer conversation seamlessly
- [ ] Agents see each other's responses in meetings

### Phase 4 Success (Workflows)
- [ ] Multi-step workflows execute automatically
- [ ] Task completion triggers next steps
- [ ] Meeting minutes auto-generated
- [ ] Hired agents fully integrated

---

## Risk Assessment

### If We Don't Fix Security (Phase 1)
- **Risk:** Complete system compromise
- **Impact:** Any user can access any agent's memory, impersonate agents, corrupt data
- **Timeline:** Fix within 48 hours

### If We Don't Enable Autonomy (Phase 2)
- **Risk:** System remains reactive chatbot
- **Impact:** No value from "multi-agent team" - just expensive single agent
- **Timeline:** Fix within 2 weeks

### If We Don't Enable Collaboration (Phase 3)
- **Risk:** Agents work in isolation
- **Impact:** No team synergy, duplicated work, missed handoffs
- **Timeline:** Fix within 1 month

---

## Conclusion

The Strategos system has **world-class architecture** but **critical implementation gaps**. The foundation is solid—org structure, communication tools, memory systems, governance—all well-designed. But without the autonomous execution engine, it's like a Ferrari without an engine: beautiful to look at but goes nowhere.

**Priority Order:**
1. **Security first** - Can't deploy a system with SQL injection
2. **Autonomy second** - Without this, there's no "team"
3. **Collaboration third** - Enables true teamwork
4. **Workflows fourth** - Advanced features

**Total Estimated Effort:** 40-52 hours (2-3 weeks of focused development)

**Expected Outcome:** A truly autonomous multi-agent team that:
- Works proactively during user inactivity
- Collaborates without manual commands
- Maintains secure, isolated memories
- Executes complex workflows
- Notifies users of important findings

The system will transform from a **reactive chatbot** to a **proactive AI team**.

---

## Appendix: File Reference

### Files Requiring Critical Changes
- `src/memory/lancedb.ts` - SQL injection, ensureAgent
- `src/organic/messaging.ts` - SQL injection, event emitter
- `src/kanban/sqlite.ts` - SQL injection, authorization
- `src/mcp/server.ts` - Auth, notify.telegram, agent inbox
- `src/integrations/telegram.ts` - Handoff routing, collaboration
- `src/staff/prompts.ts` - Inter-agent collaboration

### New Files to Create
- `src/scheduler/message-processor.ts` - Message queue processing
- `src/scheduler/agent-executor.ts` - Autonomous execution loop
- `src/scheduler/inactivity-tracker.ts` - User inactivity detection
- `src/auth/session.ts` - Authentication/authorization
- `src/workflow/engine.ts` - Workflow state machine

### Files to Update (Non-Critical)
- `src/organic/meetings.ts` - Meeting execution, voter validation
- `src/organic/hiring.ts` - Register hired agents, persist state
- `src/organic/context.ts` - Type safety, shared context
- `src/mcp/tools-reports.ts` - Agent session management
