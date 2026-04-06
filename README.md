# Strategos

**v0.4.0** — Multi-agent orchestration system with LifeOS integration

A self-managing team of AI C-suite agents that run your life and business through Kanban boards, board meetings, async messaging, vector memory, and operational resilience — all accessible via Telegram.

## Architecture

Strategos implements an **organic operations model** — 8 autonomous C-suite agents with distinct roles, databases, and Kanban boards, coordinated like a real executive team:

```
👤 Board Chair — You (Ishan Parihar)
  └─ 👔 CEO-Strategic (Level 4) — leads the C-suite
       ├─ ⚙️  COO-Productivity     → manages tasks, schedules, operations
       ├─ 🧠  CPO-Psychologist     → journal analysis, mental patterns
       ├─ 🤝  CRO-Relational       → relationship tracking, reconnects
       ├─ 💰  CFO-Financial        → money tracking, budgeting, forecasting
       ├─ 📝  CMO-Content          → content pipeline, campaigns
       ├─ 🔍  CIO-Intelligence     → signal detection, research, trends
       └─ 🩺  Physician (Advisory) → health tracking, diet, exercise (reports to COO)
```

Each agent has its own **Kanban board**, **LifeOS database access**, **vector memory**, and **autonomy level**. They communicate via threaded async messages, hold board meetings with quorum voting, and can hire/fire auxiliary staff.

## Features

### Agent Operations
- **Organic messaging** — async communication with P1-P4 priority, escalation (max 3 hops), threading, and memory injection
- **Kanban task management** — SQLite-persisted boards with per-agent columns, activity logs, priority, and manager reassignment
- **Board meetings** — propose → vote → record minutes with quorum enforcement
- **Agent hiring** — managers hire/fire auxiliary staff with budget controls and SQLite-backed contracts
- **Heartbeat system** — 30-min heartbeat cycle with inactivity tracking, silent ack detection, and auto-recovery

### LifeOS Integration
- **24 databases** across 5 domains: Strategic (goals, OKRs, projects, campaigns), Productivity (tasks, activities, time), Journaling (subjective, relational, systemic), Health (diet), Financial (transactions)
- Per-agent database access — each C-suite member only sees relevant data
- Vector memory via **LanceDB** with semantic search, deduplication, and decay
- Embedding models via **Ollama** with fallback support

### Native Agent Runtime
- Direct LLM execution via **OpenAI-compatible APIs** (Ollama, qwen-proxy, or any compatible endpoint)
- Tool calling with **42+ MCP tools** across memory, kanban, messaging, meetings, hiring, and more
- **Model fallback chains** with automatic failover on provider errors
- **Retry with exponential backoff** for transient failures
- Session context management with adaptive compaction and pruning
- SSE streaming support with prompt cache tracking
- JSONL session persistence with atomic writes and rotation

### Operational Resilience (v0.4.0)
- **Recovery recipes** — 7 encoded failure scenarios (heartbeat, message, memory, kanban, MCP, LLM, Telegram) with 1 auto-attempt + escalation
- **Policy engine** — rule-based operational decisions with AND/OR combiners (stale cards, message backlog, consecutive failures, session compaction)
- **Hook system** — PreToolUse, PostToolUse, PostToolUseFailure lifecycle hooks for instrumentation and policy enforcement
- **Tool search** — fuzzy keyword-based tool discovery across all 42+ tools
- **Instruction file discovery** — auto-discovery of CLAUDE.md, .cursorrules, .windsurfrules from project directory tree
- **Provider abstraction** — decoupled LLM client with SSE streaming and cache hit tracking

### Media Tools
- **Image analysis** — secure DNS-rebounded image fetching with IP validation
- **Image generation** — AI image creation via configured provider
- **Text-to-speech** — voice synthesis with streaming download and 10MB limit

### CLI
- `strategos onboard` — interactive setup wizard (quickstart or advanced)
- `strategos doctor` — comprehensive health diagnostics
- `strategos configure` — section-based interactive config editor (LLM, Telegram, MCP, embedding, paths, logging)
- `strategos mcp` — MCP server management (list, add, remove, enable/disable, status)
- `strategos daemon` — systemd service management (install, start, stop, restart, status, uninstall)
- `strategos status` — system status overview
- `strategos reset` — configuration reset with scope control
- `strategos migrate` — config migration for version upgrades

### Telegram Commands
| Command | Description |
|---|---|
| `/start` | Welcome message |
| `/org` | Organization chart |
| `/staff` | Core staff list |
| `/agents` | All agents with status |
| `/wake [agent]` | Agent wake context |
| `/messages [agent]` | Browse message threads |
| `/recall [query]` | Search vector memory |
| `/session [agent]` | Session management |
| `/status` | System health status |
| `/help` | Command reference |

## Installation

### Quick Install (Production)

```bash
git clone https://github.com/ishan-parihar/strategos.git
cd strategos
sudo ./install.sh
sudo nano /opt/strategos/.env    # Configure Telegram bot token
sudo systemctl start strategos
sudo systemctl enable strategos
sudo ./verify-install.sh
```

### Development

```bash
npm install
cp .env.example .env
nano .env                         # Configure LLM provider + Telegram
npm run build
npm start
```

### Requirements
- **Node.js** 20+
- **Ollama** (for embeddings — `nomic-embed-text` model)
- **LLM provider** (Ollama, qwen-proxy, or any OpenAI-compatible API)
- **Telegram bot token** (optional, for chat interface)

## Project Structure

```
src/
├── agents/              # Workspace manager, agent identity files
├── auth/                # Session management with identity binding
├── cli/                 # onboard, doctor, configure, mcp, daemon, status
├── config/              # Zod schema, config loader
├── integrations/        # Telegram bot (Telegraf)
├── kanban/              # SQLite-backed Kanban boards
├── lifeos/              # LifeOS MCP client (24 databases)
├── memory/              # Vector memory (LanceDB), embeddings (Ollama), dedup, lifecycle
├── mcp/                 # MCP server, client, bridge, tool registry
├── organic/             # Messaging, meetings, hiring, context management
├── runtime/             # Native LLM runtime, recovery, policy, hooks, provider, tools
├── scheduler/           # Agent executor, heartbeat, session registry, inactivity tracker
├── staff/               # C-suite role definitions, system prompts
└── __tests__/           # Test suite (bun test — 116 tests)
```

## Security

- **Identity binding** — session-to-agent identity prevents caller spoofing across 15+ MCP tools
- **Prompt injection protection** — XML delimiters + anti-injection instructions on every prompt
- **SQL injection prevention** — JS-side filtering on all LanceDB and MemoryStore queries
- **Command injection prevention** — `spawnSync` array args (no shell strings)
- **DNS rebinding protection** — IP validation before and after fetch
- **Resource limits** — 20 SSE sessions, 10MB image download, 4096-char TTS input, 30s fetch timeouts
- **Atomic writes** — tmp+rename pattern for all persistence layers
- **Systemd hardening** — dedicated user, no new privileges, private temp, resource limits (2GB RAM, 200% CPU)

## Testing

```bash
npm test                    # Run all tests (bun test)
npm run test:coverage       # Run with coverage
```

116 tests across 7 test files covering recovery, policy, hooks, tool search, provider, session persistence, and instruction file discovery.

## Configuration

All settings are managed interactively:

```bash
strategos configure         # Full interactive wizard
strategos configure --section llm        # LLM provider only
strategos configure --section telegram   # Telegram only
strategos configure --section mcp        # MCP servers only
strategos configure --section embedding  # Embedding model only
strategos doctor            # Run health diagnostics
```

Config file: `~/.strategos/config.json`

## Documentation

- [Architecture](docs/strategos-architecture.md) — System architecture
- [Organic Operations](docs/organic-operations-model.md) — Agent behavior model
- [Operational Model](docs/operational-model.md) — Core staff + board meetings
- [LifeOS Staff](docs/lifeos-core-staff.md) — Agent roles & database access
- [Runtime Audit](docs/native-agent-runtime-audit.md) — Security review
- [ADR-002](docs/adr/ADR-002-native-agent-runtime.md) — Runtime architecture decision

## Troubleshooting

```bash
# Service
sudo journalctl -u strategos -f      # Follow logs
sudo systemctl status strategos       # Check status
sudo systemctl restart strategos      # Restart

# Diagnostics
strategos doctor                      # Full health check
strategos daemon status               # Service status

# LLM / Embeddings
sudo systemctl restart ollama         # Restart Ollama
ollama list                           # Check available models

# Manual run
sudo -u strategos node /opt/strategos/build/index.js
```

## License

MIT
