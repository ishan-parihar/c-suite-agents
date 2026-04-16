# Operant Setup and Operations

This file is the deployment and operations runbook. For project overview and architecture, see `README.md`.

## 1) Production Installation

```bash
cd /path/to/operant
sudo ./install.sh
sudo nano /opt/operant/.env
sudo systemctl enable --now operant
sudo ./verify-install.sh
```

Required environment values:

```bash
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
AGENT_LLM_PROVIDER=ollama
AGENT_LLM_BASE_URL=http://localhost:11434/v1
AGENT_LLM_MODEL=llama3.1:8b
OLLAMA_EMBED_MODEL=qwen3-embedding:0.6b
```

## 2) Development Setup

```bash
npm install
cp .env.example .env
nano .env
npm run build
npm run dev
```

Prerequisites:

- Node.js 20+
- Ollama installed and reachable
- Embedding model available locally

## 3) Service Operations

```bash
sudo systemctl status operant
sudo systemctl restart operant
sudo journalctl -u operant -f
```

Diagnostics:

```bash
operant doctor
operant daemon status
```

## 4) Troubleshooting

Service startup issues:

```bash
sudo journalctl -u operant -n 50
sudo cat /opt/operant/.env
sudo -u operant node /opt/operant/build/index.js
```

Ollama issues:

```bash
systemctl status ollama
sudo systemctl restart ollama
curl http://localhost:11434/api/tags
```

## 5) Backup and Restore

Backup:

```bash
sudo systemctl stop operant
sudo tar -czf operant-backup-$(date +%Y%m%d).tar.gz /var/lib/operant /opt/operant/.env
sudo systemctl start operant
```

Restore:

```bash
sudo systemctl stop operant
sudo tar -xzf operant-backup-YYYYMMDD.tar.gz -C /
sudo chown -R operant:operant /var/lib/operant
sudo systemctl start operant
```

## 6) Uninstall

```bash
sudo ./uninstall.sh
```
