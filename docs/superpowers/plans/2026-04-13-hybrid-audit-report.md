# Operant × OpenClaw Hybrid — Codebase Audit Report

**Date:** 2026-04-13
**Status:** Post-Phase-1 implementation (plugin skeleton complete)
**Scope:** Both repos (`operant/` + `openclaw/extensions/operant/`)

---

## 1. Executive Summary

The hybrid migration is in **Phase 1 (Plugin Shell)** — the openclaw extension exists with basic registration, but most functionality is either stubbed, deferred, or duplicated. The operant sibling repo remains a **fully standalone application** that runs independently. There is **zero code sharing** between them, and **3 files have unresolved git merge conflicts**.

### Key Findings

| Severity | Finding | Impact |
|---|---|---|
| **P0** | 3 files with unresolved git merge conflicts | Codebase may not compile/build |
| **P0** | `src/index.ts` contains divergent tool lists (merge conflict) | Runtime behavior undefined |
| **P1** | Kanban implemented twice with different schemas (operant: 308 lines, extension: 114 lines) | Maintenance debt, feature divergence |
| **P1** | Heartbeat monitoring implemented twice (operant: 555 lines, extension: 90 lines) | Redundant systems |
| **P1** | `lifeos_tools` return "deferred" — no PostgreSQL bridge | LifeOS non-functional in hybrid mode |
| **P1** | CLI subcommands are a 5-line stub (`extensions/operant/src/cli.ts`) | No operant CLI in openclaw |
| **P2** | No monorepo tooling connecting the repos | No shared types, deps, or builds |
| **P2** | Telegram integration exists in both systems | Duplicate channel handling |
| **P2** | Broadcast store uses `(api as any)` pattern throughout | Type-unsafe, fragile |

---

## 2. Current State Map

### What Exists in OpenClaw Extension (`openclaw/extensions/operant/`)

| Component | File(s) | Status | Notes |
|---|---|---|---|
| Plugin manifest | `openclaw.plugin.json` | **Complete** | Config schema for database, agents, broadcast, dashboard |
| Package config | `package.json` | **Complete** | v0.5.0, `@operant/openclaw-plugin` |
| Plugin entry | `index.ts` | **Complete** | Registers CLI, services, routes, tools, hooks |
| Runtime API | `runtime-api.ts` | **Complete** | Re-exports from `openclaw/plugin-sdk` |
| Types | `src/types.ts` | **Complete** | BroadcastMessage, AgentHeartbeatState, ConfigSchema |
| Broadcast store | `src/broadcast-store.ts` | **Complete** | SQLite WAL, CRUD, cleanup, tests |
| Broadcast service | `src/services/broadcast-service.ts` | **Complete** | Lifecycle + periodic cleanup |
| Heartbeat service | `src/services/heartbeat-service.ts` | **Complete** | In-memory tracking, alert on offline |
| Broadcast tools | `src/tools/broadcast-tools.ts` | **Complete** | broadcast_send, broadcast_read |
| Kanban tools | `src/tools/kanban-tools.ts` | **Complete** | kanban_list, kanban_create, kanban_update |
| Kanban adapter | `src/tools/kanban-adapter.ts` | **MVP** | Flat SQLite store, missing escalation/reassignment |
| LifeOS tools | `src/tools/lifeos-tools.ts` | **DEFERRED** | Returns `"status": "deferred"` — no PG connection |
| Policy hooks | `src/hooks/policy-hook.ts` | **Complete** | Rate limiting, access control, failure tracking |
| HTTP routes | `src/http/routes.ts` | **Complete** | `/operant/broadcasts`, `/operant/agents/status` |
| CLI | `src/cli.ts` | **STUB** | 5-line stub — Task 7 not implemented |
| Dashboard gateway client | `src/dashboard/gateway-client.ts` | **Complete** | WS client for gateway events |
| Dashboard gateway feed | `src/dashboard/gateway-feed.ts` | **Complete** | Server-side broadcast feed reader |
| Agent SOUL.md | `src/agents/*/SOUL.md` (8 files) | **Complete** | All 8 C-suite roles |
| Agents config | `agents-config.json` | **Complete** | 8 agent definitions with heartbeat + subagent perms |
| Cron config | `cron-config.json` | **Complete** | 4 scheduled jobs |
| Install/uninstall scripts | `install.sh`, `uninstall.sh` | **Complete** | Workspace setup, config merge |
| Tests | `src/__tests__/plugin-integration.test.ts` | **Complete** | Plugin integration tests |
| Broadcast tests | `src/broadcast-store.test.ts` | **Complete** | 4 test cases |

### What Still Runs Only in Operant Sibling (`operant/`)

| Component | File(s) | Status | Hybrid Plan |
|---|---|---|---|
| Native LLM runtime | `src/runtime/native-agent-runtime.ts` | **Active** | Phase 2: delegate to openclaw agent runtime |
| MCP server (42+ tools) | `src/mcp/server.ts` | **Active** | Phase 3: migrate tools → openclaw plugin tools |
| MCP bridge | `src/mcp/bridge.ts` | **Active** | Phase 3: replace with openclaw MCP |
| Telegram integration | `src/integrations/telegram.ts` | **Active** | **REMOVE** — openclaw handles Telegram channel |
| Agent scheduler | `src/scheduler/agent-scheduler.ts` | **Active** | Phase 2: use openclaw cron API |
| Agent executor | `src/scheduler/agent-executor.ts` | **Active** | Phase 2: delegate to openclaw |
| Session registry | `src/scheduler/session-registry.ts` | **Active** | Phase 2: read openclaw session files |
| Heartbeat system | `src/scheduler/heartbeat.ts` | **Active** | Phase 2: use openclaw heartbeat |
| Heartbeat monitor | `src/scheduler/heartbeat-monitor.ts` | **Active** | Merge with extension heartbeat service |
| Board meeting scheduler | `src/scheduler/board-meeting-scheduler.ts` | **Active** | Phase 4: port to openclaw |
| Message processor | `src/scheduler/message-processor.ts` | **Active** | Phase 3: port to openclaw |
| Meeting scheduler | `src/scheduler/meeting-scheduler.ts` | **Active** | Phase 4: port to openclaw |
| Organic messaging | `src/organic/messaging.ts` (638 lines) | **Active** | Merge with broadcast system |
| Board meetings | `src/organic/board-meeting.ts` | **Active** | Phase 4: port to openclaw |
| Hiring system | `src/organic/hiring.ts` | **Active** | Phase 4: port to openclaw |
| Vector memory | `src/memory/` (LanceDB + Ollama) | **Active** | Phase 4: evaluate openclaw memory-lancedb |
| Policy engine | `src/runtime/policy.ts` | **Active** | Merge with extension policy hooks |
| Recovery recipes | `src/runtime/recovery.ts` (7 scenarios) | **Active** | Phase 4: port recovery hook |
| Self-healer | `src/runtime/self-healer.ts` | **Active** | Phase 4: port to openclaw |
| Error observability | `src/runtime/error-*` (4 files) | **Active** | Phase 4: port to openclaw |
| WS transport | `src/transport/` (ws-client, ws-server) | **Active** | Phase 5: use openclaw gateway WS |
| LifeOS client | `src/lifeos/` (24 databases via Drizzle) | **Active** | Phase 3: connect via PostgreSQL bridge |
| Kanban (full) | `src/kanban/sqlite.ts` (308 lines) | **Active** | Consolidate with extension Kanban |
| WS server | `src/transport/ws-server.ts` | **Active** | Phase 5: replace with openclaw gateway |
| Next.js dashboard | `dashboard/` (36 pages) | **Active** | Phase 5: connect to openclaw gateway WS |

---

## 3. Duplicate Functionality Matrix

### 3.1 Kanban — **HIGH OVERLAP**

| Feature | Operant (`src/kanban/sqlite.ts`) | Extension (`src/tools/kanban-adapter.ts`) |
|---|---|---|
| Storage | `better-sqlite3` | `bun:sqlite` |
| Schema | boards + columns + cards + card_activity + reporting_lines | tasks + task_activity (flat) |
| Agent auth | `validateAgentIdentity()` | Plugin context only |
| Card model | Full: board_id, column_id, tags, assignee, project | Simple: title, description, priority, status |
| Transitions | Column-based (6 states) | Status-based (6 states) |
| Reassignment | Cross-board with manager validation | Not implemented |
| Escalation | Yes (`escalateCard`) | Not implemented |
| Manager view | `viewReportsBoard()` | Not implemented |
| Lines | **308** | **114** |

**Recommendation:** Port the sibling's full Kanban (308 lines) into the extension. The extension's flat schema is an MVP that will need all missing features eventually.

### 3.2 Heartbeat — **HIGH OVERLAP**

| Feature | Operant (`src/scheduler/heartbeat-monitor.ts`) | Extension (`src/services/heartbeat-service.ts`) |
|---|---|---|
| Detection | Polls AgentHealthRegistry, 4-state classification | In-memory state, 3-state (active/idle/error) |
| Recovery | SelfHealer integration with recipes | Broadcast alert only |
| Events | ErrorBus with heartbeat:missed/heartbeat:ok | Direct store writes |
| History | Bounded (max 50 entries) | None |
| Lines | **555** | **90** |

**Recommendation:** The extension's version is sufficient for openclaw integration since openclaw provides its own heartbeat/cron system. Port the recovery integration from the sibling.

### 3.3 Messaging / Broadcast — **HIGH OVERLAP**

| Feature | Operant (`src/organic/messaging.ts`) | Extension (`src/broadcast-store.ts` + tools) |
|---|---|---|---|
| Storage | sql.js (in-memory) | bun:sqlite (file-based) |
| Model | Messages + Threads + Escalations | Broadcast messages only |
| Priority | P1-P4 | info/action/alert/urgent |
| Vector search | Yes (embedding-based) | No |
| Threading | Full model with participants, status, summary | Simple thread_id reference |
| Escalation | 3-hop escalation chain | Not implemented |
| Lines | **638** | **226** (store + tools) |

**Recommendation:** Keep the extension's broadcast system (simpler, file-based, persistent). The sibling's organic messaging with vector search can be evaluated for migration later if semantic search is needed.

---

## 4. Critical Issues

### 4.1 Git Merge Conflicts (P0)

Three files have unresolved merge conflicts between `Updated upstream` and `Stashed changes`:

**`src/index.ts`** (lines 369-389):
- Conflict between **db.* tools** (PostgreSQL-native: `db.listTables`, `db.query`, `db.insert`, `db.update`, `db.delete`) and **lifeos_* tools** (45 legacy LifeOS tools like `lifeos_discover`, `lifeos_query`, `lifeos_query_db_schema`, etc.)
- This is the **core tool list** that defines what agents can call. The conflict must be resolved immediately.

**`src/mcp/server.ts`** (3 conflicts, lines 1244, 1342, 1510):
- MCP server tool definitions conflicting between new and old implementations
- Affects the MCP tool registry that agents depend on

**`dashboard/app/layout.tsx`** (2 conflicts, lines 4-9 and 53-73):
- Conflict between new sidebar/topbar/mobile components vs. old `DashboardChrome` wrapper
- Affects the dashboard UI rendering

### 4.2 LifeOS Deferred (P1)

Both `lifeos_query` and `lifeos_write` tools in the extension return `"status": "deferred"` with a note requiring a sibling PostgreSQL process. This means **agents cannot actually read or write LifeOS data** through the openclaw plugin. The PostgreSQL bridge (Phase 3, Task 5.1) is not yet implemented.

### 4.3 No Monorepo (P2)

The two repos are completely separate git repositories with:
- No `pnpm-workspace.yaml`
- No `lerna.json`
- No `turbo.json`
- No shared `packages/` directory
- Zero npm-level cross-dependencies

This means types, utilities, and configuration must be manually duplicated between repos.

### 4.4 SQLite Engine Divergence (P2)

- Operant sibling uses `better-sqlite3` (Node.js package)
- OpenClaw extension uses `bun:sqlite` (Bun-native, no npm package)
- If the extension needs to run in a Node.js context (not Bun), it will break

### 4.5 Type Safety: `(api as any)` Pattern (P2)

The extension stores the broadcast store on the API context using `(api as any)._broadcastStore`. This pattern appears in:
- `src/tools/broadcast-tools.ts`
- `src/tools/kanban-adapter.ts`
- `src/hooks/policy-hook.ts`
- `src/http/routes.ts`

This should use proper type injection via `OpenClawPluginServiceContext`.

---

## 5. Integration Gap Analysis

### What the Plan Envisioned vs. What Exists

| Plan Phase | Planned | Status | Gap |
|---|---|---|---|---|
| Phase 1: Plugin Skeleton | Manifest, package, entry, broadcast store + service | **Complete** | None |
| Phase 2: Agent Config | 8 SOUL.md files, agents-config.json | **Complete** | None |
| Phase 3: Plugin Tools | Broadcast tools, Kanban tools, LifeOS tools | **Partial** | LifeOS deferred, Kanban MVP only |
| Phase 4: Hooks + HTTP | Policy hooks, HTTP routes | **Complete** | None |
| Phase 5: Dashboard Integration | WS gateway client, broadcast feed | **Partial** | Gateway client exists but not wired to dashboard |
| Phase 6: Cron Migration | Adapt agent-scheduler to openclaw cron | **Not Started** | Operant still runs own scheduler |
| Phase 7: CLI | operant subcommands via openclaw | **Stub** | Task 7 not implemented |

---

## 6. Recommended Next Phases

### Phase 1.5: Resolve Conflicts (Immediate)
1. Resolve 3 merge conflicts in `src/index.ts`, `src/mcp/server.ts`, `dashboard/app/layout.tsx`
2. Decide: db.* tools (new PostgreSQL approach) vs lifeos_* tools (legacy MCP approach)
3. Run `bun test` to verify no regressions

### Phase 2: Tool Consolidation
1. Port full Kanban (308 lines) from operant sibling → extension
2. Connect LifeOS PostgreSQL bridge (replace "deferred" with actual PG connection)
3. Standardize on `bun:sqlite` or `better-sqlite3` for all SQLite usage
4. Fix `(api as any)` pattern with proper type injection

### Phase 3: CLI Implementation
1. Implement CLI subcommands in `extensions/operant/src/cli.ts`
2. Port: status, board, broadcast, kanban commands from sibling
3. Keep sibling's onboard/doctor/configure/daemon as standalone utilities

### Phase 4: Runtime Migration
1. Adapt operant's agent-scheduler to use openclaw cron API
2. Wire operant's dashboard WS client to openclaw gateway
3. Remove sibling's Telegram integration (openclaw handles it)
4. Port board meeting engine to openclaw plugin

### Phase 5: Cleanup
1. Remove duplicate heartbeat systems (consolidate into openclaw's)
2. Remove duplicate messaging (consolidate into broadcast system)
3. Consider monorepo setup for shared types
4. Remove sibling's MCP server (openclaw provides tools)

---

## 7. File Inventory

### Operant Sibling — Files to Eventually Deprecate/Remove

| File | Reason |
|---|---|
| `src/integrations/telegram.ts` | OpenClaw handles Telegram |
| `src/integrations/telegram-media.ts` | OpenClaw handles Telegram |
| `src/scheduler/agent-scheduler.ts` | Replace with openclaw cron |
| `src/scheduler/agent-executor.ts` | Delegate to openclaw |
| `src/scheduler/heartbeat.ts` | Use openclaw heartbeat |
| `src/mcp/server.ts` | Replace with openclaw plugin tools |
| `src/mcp/bridge.ts` | Replace with openclaw MCP |
| `src/transport/ws-server.ts` | Use openclaw gateway WS |
| `src/runtime/native-agent-runtime.ts` | Delegate to openclaw agent runtime |
| `src/organic/messaging.ts` | Consolidate with broadcast system |

### Operant Sibling — Files to Keep as Sibling Process

| File | Reason |
|---|---|
| `src/lifeos/` | 24 databases, Drizzle ORM, PostgreSQL |
| `src/kanban/sqlite.ts` | Full Kanban (port to extension, then remove) |
| `src/organic/board-meeting.ts` | Quorum voting (port to extension) |
| `src/organic/hiring.ts` | Agent hiring (port to extension) |
| `src/memory/` | LanceDB vector memory (evaluate migration later) |
| `src/runtime/recovery.ts` | 7 recovery recipes (port to extension) |
| `src/runtime/self-healer.ts` | Self-healing (port to extension) |
| `src/runtime/policy.ts` | Policy engine (merge with extension hooks) |
| `dashboard/` | Next.js 36-page dashboard |

---

*Generated: 2026-04-13*
*Sources: Direct grep/read of both repos, 3 parallel explore agents, hybrid plan document*
