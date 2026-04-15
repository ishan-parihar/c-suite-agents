# Operant × OpenClaw Hybrid — Remaining Work Plan

**Date:** 2026-04-15
**Baseline:** Phase 1.5 & 2 complete (85% done)
**Goal:** Complete remaining items for full hybrid integration

---

## Remaining Items Summary

| Item | Phase | Status | Blocker |
|------|-------|--------|---------|
| **2.3** Remove sibling Telegram integration | Phase 2 | ❌ Pending | Requires agents running via openclaw |
| **3.4** Remove sibling MCP server | Phase 3 | ❌ Pending | Requires all tools ported to plugin |
| **3.1** Vector semantic search (deferred) | Phase 3 | ⏳ Deferred | openclaw memory-lancedb evaluation |

---

## Phase 2.3: Remove Sibling Telegram Integration

**File to deprecate:** `operant/src/integrations/telegram.ts`

### Why
OpenClaw handles 24+ channels natively (Telegram, WhatsApp, Slack, Discord, Signal, etc.). The sibling's Telegraf integration is redundant once agents run via openclaw.

### Prerequisite
Agents must be fully functional and receiving messages through openclaw's channel system.

### Implementation
1. Verify openclaw Telegram channel is configured and working
2. Run sibling in parallel with openclaw for a transition period
3. Point openclaw Telegram bot to same bot token
4. Disable telegram in sibling (`TELEGRAM_ENABLED=false`)
5. Remove `src/integrations/telegram.ts` and `src/integrations/telegram-media.ts`

### Verification
- [ ] Agents receive Telegram messages via openclaw
- [ ] No duplicate message delivery
- [ ] Telegram commands (`/org`, `/staff`, `/agents`) work via openclaw

**Effort:** 2-4 hours | **Dependencies:** Phase 2.1 complete (cron migration)

---

## Phase 3.4: Remove Sibling MCP Server

**Files to deprecate:**
- `operant/src/mcp/server.ts`
- `operant/src/mcp/bridge.ts`
- `operant/src/mcp/client.ts`
- `operant/src/mcp/tools-reports.ts`

### Why
All tools are now registered as openclaw plugin tools. The MCP server is redundant and adds overhead.

### Prerequisite
All 42+ MCP tools must have equivalent plugin tool implementations.

### Current Tool Coverage Audit (CORRECTED)

| MCP Tool Category | Count | Plugin Equivalent | Status |
|-------------------|-------|-------------------|--------|
| **Agent tools** | 6 | ⚠️ Partial | Missing: `agent_inbox`, `agent_meeting`, `task.get` |
| **Memory tools** | 3 | ⚠️ Partial | Missing: `memory_consolidate`, `memory_forget`, `memory_stats` |
| **Message tools** | 7 | ⚠️ Partial | Missing: `message_getUnread` |
| **Board/Kanban tools** | 7 | ✅ `kanban-tools.ts` | Complete |
| **Meeting tools** | 5 | ⚠️ Partial | Missing: `boardmeeting_run/status/get/list` |
| **Staff/Org tools** | 3 | ✅ `misc-tools.ts` (org.chart, staff_list) | Complete |
| **Hiring tools** | 2 | ✅ `hiring-tools.ts` | Complete |
| **Delegation tools** | 5 | ❌ Not ported | Missing: delegate_accept/reject/update/get/list |
| **LifeOS tools** | 2 | ✅ `lifeos-tools.ts` | Complete |
| **Broadcast tools** | 2 | ✅ `broadcast-tools.ts` | Complete |
| **Reports tools** | 2 | ✅ `misc-tools.ts` | **Already ported** |
| **Session tools** | 5 | ❌ Not ported | Only used by OpenCode; skip |
| **Cron tools** | 7 | ❌ Not ported | Phase 2.1 cron already migrated |
| **DB tools** | 6 | ❌ Not ported | openclaw handles natively |
| **Filesystem tools** | 4 | ❌ Not ported | openclaw handles natively |
| **Code tools** | 3 | ❌ Not ported | openclaw handles natively |
| **Notify tools** | 1 | ❌ Not ported | Telegram handled by openclaw channels |
| **Org health** | 1 | ❌ Not ported | openclaw monitors agents natively |

### Missing Tools to Port (Priority Order)
1. **`agent_inbox`** — Full inbox view (unread + pending + threads) in `misc-tools.ts`
2. **`boardmeeting_run`** — CEO-only board meeting execution in `meeting-tools.ts`
3. **`boardmeeting_status/get/list`** — Board meeting queries in `meeting-tools.ts`
4. **`message_getUnread`** — Unread message retrieval in `messaging-tools.ts`
5. **`delegate_accept/reject/update/get`** — Delegation management in `hiring-tools.ts`
6. **`memory_consolidate/forget/stats`** — Memory hygiene in `memory-tools.ts`
7. **`task_get`** — Get single task details in `kanban-tools.ts`

### Verification
- [ ] All priority tools work via plugin API
- [ ] No MCP tool calls in production logs

**Effort:** 4-6 hours | **Dependencies:** Phase 1.4 complete (all tools ported)

---

## Phase 3.1: Vector Semantic Search (Deferred)

**Current state:** Extension messaging uses LIKE-based search only
**Sibling state:** `src/organic/messaging.ts` has vector search with embeddings

### Decision Required

| Option | Approach | Pros | Cons |
|--------|----------|------|------|
| **A** | Use openclaw's `memory-lancedb` extension | No new infra, integrated | Different data model than messaging |
| **B** | Port sibling's vector search to extension | Exact feature match | Duplicates openclaw work |
| **C** | Keep semantic search in sibling only | Simple for now | Split responsibility |
| **D** | Build unified vector index for messages | Best UX | Complex implementation |

### Recommendation
**Option A** — Evaluate openclaw's `memory-lancedb` extension for messaging search:
- `openclaw/extensions/memory-lancedb/api.ts` already exists
- Create a `message_search_vector` tool that uses memory-lancedb for message embeddings
- Keep simple text search as fallback

### Implementation (if Option A)
1. Configure openclaw memory-lancedb extension
2. Create `message_search_vector` tool
3. Index new messages with embeddings
4. Migrate existing message history (optional, can be lazy)

**Effort:** 8-12 hours | **Dependencies:** Phase 2 complete

---

## Execution Order (CORRECTED)

```
Week 1: Phase 3.4 — Port agent_inbox, message_getUnread, task_get
Week 2: Phase 3.4 — Port boardmeeting tools
Week 3: Phase 3.4 — Port delegation tools
Week 4: Phase 3.4 — Port memory hygiene tools, remove MCP server
Week 5-6: Phase 2.3 — Telegram removal (if openclaw channel verified)
Week 7-8: Phase 3.1 — Vector search (evaluate + implement)
```

---

## Effort Summary (CORRECTED)

| Phase | Item | Effort | Dependencies |
|-------|------|--------|--------------|
| **3.4** | Port agent_inbox tool | 2-3 hours | None |
| **3.4** | Port boardmeeting tools (4 tools) | 3-4 hours | None |
| **3.4** | Port message_getUnread tool | 1-2 hours | None |
| **3.4** | Port delegate accept/reject/update/get | 2-3 hours | Phase 1.5 |
| **3.4** | Port memory consolidate/forget/stats | 2-3 hours | None |
| **3.4** | Port task_get tool | 1 hour | None |
| **3.4** | Remove MCP server | 2 hours | All tools ported |
| **2.3** | Verify openclaw Telegram | 2-3 hours | Cron migrated |
| **2.3** | Remove sibling Telegram | 1-2 hours | Telegram verified |
| **3.1** | Evaluate memory-lancedb | 4-6 hours | Phase 2 complete |
| **3.1** | Implement vector search | 4-6 hours | Evaluation done |
| **Total** | | **25-35 hours** | |

---

## Risk Register

| Risk | Likelihood | Impact | Mitigation |
|------|-------------|--------|------------|
| Telegram removal breaks user workflow | Low | High | Run in parallel during transition |
| MCP removal breaks legacy tool usage | Medium | High | Verify all tools have plugin equivalents |
| Vector search quality degrades with memory-lancedb | Low | Medium | Keep text search as fallback |
| openclaw memory-lancedb API changes | Medium | Medium | Pin extension version |

---

## Success Criteria

1. **No redundant systems** — Telegram and MCP only in one place
2. **Feature parity maintained** — All 42+ tools accessible via plugin
3. **Clean architecture** — Extension is canonical, sibling is deprecated
4. **Vector search available** — Semantic message search working

---

*Generated: 2026-04-15*
*Baseline: Phase 1.5 & 2 complete (~80% done - tool coverage was overestimated)*
*Next action: Port missing agent_inbox tool (Phase 3.4, Week 1)*
