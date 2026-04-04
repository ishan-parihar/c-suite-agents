# Strategos CLI Gap Closure — Implementation Plan

## Phase 1: `strategos configure` Command

**Goal**: Section-based interactive config editing, modeled after OpenClaw's `configure` wizard.

### 1a. Config Snapshot Module (`src/cli/config-snapshot.ts`)
- `readConfigSnapshot(path)` → `{ exists, valid, config, error }`
- `summarizeConfig(config)` → human-readable summary of all current values
- Used by both `configure` and `onboard` (when re-running on existing config)

### 1b. Section Registry (`src/cli/configure.shared.ts`)
Define wizard sections:
```
Sections:
  1. llm       — LLM provider, model, API key, temperature, timeout
  2. context   — maxMessages, maxContextTokens, compaction, pruning
  3. agents    — defaultAutonomy, maxConcurrent, maxToolRounds
  4. telegram  — botToken, chatId
  5. paths     — all 5 data paths
  6. mcp       — MCP server management
  7. logging   — level, file, maxFileBytes
  8. embedding — embedding provider, model, dimensions
  9. health    — run doctor check
```

### 1c. Section Handlers (`src/cli/configure.sections.ts`)
Each section handler: `(config, options) => Promise<Record<string, unknown>>`
- Reads current value from config, shows it as default
- Prompts for new value
- Returns updated config section
- `persistConfig()` after each section

### 1d. Interactive Loop (`src/cli/configure.wizard.ts`)
- `readConfigSnapshot()` → summarize if exists, block if invalid
- `while true`: pick section → run handler → persist → repeat
- `"Continue"` exits the loop
- `--section` flag for non-interactive single-section

### 1e. CLI Registration
Add to `src/cli/program.ts`:
```
case "configure":
  await runConfigureWizard(opts);
```

---

## Phase 2: Embedding Model Configuration

### 2a. Schema Addition (`src/config/schema.ts`)
Add `embedding` section:
```ts
embedding: z.object({
  provider: z.enum(["ollama", "openai", "qwen-proxy"]).default("ollama"),
  model: z.string().default("nomic-embed-text"),
  fallbackModel: z.string().optional(),
  baseUrl: z.string().url().optional(),
  apiKey: z.string().optional(),
  dimensions: z.number().int().positive().default(1024),
}).strict().optional(),
```

### 2b. EmbeddingService Update (`src/memory/embeddings.ts`)
- Replace hardcoded `dimensions: 1024` with config-driven value
- Replace hardcoded model with config-driven value
- Add provider selection logic (ollama vs openai vs qwen-proxy)
- Add fallback model support

### 2c. Onboarding Integration (`src/cli/setup-wizard.ts`)
Add embedding configuration step after LLM setup:
- "Configure embedding model?" (yes/no)
- If yes: provider selection → model → dimensions

---

## Phase 3: MCP Server Management

### 3a. CLI Subcommands (`src/cli/mcp.ts`)
- `strategos mcp list` — show all MCP servers with status
- `strategos mcp add` — interactive wizard (name → type → command/url → env/headers)
- `strategos mcp remove <name>` — remove server
- `strategos mcp enable <name>` / `strategos mcp disable <name>` — toggle
- `strategos mcp status` — connection status for all servers

### 3b. MCP Runtime Integration
- Wire MCP config into existing MCP server loader
- Add connection status tracking
- Add health check for MCP servers in doctor

### 3c. Doctor Enhancement
- Check 16: MCP server connectivity (if any configured)

---

## Phase 4: Context Management CLI

### 4a. `strategos context show` — Display current context config
### 4b. `strategos context set <key> <value>` — Set context parameters
### 4c. `strategos context reset` — Reset to defaults

---

## Priority Order

1. **Phase 1** (configure command) — Unlocks all other config changes via section-based editing
2. **Phase 2** (embedding config) — Addresses the specific gap you called out (no ollama embedding model config)
3. **Phase 3** (MCP management) — Addresses the specific gap you called out (no MCP configuration)
4. **Phase 4** (context CLI) — Nice-to-have, context management via dedicated commands

## Files to Create/Modify

| File | Action | Phase |
|------|--------|-------|
| `src/cli/config-snapshot.ts` | Create | 1a |
| `src/cli/configure.shared.ts` | Create | 1b |
| `src/cli/configure.sections.ts` | Create | 1c |
| `src/cli/configure.wizard.ts` | Create | 1d |
| `src/cli/program.ts` | Modify (add configure case) | 1e |
| `src/config/schema.ts` | Modify (add embedding section) | 2a |
| `src/memory/embeddings.ts` | Modify (use config values) | 2b |
| `src/cli/setup-wizard.ts` | Modify (add embedding step) | 2c |
| `src/cli/mcp.ts` | Create | 3a |
| `src/cli/program.ts` | Modify (add mcp subcommand) | 3a |
| `src/cli/doctor.ts` | Modify (add MCP check) | 3c |
