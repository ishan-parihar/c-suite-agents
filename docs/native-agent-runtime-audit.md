# Native Agent Runtime Audit Report

**Date**: 2026-04-04
**Scope**: `src/runtime/` (native-agent-runtime.ts, context-manager.ts, prompt-builder.ts, tool-bridge.ts)
**Consumers**: `src/scheduler/agent-executor.ts`, `src/scheduler/session-registry.ts`, `src/index.ts`
**Reference Implementations**: OpenClaw (`/tmp/openclaw/src/agents/`), OpenCode (`/tmp/opencode/packages/opencode/src/session/`)

---

## Executive Summary

The native agent runtime successfully replaces the OpenCode HTTP dependency with direct LLM API calls. TypeScript compiles clean, builds succeed. However, **14 issues** were identified across context management, token estimation, compaction strategy, error handling, and memory management. 5 are CRITICAL.

The most severe finding: **compaction does not actually summarize content**. When triggered, it replaces conversation history with meaningless metadata (message counts + truncated text snippets), losing all actionable context the agent needs to continue work.

---

## CRITICAL Issues

### 1. Compaction Summary is Meaningless
**File**: `src/runtime/context-manager.ts:271-293`
**Problem**: `summarizeMessages()` doesn't summarize. It counts user/assistant turns and shows first 80 chars of 3 messages:
```
"This conversation had 4 user messages and 4 assistant responses. Key topics covered: heartbeat check | domain check | ..."
```
**OpenClaw pattern**: `summarizeInStages()` — splits messages by token share, summarizes each chunk via LLM, merges partial summaries. Includes identifier preservation, retry logic (3 attempts, exponential backoff with jitter), adaptive chunk ratios.
**OpenCode pattern**: Dedicated LLM call with structured template — Goal, Instructions, Discoveries, Accomplished, Relevant files/directories.
**Impact**: Agent loses ALL actionable context after compaction. Cannot continue work.

### 2. Token Estimation is 20%+ Inaccurate
**File**: `src/runtime/context-manager.ts:263-265`
**Problem**: `Math.ceil(text.length / 4)` — raw character division. No safety margin. No model-specific tokenization awareness.
**OpenClaw**: `SAFETY_MARGIN = 1.2` (20% buffer on every estimate)
**Impact**: Code-heavy messages (tool results, JSON) can be 2x the estimate. Silent context window overflow.

### 3. No Tool Result Pruning — Linear Context Growth
**File**: `src/runtime/context-manager.ts:136-156`
**Problem**: Every tool result adds a full `role: "user"` message. Results accumulate forever. No pruning of old tool outputs.
**OpenCode pattern**: `prune()` walks backwards through tool calls, erases outputs older than 40K-token protection window, only prunes if 20K+ tokens freed. Protects certain tool types.
**Impact**: A single heartbeat with 10 tool calls adds 15K+ tokens. After a few cycles, context is saturated with old tool outputs.

### 4. Flat 128K Context Limit — No Model Awareness
**File**: `src/runtime/context-manager.ts:41`, `native-agent-runtime.ts:41`
**Problem**: `maxContextTokens: 128000` hardcoded regardless of model.
**OpenClaw**: Resolves from model config (fallback 200K for Claude Opus). Warns below 32K, blocks below 16K.
**Impact**: Ollama llama3.1:8b has 8K context. We budget 128K. LLM truncates mid-conversation with no warning.

### 5. In-Memory Sessions — No Persistence
**File**: `src/runtime/context-manager.ts:50` (`Map<string, AgentSession>`)
**Problem**: All conversation history is in-memory only. `SessionRegistry` persists session IDs to SQLite but NOT conversation content.
**Impact**: On restart, agents start with only the system prompt. All conversation context, tool findings, and memory from previous interactions is gone.

---

## HIGH Issues

### 6. Retry Logic Inadequate
**File**: `src/runtime/native-agent-runtime.ts:331-356`
**Problem**: Single retry with fixed 2s delay, only for 5xx/connection errors. No 429 handling, no exponential backoff, no jitter.
**OpenClaw**: 3 attempts, exponential backoff (500ms → 5000ms), 20% jitter, configurable retry predicate.

### 7. System Prompt Wastes Tokens on Irrelevant Context
**File**: `src/runtime/prompt-builder.ts:35-79`
**Problem**: `mode: "heartbeat"` still loads workspace context, full tool lists, org sections. Only `mode: "minimal"` skips workspace.
**OpenClaw**: `minimal` mode skips memory, reply tags, messaging, voice, docs, and owner identity sections entirely.
**Impact**: Heartbeat calls waste 2-4K tokens on unnecessary context.

### 8. JSON Parse Failures Silently Default to Empty Args
**File**: `src/runtime/native-agent-runtime.ts:154-159`
**Problem**: Malformed JSON from LLM → `{}` → tool called with no arguments.
**Impact**: `memory.search({})` returns everything. Silent failures.

### 9. No Real Conversation Detection
**Problem**: Compacts all sessions identically, including heartbeat-only sessions full of "HEARTBEAT_OK".
**OpenClaw**: `isRealConversationMessage()` filters out heartbeat-only exchanges, silent replies, and tool-metadata-only messages.

### 10. Cumulative Usage Tracking is Wrong
**File**: `src/runtime/native-agent-runtime.ts:135-140`
**Problem**: `usage.total += response.usage.total_tokens` across rounds double-counts the growing prompt (which includes all previous tool results).
**Impact**: Token usage stats inflated 2-3x.

---

## MEDIUM Issues

### 11. No LRU Eviction for Old Sessions
**Problem**: Sessions in `Map` are never evicted. Grows unbounded.
**Impact**: Memory leak over days/weeks.

### 12. No Identifier Preservation in Summaries
**OpenClaw**: "Preserve all opaque identifiers exactly as written — UUIDs, hashes, IDs, API keys, hostnames, IPs, ports, URLs, file names."
**Our code**: Summaries lose all identifiers.

### 13. Compaction Summary Role is Wrong
**File**: `src/runtime/context-manager.ts:201-203`
**Problem**: Summary added as `role: "user"` — breaks conversation flow for the LLM.
**Best practice**: Should be a system-level annotation.

### 14. No Streaming Support
**Problem**: Blocking `chat.completions.create()` — no delta updates, no progress visibility.
**Impact**: Long multi-tool operations appear frozen.

---

## Reference Patterns Worth Adopting

| Pattern | Source | Description |
|---------|--------|-------------|
| Staged summarization | OpenClaw `summarizeInStages()` | Split by token share → summarize each → merge |
| Adaptive chunk ratios | OpenClaw `computeAdaptiveChunkRatio()` | Smarter splitting based on avg message size |
| Tool result pruning with protection window | OpenCode `prune()` | Reclaims tokens, keeps recent 40K |
| Identifier preservation | OpenClaw `IDENTIFIER_PRESERVATION_INSTRUCTIONS` | Summaries remain actionable |
| Real conversation detection | OpenClaw `isRealConversationMessage()` | Skip compacting heartbeat-only sessions |
| Structured summary template | OpenCode `defaultPrompt` | Goal/Instructions/Discoveries/Accomplished/Files |
| Retry with exponential backoff + jitter | OpenClaw `retryAsync()` | 3 attempts, 500ms→5000ms, 20% jitter |
| Context window from model config | OpenClaw `resolveContextWindowInfo()` | Accurate per-model token budgets |

---

## Fix Plan (Priority Order)

| # | Fix | Severity | Files | Est. Effort |
|---|-----|----------|-------|-------------|
| 1 | Token estimation with 1.2x safety margin | CRITICAL | context-manager.ts | Low |
| 2 | LLM-based staged summarization (split→summarize→merge) | CRITICAL | context-manager.ts, native-agent-runtime.ts | High |
| 3 | Tool result pruning with protection window | CRITICAL | context-manager.ts | Medium |
| 4 | Model-aware context windows | CRITICAL | context-manager.ts, native-agent-runtime.ts | Medium |
| 5 | Retry with exponential backoff + jitter | HIGH | native-agent-runtime.ts | Medium |
| 6 | Real conversation detection | MEDIUM | context-manager.ts | Low |
| 7 | System prompt efficiency (conditional sections by mode) | HIGH | prompt-builder.ts | Medium |
| 8 | Session persistence bridge (ContextManager ↔ SessionRegistry) | CRITICAL | context-manager.ts, session-registry.ts | High |
| 9 | LRU eviction + memory leak prevention | MEDIUM | context-manager.ts | Low |
| 10 | Identifier preservation in summaries | MEDIUM | context-manager.ts | Low |
| 11 | Fix cumulative usage tracking | HIGH | native-agent-runtime.ts | Low |
| 12 | Fix compaction summary role | MEDIUM | context-manager.ts | Low |

---

*Audit conducted by comparing Operant implementation against OpenClaw (722-line system prompt builder, 530-line compaction module) and OpenCode (428-line compaction module) reference implementations.*
