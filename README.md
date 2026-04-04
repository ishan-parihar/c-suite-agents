# Strategos

Multi-agent orchestration system with organic operations — a self-managing team of AI agents that collaborate via kanban boards, meetings, hiring, and async messaging.

## Overview

Strategos runs as a persistent daemon managed by systemd, accessible via Telegram. It features:

- **Organic messaging** — agents communicate asynchronously with escalation, threading, and memory injection
- **Kanban task management** — SQLite-persisted boards with columns, activity logs, and manager reassignment
- **Board meetings** — propose, vote, and record minutes with quorum enforcement
- **Agent hiring** — managers hire/fire auxiliary staff with budget controls and SQLite-backed contracts
- **MCP bridge** — connect to external MCP servers for extended tool capabilities
- **Vector memory** — LanceDB-powered semantic search with deduplication and decay
- **Native agent runtime** — Ollama-backed LLM execution with structured output and retry fallback
- **Image & TTS tools** — DNS-rebounded image analysis, streaming downloads, and voice synthesis

## 🚀 Installation

### Quick Install (Production)

```bash
# Clone repository
git clone https://github.com/ishan-parihar/strategos.git
cd strategos

# Run installation (requires sudo)
sudo ./install.sh

# Configure Telegram
sudo nano /opt/strategos/.env

# Start service
sudo systemctl start strategos
sudo systemctl enable strategos

# Verify
sudo ./verify-install.sh
```

### Development Install

```bash
# Install dependencies
npm install

# Copy environment file
cp .env.example .env
nano .env  # Configure Telegram

# Build and run
npm run build
npm start
```

## 📋 Documentation

- [Setup Guide](SETUP.md) — Complete setup and configuration
- [Architecture](docs/strategos-architecture.md) — System architecture
- [Organic Operations](docs/organic-operations-model.md) — Agent behaviors
- [Native Agent Runtime Audit](docs/native-agent-runtime-audit.md) — Runtime security review
- [ADR-002](docs/adr/ADR-002-native-agent-runtime.md) — Runtime architecture decision

## 🔧 Service Management

```bash
# Start/Stop/Restart
sudo systemctl start strategos
sudo systemctl stop strategos
sudo systemctl restart strategos

# View logs
sudo journalctl -u strategos -f

# Check status
sudo systemctl status strategos

# CLI commands
strategos daemon status          # Quick daemon health
strategos daemon install         # Install systemd service
strategos mcp list               # List MCP servers
strategos configure              # Interactive configuration wizard
```

## 📱 Telegram Commands

- `/start` — Welcome message
- `/org` — Organization chart
- `/staff` — Core staff list
- `/agents` — All agents
- `/wake [agent]` — Agent wake context
- `/messages [agent]` — Browse messages
- `/recall [query]` — Search memory
- `/status` — System status
- `/help` — Help

## 🗂 Directory Structure

```
/opt/strategos/              # Application directory
├── build/                   # Compiled JavaScript
├── src/                     # TypeScript source
│   ├── agents/              # Agent definitions
│   ├── auth/                # Session management
│   ├── cli/                 # CLI commands (daemon, configure, mcp)
│   ├── config/              # Configuration loader & schema
│   ├── integrations/        # Telegram bot
│   ├── kanban/              # SQLite-backed kanban boards
│   ├── mcp/                 # MCP server, client, bridge
│   ├── memory/              # Vector memory (LanceDB)
│   ├── organic/             # Hiring, meetings, messaging
│   ├── runtime/             # Native agent runtime & tools
│   └── scheduler/           # Agent executor, heartbeat
├── docs/                    # Documentation
├── .env                     # Environment config
└── package.json             # Dependencies

/var/lib/strategos/          # Data directory
├── lancedb/                 # Vector embeddings
├── kanban/                  # Kanban SQLite DB
├── messages/                # Messages SQLite DB
├── hiring/                  # Contracts & delegations DB
└── meetings/                # Meeting minutes DB

/var/log/strategos/          # Logs
├── strategos.log
└── strategos.error.log
```

## 🔐 Security

### Hardening (v0.2.0)

Comprehensive security audit (Round 3) identified and patched 62 findings:

**Identity & Authorization**
- Session-to-agent identity binding prevents caller-supplied identity spoofing
- `withCallerIdentity()` overrides `from`/`from_agent`/`agent_id` across 15 MCP tools
- Authorization checks on kanban move, escalate, and manager view operations
- Escalation limits (max 3), self-escalation guard, target verification

**Injection Prevention**
- SQL injection eliminated via JS-side filtering (LanceDB, MemoryStore)
- Command injection fixed: `spawnSync` array args replace `execSync` shell strings
- Prompt injection mitigated: XML delimiters + anti-injection instructions
- DNS rebinding protection: IP validated before and after fetch

**Resource Safety**
- Max 20 SSE sessions, JSON.parse/stringify try/catch, 30s fetch timeouts
- Streaming image download with 10MB hard limit
- TTS input capped at 4096 characters
- Reconnect backoff with timer cleanup, MCP tool retry (2 retries)

**Persistence**
- All state SQLite-backed: kanban, messages, contracts, delegations, meetings
- Atomic writes via tmp+rename pattern
- Graceful shutdown on SIGTERM/SIGINT

### Systemd Hardening

- Runs as dedicated user (`strategos`)
- No new privileges
- Private temporary directory
- Strict system protection
- Resource limits (2GB RAM, 200% CPU)

## 🆘 Troubleshooting

```bash
# Check installation
sudo ./verify-install.sh

# View logs
sudo journalctl -u strategos -n 100

# Test manually
sudo -u strategos node /opt/strategos/build/index.js

# Restart Ollama (if embedding errors)
sudo systemctl restart ollama

# Run diagnostics
strategos doctor              # Health check
strategos daemon status       # Service status
```

## 📄 License

MIT License — see LICENSE file
