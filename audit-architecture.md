# Strategos Architecture Audit

## Current State (What Exists)

### ✅ Implemented
- MCP Server with orchestration tools (agent.*, memory.*, board.*, heartbeat.*)
- LanceDB memory with qwen3-embedding:0.6b
- SQLite Kanban (sql.js WASM)
- Telegram bot with basic commands (/agents, /task)
- Heartbeat scheduler stub

### ❌ Missing (Critical Gaps)

1. **No Conversational Interface to Strategos**
   - You cannot TALK to Strategos like an AI agent
   - Telegram only has rigid commands, not natural language
   - No LLM processing your requests and responding intelligently

2. **No Actual Sub-Agent Runtime**
   - `agent.create` just creates DB records — no actual AI worker spawned
   - Sub-agents don't exist as running processes with their own LLM context
   - No OpenCode ACP session management per agent

3. **No Instruction Composer**
   - Strategos doesn't compose rich instructions for sub-agents
   - Missing: project context + Kanban focus + memory recall snippets
   - No delegation workflow where Strategos assigns work to employees

4. **No Self-Managing Kanban per Agent**
   - Kanban is passive — sub-agents don't update their own boards
   - No recall.search / remember.write tools for sub-agents
   - Strategos audits nothing because sub-agents don't exist

5. **No Heartbeat Auditing**
   - Heartbeat just logs — doesn't check progress, blockers, quality
   - No escalation when sub-agents are stuck
   - No rollup summaries of agent work

## Target Architecture (What You Want)

```
┌─────────────────────────────────────────────────────────────┐
│                    YOU (User/Founder)                       │
│              Talk via Telegram / CLI / HTTP                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  STRATEGOS (CEO Agent — LLM-Powered, Conversational)        │
│  - Understands natural language requests                    │
│  - Delegates to sub-agents like employees                   │
│  - Audits progress via heartbeat                            │
│  - Composes rich instructions with memory recall            │
│  - Exposes MCP tools for external orchestration             │
└─────────────────────────────────────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
     ┌────────────┐  ┌────────────┐  ┌────────────┐
     │ Agent 1    │  │ Agent 2    │  │ Agent 3    │
     │ (Developer)│  │ (Researcher)│ │ (Writer)   │
     │            │  │            │  │            │
     │ - Own LLM  │  │ - Own LLM  │  │ - Own LLM  │
     │ - Own memory│ │ - Own memory│ │ - Own memory│
     │ - Own Kanban│ │ - Own Kanban│ │ - Own Kanban│
     │ - ACP session││ - ACP session││ - ACP session│
     └────────────┘  └────────────┘  └────────────┘
```

## What Needs to Be Built

### Phase 1: Conversational Strategos
- Add LLM layer to Strategos itself (uses Claude/Ollama for reasoning)
- Telegram: natural language → Strategos LLM → tool execution → response
- CLI: interactive chat mode with Strategos

### Phase 2: Sub-Agent Runtime
- `agent.spawn` actually launches `opencode acp` session per agent
- Each agent gets: ACP session + memory path + Kanban board + role prompt
- Sub-agents can call `recall.search`, `remember.write`, `kanban.update`

### Phase 3: Instruction Composer
- Strategos composes delegation payloads:
  ```
  ROLE: Developer Agent
  PROJECT: {objectives, constraints}
  CURRENT TASK: {card title, description, acceptance criteria}
  RELEVANT MEMORY: {top-k recalled items from LanceDB}
  GUARDRAILS: {time budget, output format, escalation path}
  ```

### Phase 4: Heartbeat Auditing
- Check each agent's Kanban progress
- Detect stalled cards, missing updates, quality issues
- Escalate to you if blocked > N hours
- Generate weekly rollup summaries

## Verdict

**Current implementation is ~30% complete.**

The foundation (MCP, memory, Kanban) is solid, but the interactive CEO agent layer and sub-agent runtime are missing. Strategos cannot be talked to, and "employees" don't exist as actual workers.

**Priority fixes:**
1. Add LLM conversational layer to Strategos (Telegram + CLI chat)
2. Implement ACP sub-agent spawning with role-based prompts
3. Build instruction composer with memory recall
4. Make heartbeat an actual auditor, not just a logger
