Strategos — OpenCode MCP Orchestrator (Dev & R&D)

Overview
- Purpose: A headless, OpenCode‑compatible multi‑agent orchestrator (like openclaw, but focused on development/R&D) implemented in TypeScript. Strategos is the primary agent and MCP server. It manages sub‑agents, schedules heartbeat checks, composes instructions with per‑agent memory retrieved from LanceDB (Ollama embeddings), and exposes native tools for lifecycle, tasking, and observability. Access via Telegram and CLI; Kanban stored in SQLite.
- Scope: Agent orchestration (ACP/headless), per‑agent memory (vector + metadata), Kanban workflow, heartbeat management, notifications, and integration points to opencode hosts.
- Non‑goals (initial): Rich UI, long‑term analytics, advanced policy engine. These can be added later.

Key Decisions
- Language: TypeScript (Node 20+)
- Protocol: MCP (Model Context Protocol) for tools/resources/prompts; stdio for local & Streamable HTTP for remote
- Memory: LanceDB per agent with vector column (Ollama embeddings; Qwen3‑0.6B embedding model preferred; fallbacks allowed)
- Kanban: SQLite (via better‑sqlite3 or prisma/sqlite) per namespace
- Access: Telegram bot → Strategos MCP tools; CLI/host integration via stdio or HTTP

Architecture
- Strategos (primary)
  - MCP server exposing tools: agent.*, project.*, board.*, task.*, memory.*, heartbeat.*, notify.*
  - Scheduler: 15/30‑minute heartbeat loop per agent/project; on‑demand trigger
  - Registry: agents, projects, memory DB paths, board IDs, tool configuration
  - Connectors: Telegram, CLI (OpenCode headless); logs & audit trail
- Agent Runners (per project)
  - Spawned locally (stdio) or remote (HTTP) processes/services
  - Own tool surface for domain work and recall/remember memory operations
  - Own LanceDB DB path and Kanban board namespace
- Memory Layer (LanceDB)
  - Tables per agent: events, decisions, artifacts/docs, rollups
  - Vector search with filters; periodic rollups and TTL cleanup
- Kanban Layer (SQLite)
  - Tables: boards, columns, cards, card_activity
  - Statuses: Backlog → Todo → In Progress → Blocked → Review → Done
  - Every transition writes an event into memory
- ACP (Headless OpenCode Control)
  - Strategy: implement ACP as MCP tool schema + optional HTTP endpoint. Strategos emits RegisterAgent, AssignProject, CreateTask, UpdateTask, Heartbeat, MemoryOps. Sub‑agents implement reciprocal tools.

Data Models (initial)
- LanceDB (per agent)
  - events(id, ts, type[note|obs|io|log], agent_id, project_id?, task_id?, content, importance[0..1], tags[], ttl?, vector[float[]])
  - decisions(id, ts, title, rationale, outcome, links[], tags[], vector)
  - artifacts(id, ts, kind, uri, summary, tags[], vector)
  - rollups(id, period_start, period_end, scope[agent|project|task], summary_text, pinned_refs[], vector)
- SQLite (global or per agent namespace)
  - boards(id, name, agent_id, project_id)
  - columns(id, board_id, name, order)
  - cards(id, board_id, column_id, title, description, priority, due, tags, assignee_agent_id, project_id, last_update)
  - card_activity(id, card_id, ts, action, payload)

Embedding & Memory
- Embedding Provider: Ollama
  - Preferred: Qwen3‑Embedding‑0.6B (verify model tag in local registry)
  - Fallback: nomic‑embed‑text or embeddinggemma
- Query vs Passage: if model supports prompt_name, use query/passages appropriately to improve retrieval relevance.
- API Call (JS):
  - import ollama from "ollama";
  - await ollama.embed({ model: process.env.OLLAMA_EMBED_MODEL || "embeddinggemma", input: text });
- Write Path: tool → embed → upsert into LanceDB → return id
- Search Path: kNN with filters (tags, project_id, type), re‑rank by importance & recency
- Rollups: heartbeat composes summaries (structured prompts) and pins references; enforce TTL on low importance events

MCP Surfaces (Strategos)
- Transport: StdioServerTransport (local), Streamable HTTP (remote)
- Tools (JSON Schema via Zod). All tools MUST be idempotent where relevant.
  - agent.create { name, role, model, tools[], memory_path?, board_id? } → { agent_id }
  - agent.start { agent_id } → { ok }
  - agent.stop { agent_id } → { ok }
  - agent.status { agent_id? } → { agents: [{id, state, lastHeartbeat, project_id}] }
  - project.register { project_id, name, objectives[], constraints[] } → { ok }
  - project.assign { agent_id, project_id } → { ok }
  - board.create { agent_id, project_id, columns? } → { board_id }
  - board.get { board_id } → { board, columns, cards }
  - board.addCard { board_id, title, description?, priority?, due?, tags?[] } → { card_id }
  - board.moveCard { card_id, to_column_id } → { ok }
  - task.update { card_id, fields{...} } → { ok }
  - memory.upsert { agent_id, project_id?, task_id?, type, content, importance?, tags?[] } → { id }
  - memory.search { agent_id, query, top_k?, filter? } → { items: [...] }
  - memory.summarize { agent_id, scope, period } → { rollup_id }
  - heartbeat.runNow { agent_id? } → { started: true }
  - heartbeat.configure { agent_id?, intervalMin? } → { ok }
  - notify.telegram { chatId?, text } → { ok }
- Resources
  - agents.json (live registry), boards.json (ids/health), heartbeat.json (last run, durations)
- Prompts
  - progress‑check, blocker‑report, daily‑summary — structured templates for consistent summarization/analysis

MCP Surfaces (Agent Runner)
- Tools
  - job.execute { instructions, files?, env? } → { result, artifacts? }
  - recall.search { query, top_k?, filter? } → { items }
  - remember.write { type, content, importance?, tags? } → { id }
  - kanban.update { card_id, status|fields } → { ok }
  - status.report { } → { health, current_tasks, last_error? }

Instruction Composition (Strategos → Sub‑agent)
- Strategos builds instructions for sub‑agents that include:
  - System prompt for sub‑agent role (dev/R&D tuned)
  - Project context (objectives, constraints)
  - Kanban focus (current card + acceptance criteria)
  - Retrieved memory (top_k relevant events/decisions/artifacts summaries)
  - Guardrails (time budget, output format expectations)
- Strategos sends job.execute with composed instructions; captures outputs; updates Kanban; records memory.

Heartbeat (15/30 minute)
- Quick (15 min): status polling, overdue detection, drift (no update in N hours), recent failures, notify if needed
- Full (30 min): quick checks + rollups, stale card escalation, cross‑agent dependency scan, TTL cleanup
- Sequence:
  1) Enumerate agents/projects
  2) Fetch board state + recent memory
  3) Detect blockers/overdue → board.moveCard to Blocked + notify.telegram
  4) Summarize changes → memory.summarize rollup
  5) Log heartbeat metrics

Telegram Integration
- Bot wraps Strategos tools
  - /agents → agent.status
  - /board <agent> → board.get
  - /task <agent> <title> |desc:...|prio:...|due:... → board.addCard
  - /move <card_id> <status> → board.moveCard
  - /search <agent> <query> → memory.search
- Config (env): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID; do not hardcode secrets in repo
- Provided for testing by user (keep in env):
  - TELEGRAM_BOT_TOKEN=REDACTED_TELEGRAM_BOT_TOKEN
  - TELEGRAM_CHAT_ID=5297486612

OpenCode Headless / ACP Notes
- Operate over stdio for local orchestration; Streamable HTTP for remote runners
- ACP is expressed via MCP tool contracts so OpenCode hosts can spawn/connect servers
- For OpenCode “like openclaw” dev flows:
  - Strategos exposes native build/test/deploy hooks as tools or delegates to Agent Runners with those tools
  - Strategos maintains a registry of MCP servers (runners) and their capabilities; can hot‑add/remove runners

Example Code (TypeScript snippets)

// Strategos MCP server skeleton
// Tools registration outline; wrap each with Zod schemas
/*
import { McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";

const server = new McpServer({ name: "strategos", version: "0.1.0" }, { capabilities: { logging: {} } });

server.registerTool("memory.upsert", {
  description: "Upsert memory row for an agent",
  inputSchema: z.object({
    agent_id: z.string(), project_id: z.string().optional(), task_id: z.string().optional(),
    type: z.enum(["note","obs","io","log"]), content: z.string(), importance: z.number().min(0).max(1).optional(),
    tags: z.array(z.string()).optional()
  })
}, async (args, ctx) => {
  // embed with Ollama; upsert into LanceDB (events table)
  // return { content: [{ type: 'text', text: 'ok' }], structuredContent: { id } }
  return { content: [{ type: "text", text: "stub" }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Strategos MCP running on stdio");
}
main().catch(e => { console.error("Fatal:", e); process.exit(1); });
*/

// LanceDB + Ollama helper (sketch)
/*
import { connect } from "@lancedb/lancedb";
import ollama from "ollama";

export async function embedAndUpsert(dbPath: string, row: any) {
  const db = await connect(dbPath);
  const tbl = await db.openTable("events").catch(() => db.createTable("events", []));
  const { embeddings } = await ollama.embed({ model: process.env.OLLAMA_EMBED_MODEL || "embeddinggemma", input: row.content });
  await tbl.add([{ ...row, vector: embeddings[0] }]);
}
*/

Security & Governance
- Per‑agent isolation: separate LanceDB directories; per‑tool allowlists; project‑scoped access
- Auth: token for remote MCP; Telegram chat allow list; rate limiting and timeouts
- Secrets: .env + runtime injection; never commit tokens; redact memory in notifications when required
- Audit: store tool calls (hash of input/output), timestamps, actor

Deployment
- Monorepo structure (suggested):
  - packages/strategos (MCP server + scheduler + Telegram)
  - packages/agent-runner (generic runner template)
  - packages/shared (schemas, types, clients)
  - infra/ (Dockerfiles, compose, PM2 configs)
- Local dev: stdio transports; LanceDB local directories; Ollama on localhost
- Remote: Streamable HTTP behind auth; runners containerized; storageOptions for S3 if needed

Milestones
1) Strategos skeleton + tool stubs; registry; logging
2) Memory MVP: LanceDB events, memory.upsert/search wired to Ollama
3) Kanban MVP: SQLite schema; board.* tools; transitions write memory events
4) Heartbeat (quick) + notify (Telegram)
5) Instruction composer (memory recall + prompt) + job.execute integration with a sample runner
6) Heartbeat (full) + rollups + TTL cleanup
7) Hardening: auth, retries, backpressure, tests, metrics

Testing & Validation
- Unit tests for tool input schemas, LanceDB adapter, SQLite board ops
- Integration tests: memory recall + task execution round‑trip
- Smoke tests: heartbeat loop with one agent & Telegram notifications

Docs & References
- MCP TypeScript SDK (Tier‑1): servers, tools, resources, prompts; stdio and Streamable HTTP
- Sampling/Elicitation patterns: requestSampling, elicitInput (for richer flows)
- LanceDB embeddings & Node SDK: embedding registry, manual query embeddings
- Ollama embeddings API: /api/embed; JS client examples

Operational Notes
- Heartbeat intervals are configurable per agent; respect backoff on repeated failures
- Long‑running tool calls should be turned into tasks (MCP tasks/handles) with polling
- Keep console.log off stdout in stdio mode; use stderr for server logs

Open Questions (track)
- Confirm ACP schemas of current OpenCode headless host; map 1:1 to MCP tool contracts
- Confirm Qwen3‑0.6B embedding model availability in local Ollama; else set a fallback
- Do we unify Kanban in LanceDB (scalar columns) later or keep SQLite long‑term?

Fork OpenClaw vs Headless OpenCode ACP
- Summary: Use headless OpenCode ACP with Strategos. Do not fork OpenClaw.
- Evidence (current ecosystem):
  - OpenCode provides first‑class ACP support (`opencode acp`) and a headless HTTP server (`opencode serve`). Docs: ACP, CLI, Server.
  - ACP is stable across editors/CLIs and works via JSON‑RPC over stdio; systemd‑friendly.
  - GitHub issues confirm active fixes for ACP/headless edge cases (e.g., default agent selection in ACP mode).
  - OpenClaw has useful patterns (skills, MCP integrations, community skills, Mission Control) but is broader than dev/R&D and adds governance complexity we don’t need.
  - Forking couples us to their internals and release cadence, conflicts with our TypeScript focus, and increases maintenance risk.
- Recommendation:
  - Build Strategos as a TypeScript MCP server that drives OpenCode via ACP sessions (stdio) and/or HTTP server. Keep orchestration in Strategos, coding in OpenCode agents.
  - Reuse MCP servers/skills where helpful by configuring them into OpenCode/Strategos—without forking OpenClaw.
  - Optionally support `acpx` as an adapter to manage heterogeneous ACP agents; keep Strategos as the single control plane.

Systemd/Headless Deployment Notes
- Run Strategos as a systemd service (Type=simple) that:
  - Starts Strategos (node dist/index.js) with env for Telegram, Ollama, DB paths.
  - Spawns and supervises `opencode acp` background sessions on demand; reconnects across restarts.
  - On heartbeat or Telegram message, composes instructions (project + Kanban + memory recall) and sends ACP prompts to the appropriate OpenCode session.
- Ensure journald captures stderr logs; set restart policies according to SLOs.

## Conversational Layer: Headless OpenCode as Strategos Brain

### Investigation Results

**Tested Approaches:**

| Method | Result | Notes |
|--------|--------|-------|
| `opencode run <prompt>` | ✅ Works | Spawns LLM, returns response, supports tool use |
| `opencode serve` HTTP | ❌ Web UI only | Not a JSON API |
| `opencode acp` JSON-RPC | ⚠️ Complex | Requires strict protocol params |

**Recommended:** Use `opencode run` as Strategos's brain via subprocess.

### Architecture

```
User Message (Telegram/CLI)
         ↓
Strategos Brain (src/brain/opencode.ts)
   - Spawns: opencode run "<system prompt + user message>"
   - Parses: JSON response with {analysis, actions[], reply}
   - Executes: MCP tool calls from actions[]
         ↓
Natural Language Response to User
```

### Implementation

- `src/brain/opencode.ts` — `strategosThink()` function
- System prompt defines CEO role, available tools, response format
- Timeout: 60 seconds per thinking cycle
- Response: JSON with analysis, actions to execute, natural language reply

### Sub-Agent Spawning

Each sub-agent (employee) spawned via:
```
opencode acp --cwd <project-dir>
```

With role-specific prompt:
```
You are {role} agent working on {project}.
Your memory: {lancedb path}
Your Kanban: {board id}
Current task: {card details}
Tools available: recall.search, remember.write, kanban.update
```

### Heartbeat Auditing

Every 15/30 min:
1. Query each agent's Kanban for card status
2. Check memory for recent activity
3. Detect: stalled cards (>4h no update), missing progress
4. Escalate to user if blocked
5. Generate rollup summaries

### Next Steps

1. Integrate `strategosThink()` into Telegram bot
2. Add `agent.spawn` tool that launches `opencode acp` sessions
3. Build instruction composer for delegation
4. Implement heartbeat auditing logic

---

## Operational Model: Core Staff + Board Meetings

### Organizational Structure

Strategos operates as CEO managing a company of AI agents:

**Core Staff (C-Suite, Predefined):**
- CTO — Tech architecture, dev team management
- CFO — Budget, costs, resource allocation  
- COO — Operations, workflows, efficiency
- CPO — Product strategy, roadmap
- Lead Dev — Code reviews, implementation
- Research Lead — R&D, competitive analysis

**Auxiliary Staff (Dynamic, Hired/Fired):**
- Contractors hired by Strategos based on workload
- Assigned to Core Staff managers
- Released when tasks complete

**Management Mechanisms:**
1. **Kanban Audits** — 15/30 min progress checks
2. **Direct Confrontation** — 1-on-1 for stalled work
3. **Board Meetings** — Multi-agent conversations for major decisions

### Memory Architecture

Three-tier memory system:
1. **Personal** — Agent's private thoughts, learnings
2. **Project** — Shared among team members
3. **Company** — All agents (policies, decisions, meeting minutes)

### Inter-Agent Communication

- Agent-to-agent messaging queue
- @mentions in Kanban comments
- Request/response protocol
- Board meeting rooms for group discussions

### Autonomy Levels

| Level | Role | Capabilities |
|-------|------|--------------|
| 1 | Contractor | Execute assigned tasks |
| 2 | Lead | Delegate to contractors, approve PRs |
| 3 | C-Suite | Hire/fire contractors, approve budgets |
| 4 | CEO | Full autonomy, override decisions |

### Implementation Gaps Identified

| Gap | Priority | Phase |
|-----|----------|-------|
| Core Staff Definition | High | 2A |
| Inter-Agent Messaging | High | 2B |
| Memory Hierarchy | High | 2C |
| Autonomy Levels | Medium | 2D |
| Confrontation Protocol | High | 2E |
| Board Meetings | Medium | 3A |
| Delegation Chain | Medium | 3B |

See `docs/operational-model.md` for full analysis.

---

## Phase 2A: Core Staff Implementation ✅

### Implemented

**7 Core Staff Agents auto-initialized on startup:**

| Agent ID | Role | Avatar | Autonomy | Board Seat | Reports To |
|----------|------|--------|----------|------------|------------|
| `strategos` | CEO — Strategic | 👔 | 4 | Yes | — |
| `coo-productivity` | COO — Productivity | ⚙️ | 3 | Yes | strategos |
| `cpo-psychologist` | CPO — Psychologist | 🧠 | 3 | Yes | strategos |
| `cro-relational` | CRO — Relational | 🤝 | 3 | Yes | strategos |
| `cfo-financial` | CFO — Financial | 💰 | 3 | Yes | strategos |
| `cmo-content` | CMO — Content | 📝 | 3 | Yes | strategos |
| `physician-health` | Physician — Health | 🩺 | 2 | No | coo-productivity |

### New MCP Tools

| Tool | Description |
|------|-------------|
| `org.chart` | Show organization chart |
| `staff.list` | List all core staff |
| `lifeos.projects` | Get active projects from LifeOS |
| `lifeos.goals` | Get quarterly goals from LifeOS |
| `lifeos.tasks` | Get active tasks from LifeOS |

### New Telegram Commands

| Command | Description |
|---------|-------------|
| `/org` | Show organization chart |
| `/staff` | List core staff with details |
| `/agents` | List all agents (core + auxiliary) |
| `/start` | Introduction with org overview |

### Files Created

- `src/staff/core-staff.ts` — Core staff templates with LifeOS mappings
- `src/lifeos/client.ts` — LifeOS MCP client wrapper
- Updated `src/mcp/server.ts` — Core staff initialization + new tools
- Updated `src/integrations/telegram.ts` — /org, /staff commands

### Testing

```bash
# Start Strategos
OLLAMA_EMBED_MODEL="qwen3-embedding:0.6b" npm start

# Telegram commands
/org — Shows org chart
/staff — Lists core staff with details
/agents — Lists all agents
```

### Next: Phase 2B — LifeOS MCP Integration

Each agent needs direct access to their LifeOS databases via specialized tools:
- COO: `lifeos.daily_briefing()`, `lifeos.tasks()`
- CPO: `lifeos.subjective_journal()`, `lifeos.systemic_journal()`
- CRO: `lifeos.people()`, `lifeos.relational_journal()`
- CFO: `lifeos.financial_log()`, `lifeos.temporal_analysis()`
- CMO: `lifeos.content()`, `lifeos.campaigns()`
- Physician: `lifeos.diet_log()`, `lifeos.activity_log()`

---

## Phase 2B/2C/2D Complete: LifeOS Suite + Prompts + Memory ✅

### Full LifeOS Suite Integration

**All 19 LifeOS databases accessible to all core staff:**

| Category | Databases |
|----------|-----------|
| **Strategic** | annual_goals, quarterly_goals, projects, campaigns, content_pipeline, directives_risk_log, opportunities_strengths, people, quarters, years |
| **Productivity** | activity_log, activity_types, days, weeks, months, tasks, reports |
| **Journaling** | subjective_journal, relational_journal, systemic_journal |
| **Health** | diet_log |
| **Financial** | financial_log |

### MCP Tools (Full Suite)

| Tool Pattern | Description |
|--------------|-------------|
| `lifeos.query({database, filter_property, filter_value, limit})` | Generic query for any database |
| `lifeos.find({database, search, limit})` | Find entries by search term |
| `lifeos.create({database, name, properties})` | Create new entry |
| `lifeos.update({database, page_id, properties})` | Update existing entry |
| `lifeos.<database>.get({limit})` | Get all entries from database |
| `lifeos.<database>.active({limit})` | Get active entries only |

**Specialized convenience tools:**
- `lifeos.projects.active` — Active projects
- `lifeos.goals.quarterly` — Quarterly OKRs
- `lifeos.goals.annual` — Annual goals
- `lifeos.tasks.active` — Active tasks
- `lifeos.tasks.overdue` — Overdue tasks
- `lifeos.people.reconnect` — People to reconnect with
- `lifeos.risks.high` — High-impact risks
- `lifeos.opportunities.high` — High-leverage opportunities

### Role-Specific System Prompts

Each core staff agent gets a specialized prompt including:
- Role definition and responsibilities
- Accessible LifeOS databases with descriptions
- Available tools (generic + specialized)
- Kanban column configuration
- Autonomy level and authority
- Response style guidance
- Memory usage instructions

**Example (CFO):**
```
You are the CFO, the CFO — Financial.

YOUR DATABASES (LifeOS Full Suite):
- financial_log: Transactions with categories, capital engines
- weeks: Weekly reviews with tasks, cashflow, activity breakdown
- months: Monthly synthesis with financial summaries
- projects: Project portfolio with health, progress, strategy

YOUR AUTHORITY:
- Autonomy Level: 3/4
- Board Seat: Yes (voting rights)
- Reports To: strategos

RESPONSE STYLE:
- Data-driven, precise
- Focus on cashflow sustainability
- Provide clear numbers and projections
```

### Three-Tier Memory Hierarchy

**1. Personal Memory** (`personal_<agent_id>` table)
- Agent's private thoughts, analysis, learnings
- Only accessible by that agent
- Example: CPO's analysis of user's emotional patterns

**2. Project Memory** (`project_<project_id>` table)
- Shared among agents working on same project
- Collaborative context, decisions, progress
- Example: CEO + COO + CMO collaborating on content campaign

**3. Company Memory** (`company_memory` table)
- All agents can access
- Meeting minutes, board decisions, policies, OKRs
- Example: Board meeting decisions, strategic directives

**Features:**
- Vector embeddings via qwen3-embedding:0.6b
- Cross-scope search (personal + project + company)
- Re-ranking by importance + recency
- TTL support for automatic cleanup
- Tag-based filtering

### Files Created

| File | Purpose |
|------|---------|
| `src/lifeos/client.ts` | Full LifeOS suite client (19 databases) |
| `src/staff/prompts.ts` | Role-specific system prompts |
| `src/memory/hierarchical.ts` | Three-tier memory with embeddings |
| `src/types.ts` | Updated with HierarchicalMemory |
| `src/mcp/server.ts` | Full LifeOS tool suite |

### Testing

```bash
# Start Strategos
OLLAMA_EMBED_MODEL="qwen3-embedding:0.6b" npm start

# Logs show:
# "Initializing core staff..."
# "Core staff initialized: 7 agents"
# "Company memory initialized"
# "Strategos MCP running"

# MCP tools available:
lifeos.query({database: "projects", filter_property: "Status", filter_value: "Active"})
lifeos.goals.quarterly()
lifeos.tasks.active()
lifeos.people.reconnect()

# Telegram commands:
/org     # Organization chart
/staff   # Core staff list
/staff-get id:cfo  # Individual staff details
```

### Architecture Summary

```
┌─────────────────────────────────────────────────────────────────┐
│                    STRATEGOS (CEO)                              │
│  Databases: All 19 LifeOS DBs                                   │
│  Tools: lifeos.*, org.*, staff.*, memory.*, board.*, heartbeat │
│  Memory: Personal + Project + Company (qwen3-embedding)         │
└─────────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│   COO         │   │  Psychologist │   │    CRO        │
│ Productivity  │   │   (CPO)       │   │  Relational   │
│ DBs: 7        │   │  DBs: 4       │   │  DBs: 3       │
└───────────────┘   └───────────────┘   └───────────────┘
        │                     │                     │
        ▼                     ▼                     ▼
┌───────────────┐   ┌───────────────┐   ┌───────────────┐
│  CFO          │   │   CMO         │   │   Physician   │
│  Financial    │   │   Content     │   │   Dietician   │
│  DBs: 4       │   │  DBs: 3       │   │  DBs: 4       │
└───────────────┘   └───────────────┘   └───────────────┘

Each agent has:
- Role-specific system prompt
- Full LifeOS suite access
- Personal memory (LanceDB + embeddings)
- Project memory (shared)
- Company memory (global)
- Kanban board (SQLite)
```

---

## Next: Phase 3 — Board Operations

### Phase 3A: Board Meeting Scheduler
- Weekly auto-meetings (Monday 9 AM)
- Agenda generation from LifeOS data
- Multi-agent conversation room
- Voting mechanism
- Meeting minutes storage

### Phase 3B: Inter-Agent Messaging
- Agent-to-agent message queue
- @mentions in Kanban comments
- Request/response protocol
- Escalation workflows

**Ready to proceed with Phase 3?**

---

## Phase 3: Organic Operations (COMPLETED ✅)

### Overview
Phase 3 implements human-like agent behaviors where agents:
- Initiate discussions organically
- Call board meetings by consensus (voting-based)
- Hire their own auxiliary staff
- Have visibility into reports' Kanban boards
- Escalate issues based on judgment

### Implementation Summary

#### 1. Organic Messaging System (`src/organic/messaging.ts`)
**Purpose:** Agent-to-agent communication with threading, escalation, and priority tracking.

**Key Features:**
- `message.send()` — Send message with priority (P1-P4) and response requirements
- `message.reply()` — Reply to existing thread
- `message.getThread()` — View conversation history
- `message.getThreads()` — List all threads for an agent
- `message.escalate()` — Escalate discussion to superior
- Unread message tracking

**Data Structures:**
- `Message` — Individual messages with priority, read status, response tracking
- `MessageThread` — Conversation threads with participants and status
- `Escalation` — Escalation records with reasons and resolution status

#### 2. Meeting Governance (`src/organic/meetings.ts`)
**Purpose:** Organic board meeting scheduling through voting/consensus.

**Voting Thresholds:**
| Urgency | Votes Required | Response Time |
|---------|---------------|---------------|
| P1 (Critical) | 3/7 | 1 hour |
| P2 (High) | 4/7 (majority) | 24 hours |
| P3 (Normal) | 5/7 (supermajority) | 72 hours |
| P4 (Low) | 6/7 (near-unanimous) | 1 week |

**Key Features:**
- `meeting.propose()` — Propose board meeting with urgency level
- `meeting.vote()` — Vote yes/no/abstain on proposals
- `meeting.schedule()` — Auto-schedule when threshold reached
- `meeting.recordMinutes()` — Store decisions and action items
- Automatic deadline tracking and expiration

**Data Structures:**
- `MeetingProposal` — Meeting requests with votes and deadlines
- `MeetingMinutes` — Decisions, action items, attendees

#### 3. Hiring & Delegation (`src/organic/hiring.ts`)
**Purpose:** Core staff can hire auxiliary teams and delegate work.

**Key Features:**
- `hire.create()` — Hire auxiliary staff (requires Level 3+ autonomy)
- `hire.fire()` — Release contractors with reason tracking
- `hire.getTeam()` — View all team members for a manager
- `delegate.to()` — Delegate tasks to reports
- `delegate.accept()` / `delegate.reject()` — Respond to delegations
- `delegate.update()` — Update task status (pending → in_progress → completed)

**Data Structures:**
- `EmploymentContract` — Hiring records with role, budget, tasks
- `Delegation` — Task assignments with status tracking

#### 4. Kanban Hierarchy (`src/kanban/sqlite.ts` extended)
**Purpose:** Manager visibility into reports' work without micromanagement.

**Key Features:**
- `board.viewReports()` — Manager views all direct reports' boards
- `board.reassign()` — Move cards between team members
- `board.escalate()` — Escalate blocked cards to manager
- `board.get()` — Enhanced to show full board with columns and cards

**Hierarchy Model:**
```
CMO (cmo-content)
├─ content-writer-1
│  └─ Board: Backlog → Drafting → Review → Done
├─ video-editor-1
│  └─ Board: Backlog → Editing → Rendering → Complete
└─ social-media-manager-1
   └─ Board: Backlog → Scheduling → Publishing → Analytics
```

### New MCP Tools (Phase 3)

| Category | Tools |
|----------|-------|
| **Messaging** | `message.send`, `message.reply`, `message.getThread`, `message.getThreads`, `message.escalate` |
| **Meetings** | `meeting.propose`, `meeting.vote`, `meeting.get`, `meeting.recordMinutes` |
| **Hiring** | `hire.create`, `hire.fire`, `hire.getTeam` |
| **Delegation** | `delegate.to`, `delegate.accept`, `delegate.reject`, `delegate.update`, `delegate.get` |
| **Kanban Hierarchy** | `board.viewReports`, `board.reassign`, `board.escalate` |

### Organic Behavior Examples

#### Example 1: Budget Discussion
```
1. CFO notices budget overrun → message.send(to: "CMO", priority: "P2", 
   content: "Content spend 40% over budget. Need to discuss reallocation.")

2. CMO responds → message.reply(thread_id: "...", content: "Let me share ROI metrics...")

3. CFO not satisfied → meeting.propose(title: "Q3 Budget Reallocation", 
   urgency: "P2", reason: "Content spend varies significantly by platform")

4. Board votes: CEO ✅, COO ✅, CPO ❌, CRO ✅, CMO ✅, Physician ❌
   Result: 4/7 = Majority → Meeting scheduled

5. Meeting held → meeting.recordMinutes(decisions: ["Pause Twitter spend"], 
   action_items: [{assignee: "CMO", description: "Reallocate budget to LinkedIn"}])
```

#### Example 2: Hiring Flow
```
1. CMO needs help → hire.create(role: "content-writer", reports_to: "cmo-content",
   tasks: ["blog posts", "case studies", "social media copy"])

2. CMO delegates → delegate.to(from: "cmo-content", to: "content-writer-xxx",
   task: "Write blog post on AI trends", priority: "P2", deadline: "2024-04-10")

3. Writer accepts → delegate.accept(delegation_id: "...")

4. Writer completes → delegate.update(delegation_id: "...", status: "completed")
```

#### Example 3: Manager Visibility
```
1. CMO checks team → board.viewReports(manager_id: "cmo-content")
   Result: Shows all 3 team members' boards with card counts

2. CMO sees blocked task → board.reassign(card_id: "...", 
   from_agent_id: "video-editor-1", to_agent_id: "content-writer-1")

3. Writer blocked → board.escalate(card_id: "...", 
   to_manager_id: "cmo-content", reason: "Need subject matter expert input")
```

### Files Created/Modified (Phase 3)

| File | Status | Purpose |
|------|--------|---------|
| `src/organic/messaging.ts` | ✅ Created | Agent-to-agent messaging |
| `src/organic/meetings.ts` | ✅ Created | Meeting governance |
| `src/organic/hiring.ts` | ✅ Created | Hiring/delegation |
| `src/kanban/sqlite.ts` | ✅ Modified | Added hierarchy support |
| `src/mcp/server.ts` | ✅ Modified | Integrated all organic tools |
| `src/types.ts` | ✅ Modified | Added organic system types |

### Testing Checklist

- [ ] Test message.send between agents
- [ ] Test meeting proposal and voting flow
- [ ] Test hiring auxiliary staff
- [ ] Test delegation workflow
- [ ] Test manager Kanban visibility
- [ ] Test card reassignment
- [ ] Test escalation workflows
- [ ] End-to-end organic behavior test via Telegram

### Next Steps (Phase 4+)

1. **Persistence Layer** — Store messages, meetings, contracts in SQLite/LanceDB
2. **Agent Autonomy Engine** — AI-driven decision making for when to message/meet/hire
3. **Telegram Integration** — Full conversational interface for all organic operations
4. **Analytics Dashboard** — Track team velocity, meeting frequency, delegation success
5. **Memory Integration** — Store all interactions in hierarchical memory for learning

---
