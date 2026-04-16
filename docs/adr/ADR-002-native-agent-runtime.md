# ADR-002: Native Agent Runtime Architecture

## Status
**Proposed**

## Context

Operant currently depends on OpenCode as an external HTTP service. Each C-suite agent (CEO, COO, CFO, CMO, CRO, CPO, CIO, Physician) is spawned as an OpenCode session via HTTP calls. This creates several problems:

1. **Context injection is rigid** — OpenCode's system prompt composition is internal and not easily customizable from Operant
2. **External dependency** — Running OpenCode as a separate process adds operational complexity
3. **No workspace isolation** — Agents share the Operant project CWD; they have no dedicated "office" to manage their own state, files, and core identity documents
4. **No HEARTBEAT_OK bypass** — All agent output routes through CEO validation, making agents less autonomous
5. **Hardcoded identities** — Agent identity files at `~/.config/opencode/agent/<agent>` are read once at spawn time, not dynamically from a per-agent workspace

We studied three reference implementations to determine the best architecture to adopt:

### OpenCode (github.com/anomalyco/opencode)

**Architecture**: Monorepo with `packages/opencode/` as the core runtime. Uses Effect framework for dependency injection. Sessions stored in SQLite. ACP protocol for external clients.

- **Agent Model**: Agents are config entries with `name`, `mode` (primary/subagent/all), `permission`, `prompt`, `model`. Built-in agents: build, plan, general, explore, compaction, title, summary.
- **Session Model**: Persistent sessions in SQLite with parent/child relationships, directory tracking, permission rulesets. Sessions are tied to a CWD (project directory).
- **ACP Protocol**: Stdio-based JSON-RPC between client and agent. Supports `newSession({ cwd, mcpServers })`, `prompt()`, event streaming for tool calls, text deltas, permissions.
- **Context Injection**: Reads `.opencode/` files, skills, plugins. System prompt composed internally.
- **Pros**: Clean architecture, Effect-based DI, persistent sessions, ACP standardization, permission system.
- **Cons**: Designed as a standalone CLI tool, not embeddable. Heavy dependencies (Effect, SQLite, AI SDK). ACP is client-server, not in-process.

### OpenClaw (github.com/openclaw/openclaw)

**Architecture**: Gateway + stdio agent processes. Workspace-driven context injection via `.md` core files.

- **Agent Model**: Agents identified by `agent:<agentId>:<sessionKey>` format. Config in `openclaw.json`. Workspace at `~/.openclaw/workspace/<agent>/`.
- **Workspace System**: Core files (`SOUL.md`, `IDENTITY.md`, `TOOLS.md`, `AGENTS.md`, `USER.md`, `HEARTBEAT.md`, `MEMORY.md`, `BOOTSTRAP.md`) read at startup and injected into system prompt.
- **Session Model**: In-memory session store with CWD tracking. Sessions spawned as child processes with specific working directories.
- **Subagent Spawning**: `sessions_spawn` creates child sessions with depth limits, thread binding, completion events.
- **System Prompt Composition**: `buildAgentSystemPrompt()` composes tooling, workspace, memory, skills, heartbeat, and context sections. Mode can be "full", "minimal" (subagents), or "none".
- **Heartbeat**: Uses `HEARTBEAT.md` — if empty, heartbeat is skipped. Agent checks domain and reports findings.
- **Pros**: Workspace-driven context, clean core file system, subagent lifecycle management, heartbeat integration, designed for multi-agent scenarios.
- **Cons**: Gateway architecture requires process management, stdio protocol overhead, less mature than OpenCode.

### Oh-My-OpenAgent (github.com/code-yeongyu/oh-my-openagent)

**Architecture**: Plugin layer on top of OpenCode. Not a standalone runtime.

- **Agent Model**: Extends OpenCode's agent system with discipline agents: Sisyphus (orchestrator), Hephaestus (deep worker), Prometheus (planner), Oracle (debugger), Librarian (search), Explore (fast grep).
- **Dynamic Prompt Building**: Builds agent prompts dynamically based on available agents, tools, skills, and categories. Model-specific overrides (Gemini, GPT-5.4).
- **Session Model**: Uses OpenCode's session system entirely.
- **Plugin System**: Hooks, tools, managers, skills, MCPs registered via OpenCode's plugin API.
- **Pros**: Excellent agent orchestration patterns, dynamic prompt composition, model-specific tuning, hash-anchored edits, background agents.
- **Cons**: **Not standalone** — entirely dependent on OpenCode as the runtime. Cannot be adopted without also adopting OpenCode. Heavy customization layer.

## Comparison Matrix

| Aspect | OpenCode | OpenClaw | Oh-My-OpenAgent |
|--------|----------|----------|-----------------|
| **Runtime** | Standalone CLI | Gateway + stdio agents | OpenCode plugin |
| **Embeddable** | No (heavy deps) | Partial (gateway) | No (plugin only) |
| **Workspace System** | `.opencode/` project-scoped | `~/.openclaw/workspace/<agent>/` | Inherits OpenCode |
| **Core Files** | Skills, plugins, AGENTS.md | SOUL, IDENTITY, TOOLS, AGENTS, USER, HEARTBEAT, MEMORY, BOOTSTRAP | Skills, AGENTS.md hierarchy |
| **Session Mgmt** | SQLite-backed, persistent | In-memory, CWD-tracked | Inherits OpenCode |
| **Subagent Spawn** | `task()` API within sessions | `sessions_spawn` gateway method | Background tasks via OpenCode |
| **Context Injection** | Internal prompt composition | `buildAgentSystemPrompt()` with workspace files | Dynamic prompt builder |
| **Protocol** | ACP (stdio JSON-RPC) + HTTP | ACP (stdio) + Gateway WebSocket | Inherits OpenCode |
| **Permission System** | Rich file-level permissions | Minimal | Inherits OpenCode |
| **Multi-Agent** | Single-project focused | Multi-agent with workspaces | Multi-agent via orchestration |
| **Extensibility** | Plugin system + skills | Core files + workspace templates | Skills + hooks + tools |

## Decision

**Adopt OpenClaw's workspace-driven architecture as the conceptual model, but build a NATIVE runtime for Operant — not wrapping any external tool.**

### Why OpenClaw's pattern over OpenCode:

1. **Workspace-per-agent** — OpenClaw's `~/.openclaw/workspace/<agent>/` with core files is exactly what we need. Each C-suite agent gets its own office with SOUL.md, IDENTITY.md, TOOLS.md, etc.
2. **System prompt composition** — `buildAgentSystemPrompt()` pattern lets us inject workspace files, memory, tools, and heartbeat instructions dynamically.
3. **Multi-agent design** — OpenClaw was built for multi-agent scenarios from the start. OpenCode was built for single-developer coding sessions.
4. **Heartbeat integration** — OpenClaw's heartbeat system (HEARTBEAT.md check) aligns with our Phase 1 work.

### Why NOT wrap any external tool:

1. **Oh-My-OpenAgent is not standalone** — it's a plugin. Adopting it means adopting OpenCode anyway.
2. **OpenCode is too heavy** — Effect framework, SQLite, AI SDK, 19+ packages. The dependency cost outweighs the benefit.
3. **We need custom agent routing** — Operant agents need direct-to-user messaging, domain-specific databases, Kanban boards — things neither OpenCode nor OpenClaw provide.
4. **Full control over context injection** — We need to inject LifeOS context, memory scores, agent relationships, and business logic into each agent's prompt.

### Proposed Architecture: Operant Native Agent Runtime

```
~/.operant/
├── agents/
│   ├── ceo/
│   │   ├── SOUL.md          # Core identity and purpose
│   │   ├── IDENTITY.md      # Name, role, personality
│   │   ├── TOOLS.md         # Available tools and how to use them
│   │   ├── AGENTS.md        # Other agents and how to collaborate
│   │   ├── USER.md          # User context and preferences
│   │   ├── HEARTBEAT.md     # Heartbeat check configuration (empty = skip)
│   │   ├── MEMORY.md        # Persistent memory notes
│   │   └── BOOTSTRAP.md     # Initialization instructions
│   ├── coo/
│   │   └── ... (same structure)
│   ├── cfo/
│   │   └── ...
│   └── ... (one folder per C-suite agent)
├── sessions/
│   └── <agent-id>/          # Session state per agent
└── config.json              # Global Operant configuration
```

**Key Design Decisions:**

1. **Native child process spawning** — Each agent runs as a spawned LLM process (using our existing AI SDK integration) with its workspace CWD, not through OpenCode HTTP.
2. **Core file injection** — System prompt built by reading all `.md` files from the agent's workspace directory and composing them with tool definitions, memory context, and business rules.
3. **Direct-to-user routing** — Agents with substantive findings (non-HEARTBEAT_OK, above length threshold) send messages directly to the user via Telegram, bypassing CEO validation.
4. **Session persistence** — Lightweight SQLite-backed session store for conversation history, context window management, and state recovery.
5. **Autonomous agent definitions** — Agents read their own core files at startup, giving them full awareness of their identity, tools, colleagues, and user context.

## Consequences

### Easier:
- Full control over system prompt composition
- Per-agent workspace isolation
- Direct user communication for substantive findings
- No external process dependencies
- Custom domain-specific context injection
- Agents can update their own MEMORY.md and HEARTBEAT.md

### Harder:
- We must implement the agent runtime ourselves (session management, context windowing, tool execution)
- Lose OpenCode's permission system (we'll need to build our own)
- Lose OpenCode's ACP client ecosystem (we don't need it)
- More maintenance burden for the runtime

### Risks:
- Building a reliable agent runtime is non-trivial (context management, error handling, retry logic)
- Need to ensure agents don't exceed context windows
- Need to handle LLM API failures gracefully

### Mitigations:
- Use our existing AI SDK integration (already proven)
- Start with heartbeat-only agents, expand to full conversational agents
- Implement circuit breakers and fallback behaviors
- Use the workspace-manager.ts already created as the foundation
