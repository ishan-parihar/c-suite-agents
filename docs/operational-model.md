# Strategos Operational Model: Core Staff + Board Meetings

## Vision

You want Strategos to operate like a real CEO managing a company:

```
┌─────────────────────────────────────────────────────────────────┐
│                         YOU (Founder)                           │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  STRATEGOS (CEO) — Conversational, manages through Kanban +     │
│  direct confrontation, can hire/fire auxiliary staff            │
└─────────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┴───────────────┐
              ▼                               ▼
┌─────────────────────────┐     ┌─────────────────────────────────┐
│   CORE STAFF (C-Suite)  │     │   AUXILIARY STAFF (Contractors) │
│   — Predefined roles    │     │   — Hired/fired by Strategos    │
│   — Permanent           │     │   — Task-based                  │
│   — Board voting rights │     │   — No board seat               │
│   — Manage departments  │     │   — Report to Core Staff        │
└─────────────────────────┘     └─────────────────────────────────┘
        │                               ▲
        └───────────────┬───────────────┘
                        │
                        ▼
              ┌─────────────────────┐
              │   BOARD MEETINGS    │
              │ — Multi-agent convo │
              │ — Shared memory     │
              │ — Decision voting   │
              └─────────────────────┘
```

## Core Staff Roles (Predefined)

| Role | Agent ID | Responsibilities | Kanban Columns |
|------|----------|------------------|----------------|
| CTO | `cto` | Tech architecture, code quality, dev agents | Backlog, Sprint, Review, Deploy |
| CFO | `cfo` | Budget, costs, resource allocation | Pending, Approved, Rejected |
| COO | `coo` | Operations, workflows, efficiency | Queue, In Progress, Audit |
| CPO | `cpo` | Product strategy, roadmap, user feedback | Ideas, Planned, Shipping |
| Lead Dev | `lead-dev` | Code reviews, mentoring, implementation | TODO, Coding, PR, Done |
| Research Lead | `research-lead` | R&D, competitive analysis, papers | Exploring, Synthesizing, Reporting |

## Auxiliary Staff (Dynamic)

- Hired by Strategos based on workload
- Examples: `dev-contractor-1`, `writer-freelancer-1`
- Assigned to Core Staff managers
- Fired when task complete or budget exhausted

## Management Mechanisms

### 1. Kanban Management
- Strategos audits each agent's board every 15/30 min
- Stalled cards (>4h) → escalation to manager
- Blocked cards → Strategos intervention

### 2. Direct Confrontation
- Strategos can initiate 1-on-1 with any agent
- "CTO, why is the ACP task stalled?"
- Agent responds based on their memory + context

### 3. Board Meetings
- Scheduled (weekly) or ad-hoc (crisis)
- All Core Staff + Strategos
- Shared conversation context
- Voting on major decisions
- Meeting minutes stored in shared memory

---

## Implementation Gaps Analysis

### Gap 1: Core Staff Definition

**Current State:**
- `agent.create` creates generic agents with no predefined roles
- No concept of "core" vs "auxiliary"
- No role-specific capabilities or permissions

**What's Needed:**
- Predefined agent templates (CTO, CFO, COO, CPO, etc.)
- Role-specific system prompts
- Role-specific tool permissions
- Board voting rights metadata
- Manager-auxiliary assignment tracking

**Implementation:**
```typescript
// src/staff/core-staff.ts
export const CORE_STAFF_ROLES = {
  cto: {
    name: "CTO",
    systemPrompt: "You are the CTO, responsible for...",
    permissions: ["deploy", "code_review", "hire_dev"],
    boardSeat: true,
    reportsTo: "ceo"
  },
  cfo: { ... },
  // ...
};

// On Strategos startup, auto-create core staff
await initializeCoreStaff();
```

---

### Gap 2: Inter-Agent Communication

**Current State:**
- Agents are isolated — no way to talk to each other
- Memory is per-agent, not shared
- No messaging system between agents

**What's Needed:**
- Agent-to-agent messaging queue
- Shared memory spaces (project-level)
- @mentions in Kanban comments
- Request/response protocol between agents

**Implementation:**
```typescript
// src/agents/messaging.ts
export async function sendMessage(from: string, to: string, content: string) {
  // Store in shared message queue
  await db.messages.add({ from, to, content, ts: Date.now(), read: false });
  // Notify recipient (Telegram, in-app, etc.)
  await notifyAgent(to, `Message from ${from}`);
}

// Agent tool: message.send
server.registerTool("message.send", {
  inputSchema: z.object({ to: z.string(), content: z.string() })
}, async (args) => {
  await sendMessage(currentAgentId, args.to, args.content);
});
```

---

### Gap 3: Board Meetings

**Current State:**
- No concept of multi-agent conversations
- No meeting scheduler
- No shared decision-making

**What's Needed:**
- Meeting scheduler (cron-based or on-demand)
- Multi-agent conversation room
- Agenda management
- Voting mechanism
- Meeting minutes storage

**Implementation:**
```typescript
// src/meetings/board-meeting.ts
export async function conveneBoardMeeting(agenda: string[]) {
  const coreStaff = getCoreStaff();
  
  // Create shared conversation space
  const roomId = await createMeetingRoom(coreStaff.map(s => s.id));
  
  // Post agenda
  for (const item of agenda) {
    await postToRoom(roomId, { type: "agenda", content: item });
  }
  
  // Each agent responds in turn (via their ACP session)
  for (const agent of coreStaff) {
    const response = await promptAgent(agent.id, `Board meeting: ${agenda}`);
    await postToRoom(roomId, { type: "response", from: agent.id, content: response });
  }
  
  // Vote on decisions
  const votes = await collectVotes(coreStaff);
  const decision = tallyVotes(votes);
  
  // Store minutes
  await saveMeetingMinutes(roomId, decision);
  
  return decision;
}
```

---

### Gap 4: Memory Architecture

**Current State:**
- Each agent has isolated LanceDB
- No shared memory between agents
- No concept of "company memory" vs "personal memory"

**What's Needed:**
- Three-tier memory:
  1. **Personal Memory** — Agent's private thoughts, learnings
  2. **Project Memory** — Shared among team members
  3. **Company Memory** — All agents can access (policies, decisions, meeting minutes)

**Implementation:**
```typescript
// src/memory/memory-hierarchy.ts
export class HierarchicalMemory {
  async search(agentId: string, query: string, scope: "personal" | "project" | "company") {
    switch (scope) {
      case "personal":
        return this.personalDB[agentId].search(query);
      case "project":
        const project = await this.getAgentProject(agentId);
        return this.projectDB[project].search(query);
      case "company":
        return this.companyDB.search(query);
    }
  }
  
  async write(agentId: string, content: string, scope: "personal" | "project" | "company") {
    // Similar routing
  }
}
```

---

### Gap 5: Task Delegation Chain

**Current State:**
- Strategos directly assigns tasks to any agent
- No management hierarchy
- No delegation from Core → Auxiliary

**What's Needed:**
- Delegation chain: CEO → C-Suite → Leads → Contractors
- Approval workflows (large tasks need CEO sign-off)
- Escalation paths (blocked tasks move up chain)

**Implementation:**
```typescript
// src/delegation/chain.ts
export const DELEGATION_CHAIN = {
  ceo: ["cto", "cfo", "coo", "cpo"],
  cto: ["lead-dev", "dev-*"],
  cfo: ["analyst-*"],
  // ...
};

export async function delegateTask(from: string, to: string, task: Task) {
  // Verify delegation authority
  const chain = DELEGATION_CHAIN[from];
  if (!chain?.some(pattern => matchPattern(pattern, to))) {
    throw new Error(`${from} cannot delegate to ${to}`);
  }
  
  // Create task in recipient's Kanban
  await kanban.addCard(to, task.title, { ...task, delegatedFrom: from });
  
  // Notify
  await sendMessage(from, to, `New task assigned: ${task.title}`);
}
```

---

### Gap 6: Agent Autonomy Levels

**Current State:**
- Agents only act when Strategos tells them to
- No autonomous behavior

**What's Needed:**
- Autonomy levels per role:
  - **Level 1 (Contractors):** Execute assigned tasks only
  - **Level 2 (Leads):** Can delegate to contractors, approve PRs
  - **Level 3 (C-Suite):** Can hire/fire contractors, approve budgets
  - **Level 4 (CEO):** Full autonomy, can override any decision

**Implementation:**
```typescript
// src/agents/autonomy.ts
export const AUTONOMY_LEVELS = {
  contractor: 1,
  lead: 2,
  csuite: 3,
  ceo: 4
};

export async function canAct(agentId: string, action: string) {
  const level = getAgentLevel(agentId);
  const required = ACTION_REQUIREMENTS[action];
  return level >= required;
}

// Example: hiring requires level 3
const ACTION_REQUIREMENTS = {
  "hire_contractor": 3,
  "fire_contractor": 3,
  "approve_budget": 3,
  "deploy_prod": 2,
  "merge_pr": 2,
};
```

---

### Gap 7: Confrontation Protocol

**Current State:**
- No mechanism for Strategos to "confront" agents about stalled work

**What's Needed:**
- Automated confrontation triggers (stalled >4h, quality issues)
- Confrontation templates (firm but constructive)
- Agent response handling (excuses, blockers, requests for help)
- Escalation if confrontation doesn't resolve issue

**Implementation:**
```typescript
// src/management/confrontation.ts
export async function confrontAgent(agentId: string, issue: string) {
  const templates = {
    stalled: "I notice {task} has been stalled for {hours}h. What's blocking you?",
    quality: "The {deliverable} has {issues}. Please review and fix.",
    missing: "You haven't updated your board in {hours}h. Status?"
  };
  
  const message = templates[issue.type]
    .replace("{task}", issue.task)
    .replace("{hours}", issue.hours.toString());
  
  // Send via agent's ACP session
  const response = await promptAgent(agentId, message);
  
  // Analyze response
  const analysis = await analyzeResponse(response);
  
  if (analysis.excuse && !analysis.validBlocker) {
    // Escalate: reduce autonomy, assign manager oversight
    await escalateAgent(agentId);
  } else if (analysis.validBlocker) {
    // Help: remove blocker
    await resolveBlocker(issue.blocker);
  }
}
```

---

## Summary of Gaps

| Gap | Priority | Complexity | Phase |
|-----|----------|------------|-------|
| 1. Core Staff Definition | High | Low | Phase 2A |
| 2. Inter-Agent Messaging | High | Medium | Phase 2B |
| 3. Board Meetings | Medium | High | Phase 3A |
| 4. Memory Hierarchy | High | Medium | Phase 2C |
| 5. Delegation Chain | Medium | Medium | Phase 3B |
| 6. Autonomy Levels | Medium | Low | Phase 2D |
| 7. Confrontation Protocol | High | Low | Phase 2E |

---

## Recommended Next Phases

### Phase 2: Core Staff Foundation
- 2A: Define core staff roles with templates
- 2B: Inter-agent messaging system
- 2C: Three-tier memory (personal/project/company)
- 2D: Autonomy levels per role
- 2E: Confrontation protocol for stalled work

### Phase 3: Board Operations
- 3A: Board meeting scheduler + multi-agent conversations
- 3B: Delegation chain implementation
- 3C: Voting mechanism for decisions
- 3D: Meeting minutes + decision tracking

### Phase 4: Advanced Operations
- 4A: Auxiliary staff hiring/firing automation
- 4B: Budget tracking per agent/department
- 4C: Performance reviews (quarterly)
- 4D: Company culture memory (values, norms)

---

**Next Step:** Proceed with Phase 2A (Core Staff Definition) as foundation for everything else?
