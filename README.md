# C-Suite Agents

> Multi-agent C-suite orchestration — Kanban workflows, threaded messaging, LanceDB memory, and Telegram interface.

[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Tests](https://img.shields.io/badge/tests-227%20passing-brightgreen)](#testing)
[![Status](https://img.shields.io/badge/Status-Active-brightgreen.svg)](#)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

Operant is built as an operations engine rather than a single chatbot. It coordinates specialized agents (CEO, COO, CFO, etc.) that:

- run periodic operational checks,
- communicate with escalation and priorities,
- track and execute work in agent-specific Kanban boards,
- persist context and memory for long-running autonomy.

## Core Capabilities

- **Multi-agent operations model** with role-specific autonomy and tools.
- **Native runtime resilience** with retries, policy engine, hooks, and failure recovery.
- **Memory stack** using LanceDB semantic memory + Ollama embeddings.
- **Command and chat interfaces** through CLI and Telegram.
- **MCP integration layer** for tool orchestration across domains.

## Quick Start (Development)

```bash
npm install
cp .env.example .env
nano .env
npm run build
npm start
```

## Production Install (systemd)

```bash
sudo ./install.sh
sudo nano /opt/operant/.env
sudo systemctl enable --now operant
sudo ./verify-install.sh
```

For full deployment and service operations, see `SETUP.md`.

## CLI

- `operant onboard` - interactive setup wizard
- `operant configure` - update config sections (LLM, Telegram, MCP, embedding)
- `operant doctor` - health diagnostics
- `operant mcp` - MCP server management
- `operant daemon` - systemd service management
- `operant status` - system status overview
- `operant migrate` - config migration support

## Telegram Commands

| Command | Description |
|---|---|
| `/start` | Welcome message |
| `/org` | Organization chart |
| `/staff` | Core staff list |
| `/agents` | Agent status |
| `/wake [agent]` | Agent wake context |
| `/messages [agent]` | Message threads |
| `/recall [query]` | Memory recall |
| `/session [agent]` | Session tools |
| `/status` | Health status |
| `/help` | Command reference |

## Architecture Snapshot

```text
src/
├── cli/           command interface + setup flows
├── integrations/  Telegram integration (Telegraf)
├── runtime/       native agent runtime, policy, hooks, recovery
├── scheduler/     heartbeat and execution orchestration
├── organic/       messaging, meetings, hiring flows
├── memory/        LanceDB + embeddings + lifecycle
├── kanban/        SQLite-backed boards and activity
├── mcp/           MCP bridge/server/tool registry
└── __tests__/     test suite
```

## Testing

```bash
npm test
npm run test:coverage
```

Current status: `227` tests passing across `11` files.

## Security and Operational Controls

- Identity binding for session-to-agent calls.
- Prompt injection hardening in runtime prompt assembly.
- SQL and command-injection controls on query/tool surfaces.
- Resource limits and timeouts for runtime safety.
- Atomic writes for persistence reliability.

## Documentation

- `docs/operant-architecture.md`
- `docs/organic-operations-model.md`
- `docs/operational-model.md`
- `docs/lifeos-core-staff.md`
- `docs/native-agent-runtime-audit.md`
- `docs/adr/ADR-002-native-agent-runtime.md`

## Scope and Limitations

- Assumes local infrastructure for Ollama and SQLite-backed stores.
- Requires operational tuning for long-running autonomous sessions.
- Domain behavior depends on configured MCP tools and environment quality.

## License

MIT

---

Developed by [Ishan Parihar](https://github.com/ishan-parihar)
