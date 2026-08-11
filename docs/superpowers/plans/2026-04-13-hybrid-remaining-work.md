# Operant × OpenClaw Hybrid — Remaining Work Report

**Date:** 2026-04-13
**Baseline:** Merge conflicts resolved, audit complete
**Goal:** Full hybrid migration — operant as native openclaw plugin with sibling PostgreSQL + Next.js dashboard

---

## Phase 0: Debt & Quality (Before Building New)

### 0.1 — Remove `(api as any)` Pattern (Type Safety)

**Files affected:** `extensions/operant/src/tools/broadcast-tools.ts`, `src/tools/kanban-adapter.ts`, `src/hooks/policy-hook.ts` (line 53), `src/http/routes.ts` (lines 30, 53)

**Problem:** The broadcast store is injected via `(api as any)._broadcastStore` — type-unsafe, fragile, breaks on any plugin SDK change.

**Fix:** Use a proper shared context object. Options:
- **A (Recommended):** Create `src/plugin-context.ts` — a typed module that services register on and tools read from
- **B:** Pass store via `OpenClawPluginServiceContext` and inject into tools at registration time

**Effort:** 2 hours | **Dependencies:** None

---

### 0.2 — Standardize SQLite Engine

**Problem:** Extension uses `bun:sqlite` (Bun-native, no npm package), sibling uses `better-sqlite3` (Node.js package). The `gateway-feed.ts` already imports `better-sqlite3` while `kanban-adapter.ts` uses `bun:sqlite`. **They can't run in the same runtime.**

**Decision needed:**
- If openclaw runs on Bun → standardize on `bun:sqlite`
- If openclaw runs on Node → switch all to `better-sqlite3`
- Check openclaw's runtime to determine

**Effort:** 2-4 hours | **Dependencies:** None (purely technical)

---

### 0.3 — Fix Pre-existing Type Errors in `src/lifeos/tools.ts`

**47 TypeScript errors** in the sibling's LifeOS tools file. Not merge-conflict-related — these are API drift issues:
- `$gte`, `$lte`, `$in`, `$eq` filter operators not matching current `PostgresClient` type signatures
- `.rows` property missing from `QueryResult<unknown>`
- `getSchema` method doesn't exist on `PostgresClient`
- `orderBy` type mismatch (array vs string)

**Impact:** These errors are in the sibling process (standalone operant). Won't break the openclaw extension, but blocks `bun build` and CI.

**Effort:** 4-6 hours | **Dependencies:** Understanding of `PostgresClient` API

---

## Phase 1.5: Plugin Foundation (Highest Priority)

### 1.1 — Implement CLI Subcommands

**File:** `extensions/operant/src/cli.ts` (currently 5-line stub)

**Spec from plan (Phase 7):**
- `openclaw operant status` — System overview: agent health, broadcast count, kanban stats, DB connection
- `openclaw operant broadcast list [--agent X] [--since Y]` — List broadcasts
- `openclaw operant broadcast send --to X --priority Y --subject Z --content W` — Send broadcast
- `openclaw operant kanban list [--agent X] [--status Y]` — List Kanban tasks
- `openclaw operant kanban create --agent X --title Y [--priority Z]` — Create task
- `openclaw operant kanban move --task X --status Y` — Move task

**Pattern reference:** `openclaw/extensions/qa-lab/` for CLI registration pattern, sibling's `src/cli/program.ts` for subcommand logic

**Effort:** 6-8 hours | **Dependencies:** 0.1 (type-safe store access), broadcast-tools.ts, kanban-tools.ts

---

### 1.2 — Build PostgreSQL Bridge for LifeOS

**Files:** `extensions/operant/src/tools/lifeos-tools.ts` (both tools return `"status": "deferred"`)

**Problem:** Agents call `lifeos_query` and `lifeos_write` but get back "deferred" with no actual DB connection. The hybrid architecture needs a bridge between openclaw (running the tools) and the sibling PostgreSQL process.

**Architecture options:**

| Option | How | Pros | Cons |
|---|---|---|---|
| **A. HTTP endpoint on sibling** | Sibling exposes `/api/lifeos/query` and `/api/lifeos/write`; extension calls via `fetch()` | Clean separation, no code sharing | Adds latency, requires sibling running |
| **B. Direct PG connection in extension** | Extension connects to PostgreSQL directly via `pg` or `postgres.js` | Zero latency, simple | Duplicates connection logic |
| **C. Shared memory / file socket** | Use UNIX socket or shared file for IPC | Fast, no network | Platform-specific, complex |
| **D. Use openclaw's memory-host-sdk** | Route through openclaw's existing memory system | No new infra | May not support 24-table LifeOS schema |

**Recommendation: Option A** — Create a lightweight HTTP API in the sibling that handles authenticated LifeOS queries. The extension already has an HTTP route system (`src/http/routes.ts`) that can act as a proxy.

**Implementation:**
1. Add route to sibling: `GET/POST /api/lifeos/query` with agent auth
2. Update `lifeos-tools.ts` to call sibling endpoint instead of returning "deferred"
3. Add error handling for sibling offline

**Effort:** 8-12 hours | **Dependencies:** 0.2 (SQLite decision affects sibling runtime)

---

### 1.3 — Port Full Kanban System

**Current state:** Extension has 114-line flat Kanban (`kanban-adapter.ts`), sibling has 308-line production Kanban (`src/kanban/sqlite.ts`)

**What the sibling has that the extension lacks:**
- Board abstraction (per-agent boards with named columns)
- Card model: `board_id`, `column_id`, `tags`, `assignee_agent_id`, `project_id`
- Cross-board reassignment with manager validation
- Card escalation (`escalateCard`)
- Manager view (`viewReportsBoard`)
- Activity log with structured events
- Agent identity validation (`validateAgentIdentity`)
- Atomic file writes with tmp+rename pattern

**What the extension has:**
- Bun-compatible SQLite (`bun:sqlite`)
- Simple flat task model
- Basic CRUD (list, create, update status)

**Port strategy:**
1. Adapt sibling's `Kanban` class to use the extension's SQLite engine (from 0.2)
2. Update `kanban-tools.ts` to use full schema
3. Update `kanban-adapter.ts` with boards + columns + cards schema
4. Add missing tools: `kanban_reassign`, `kanban_escalate`, `kanban_reports`

**Effort:** 6-8 hours | **Dependencies:** 0.2 (SQLite engine), 1.1 (CLI for testing)

---

### 1.4 — Add Missing Plugin Tools

**Current extension tools (5):** `lifeos_query`, `lifeos_write`, `kanban_list`, `kanban_create`, `kanban_update`, `broadcast_send`, `broadcast_read`

**Missing from sibling's 42+ tool set:**

| Tool Category | Missing Tools | Priority |
|---|---|---|---|
| **Kanban** | `kanban_reassign`, `kanban_escalate`, `kanban_reports` | P1 (after 1.3) |
| **Meetings** | `boardmeeting_run`, `boardmeeting_status` | P2 |
| **Messaging** | `message_send`, `message_reply`, `message_getThread`, `message_search` | P2 |
| **Agent** | `agent.handoff`, `agent.wake`, `agent.status` | P2 |
| **Organization** | `org.chart`, `org.health`, `staff.list` | P3 |
| **Reports** | `reports.save`, `reports.getLatest` | P3 |
| **Heartbeat** | `heartbeat.runNow` | P2 |
| **Notifications** | `notify.telegram` | P3 (openclaw handles Telegram) |

**Implementation pattern:** Each tool follows the `api.registerTool()` pattern in `src/tools/*.ts`

**Effort:** 12-16 hours total | **Dependencies:** 1.1 (CLI), 1.2 (LifeOS bridge), 1.3 (Kanban port)

---

### 1.5 — Port Board Meeting Engine

**Source:** `src/organic/board-meeting.ts` (sibling)

**What it does:**
- Propose → Vote → Record Minutes with quorum enforcement
- Board meeting lifecycle: scheduled → in-progress → concluded
- Quorum calculation (majority of C-suite)
- Vote recording with agent identity
- Meeting minutes generation

**Port to:** `extensions/operant/src/tools/meeting-tools.ts` (new file per plan)

**Effort:** 6-8 hours | **Dependencies:** 1.4 (agent tools for identity)

---

### 1.6 — Port Recovery System

**Source:** `src/runtime/recovery.ts` (7 failure scenarios), `src/runtime/self-healer.ts`, `src/runtime/error-*` (4 files)

**What it does:**
- 7 encoded failure scenarios: heartbeat, message, memory, kanban, MCP, LLM, Telegram
- Auto-recovery attempt (1) + escalation to CEO
- Event-driven error aggregation and alert management

**Port to:** `extensions/operant/src/hooks/recovery-hook.ts` (per plan) — `PostToolUseFailure` recovery triggers

**Effort:** 6-8 hours | **Dependencies:** 1.4 (policy hooks already exist as foundation)

---

## Phase 2: Runtime Migration

### 2.1 — Adapt Agent Scheduler to OpenClaw Cron

**Source:** `src/scheduler/agent-scheduler.ts`, `src/scheduler/heartbeat.ts`
**Target:** openclaw's `src/cron/service.ts` (78 files, production-grade)

**What needs to change:**
- Operant currently runs its own cron via `cron-parser` package
- Openclaw has a native cron service with delivery plans, isolated agents, heartbeat awareness
- Existing cron seeds in `src/index.ts` (CEO, COO, CPO, CRO daily/weekly/monthly jobs) need to migrate to openclaw cron API

**Implementation:**
1. Remove `cron-parser` dependency from operant
2. Create cron job definitions matching openclaw's `CronSchedule` format
3. Register jobs via openclaw's cron API during plugin registration
4. Migrate existing seeded jobs (CIO daily brief, CEO brief, COO check, etc.)

**Effort:** 8-12 hours | **Dependencies:** Phase 1.5 complete

---

### 2.2 — Wire Dashboard to OpenClaw Gateway

**Source:** `dashboard/lib/server/` (Next.js dashboard server routes)
**Target:** openclaw gateway WebSocket (`ws://localhost:7891`)

**What exists:**
- `extensions/operant/src/dashboard/gateway-client.ts` — WebSocket client (159 lines, complete)
- `extensions/operant/src/dashboard/gateway-feed.ts` — Server-side broadcast reader (102 lines, complete)
- Both files are **not wired** into the dashboard's Next.js API routes

**What's missing:**
- Dashboard has no WS connection to openclaw gateway
- Real-time agent data not flowing to dashboard pages
- Activity stream (`dashboard/lib/activity-stream.ts`) reads openclaw session files but doesn't use live WS

**Implementation:**
1. Create `dashboard/app/api/gateway/route.ts` — Next.js route that proxies WS events
2. Initialize `GatewayClient` on dashboard startup
3. Wire real-time events to dashboard pages (agent status, broadcast feed, kanban updates)
4. Replace polling-based activity stream with WS event stream

**Effort:** 8-10 hours | **Dependencies:** Phase 1.5 complete

---

### 2.3 — Remove Sibling's Telegram Integration

**Files to deprecate in sibling:**
- `src/integrations/telegram.ts` (Telegraf bot)
- `src/integrations/telegram-media.ts`

**Reason:** Openclaw handles 24+ channels natively (Telegram, WhatsApp, Slack, Discord, Signal, etc.). The sibling's Telegraf integration becomes redundant once agents run via openclaw.

**Caveat:** Can only remove this after openclaw agents are fully functional and receiving messages through openclaw's channels.

**Effort:** 2 hours (remove) + testing | **Dependencies:** Phase 2 complete, agents running via openclaw

---

### 2.4 — Consolidate Duplicate Systems

| System | Sibling (operant) | Extension (openclaw) | Resolution |
|---|---|---|---|
| **Heartbeat** | `src/scheduler/heartbeat-monitor.ts` (555 lines) | `src/services/heartbeat-service.ts` (90 lines) | Keep extension version (simpler, openclaw-integrated). Port recovery triggers from sibling's monitor |
| **Messaging** | `src/organic/messaging.ts` (638 lines, vector search) | `src/broadcast-store.ts` + tools (226 lines) | Keep extension's broadcast system. Defer vector search to Phase 3 |
| **Policy engine** | `src/runtime/policy.ts` (AND/OR combiners, 4 policy types) | `src/hooks/policy-hook.ts` (rate limiting, access control) | Merge: port AND/OR combiner logic into extension hooks |
| **LLM runtime** | `src/runtime/native-agent-runtime.ts` (direct LLM execution) | openclaw's Pi agent runtime | **Delegated** — extension uses openclaw runtime, no port needed |

**Effort:** 8-10 hours | **Dependencies:** Phase 2.1 complete

---

## Phase 3: Cleanup & Optimization

### 3.1 — Port Vector Memory (LanceDB + Ollama)

**Source:** `src/memory/` (LanceDB vector store, Ollama embeddings, dedup, decay, consolidation)

**Current status:** Extension has no memory system. Agents can't do semantic search, memory recall, or vector-based deduplication.

**Options:**
- **A:** Port LanceDB + Ollama into extension as plugin tools (`memory.search`, `memory.recall`, etc.)
- **B:** Evaluate openclaw's `packages/memory-host-sdk` as replacement
- **C:** Keep as sibling process only, accessed via LifeOS bridge

**Recommendation:** Option A for now (direct port), evaluate Option B later when openclaw memory system matures.

**Effort:** 12-16 hours | **Dependencies:** Phase 2 complete

---

### 3.2 — Port Hiring System

**Source:** `src/organic/hiring.ts`

**What it does:** Agent hiring/firing with budget controls, SQLite-backed contracts, manager approval workflow

**Port to:** `extensions/operant/src/tools/hiring-tools.ts` (new file)

**Effort:** 4-6 hours | **Dependencies:** Phase 1.5 complete

---

### 3.3 — Consider Monorepo Setup

**Current:** Two separate git repos, zero code sharing, manual type duplication

**Options:**
- **A:** Git submodule (operant inside openclaw as `extensions/operant`)
- **B:** pnpm workspace at `/home/ishanp/Documents/GitHub/` level with shared `packages/operant-types`
- **C:** Keep separate repos, use npm package for shared types

**Recommendation:** Option B for active development. Git submodules add friction; npm packages add publish overhead.

**Effort:** 4-6 hours (initial setup) | **Dependencies:** None

---

### 3.4 — Remove Sibling's MCP Server

**Files:** `src/mcp/server.ts`, `src/mcp/bridge.ts`, `src/mcp/client.ts`

**Reason:** Once all tools are registered as openclaw plugin tools, the sibling's MCP server is redundant.

**Caveat:** Only after Phase 1.4 (all tools ported) and Phase 2.3 (Telegram removed)

**Effort:** 2 hours (remove) + testing | **Dependencies:** Phase 2.3, Phase 1.4 complete

---

## Effort Summary

| Phase | Items | Total Effort | Dependencies |
|---|---|---|---|
| **0. Debt & Quality** | 0.1-0.3 | 8-12 hours | None |
| **1.5 Plugin Foundation** | 1.1-1.6 | 44-60 hours | 0.1-0.2 |
| **2. Runtime Migration** | 2.1-2.4 | 26-34 hours | Phase 1.5 |
| **3. Cleanup** | 3.1-3.4 | 22-28 hours | Phase 2 |
| **Total** | 16 items | **100-134 hours** | — |

---

## Execution Order (Recommended)

```
Week 1: 0.1 → 0.2 → 1.1 → 1.3    (Foundation + Kanban)
Week 2: 1.2 → 1.4 → 1.5           (LifeOS bridge + tools + meetings)
Week 3: 1.6 → 2.1 → 2.2           (Recovery + cron migration + dashboard WS)
Week 4: 2.3 → 2.4 → 0.3           (Telegram removal + consolidation + type fixes)
Week 5: 3.1 → 3.2 → 3.3 → 3.4     (Memory + hiring + monorepo + MCP cleanup)
```

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| openclaw plugin SDK API changes | Medium | High | Pin to specific openclaw version, add integration tests |
| `bun:sqlite` vs `better-sqlite3` runtime conflict | High | Medium | Decide in 0.2 before building anything |
| LifeOS bridge latency between sibling and extension | Medium | Medium | Add caching layer, benchmark before choosing architecture |
| Sibling process crash breaks dashboard WS | Medium | High | GatewayClient already has reconnect logic (10 attempts) |
| Pre-existing 47 type errors in lifeos/tools.ts | Certain | Low | Isolated to sibling, doesn't affect extension |
| Telegram removal breaks user's workflow | Low | High | Verify openclaw Telegram channel works before removing sibling's |

---

*Generated: 2026-04-13*
*Baseline: Merge conflicts resolved, Phase 1 plugin shell complete*
*Next action: Start with 0.1 (type safety) or jump to 1.1 (CLI) if you want visible progress fast*
