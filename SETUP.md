# Strategos Setup Guide

## Quick Start (Production)

### 1. Install Strategos

```bash
# Clone or copy the repository
cd /path/to/strategos

# Run installation script (requires sudo)
sudo ./install.sh
```

### 2. Configure Telegram Bot

1. Create a bot via [@BotFather](https://t.me/BotFather) on Telegram
2. Get your bot token
3. Get your chat ID (use [@userinfobot](https://t.me/userinfobot))
4. Edit the environment file:

```bash
sudo nano /opt/strategos/.env
```

Update these values:
```
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=123456789
```

### 3. Start the Service

```bash
sudo systemctl start strategos
sudo systemctl enable strategos  # Start on boot
```

### 4. Verify Installation

```bash
# Check service status
sudo systemctl status strategos

# View logs
sudo journalctl -u strategos -f

# Test in Telegram
# Send /start to your bot
```

---

## Development Setup

### Prerequisites

- Node.js 20+
- Ollama with `qwen3-embedding:0.6b` model
- SQLite3

### 1. Install Dependencies

```bash
# Install Node.js (if not installed)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Install embedding model
ollama pull qwen3-embedding:0.6b

# Install system dependencies
sudo apt-get install -y build-essential sqlite3 libsqlite3-dev
```

### 2. Setup Application

```bash
# Install npm dependencies
npm install

# Build application
npm run build

# Copy environment file
cp .env.example .env

# Edit environment file
nano .env
```

### 3. Run Development Server

```bash
# Development mode (with auto-reload)
npm run dev

# Or production mode
npm start
```

---

## Configuration Options

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `TELEGRAM_BOT_TOKEN` | (required) | Telegram bot token from BotFather |
| `TELEGRAM_CHAT_ID` | (required) | Your Telegram chat ID |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_EMBED_MODEL` | `qwen3-embedding:0.6b` | Embedding model to use |
| `LANCEDB_DIR` | `.lancedb` | Directory for LanceDB vectors |
| `KANBAN_DB` | `kanban.db` | SQLite database for Kanban |
| `MESSAGES_DB` | `messages.db` | SQLite database for messages |
| `LOG_LEVEL` | `info` | Logging level (debug, info, warn, error) |
| `LOG_FILE` | `strategos.log` | Log file path |

### Systemd Service Options

Edit `/etc/systemd/system/strategos.service`:

```ini
[Service]
# Increase memory limit if needed
MemoryMax=4G

# Increase CPU limit
CPUQuota=400%

# Change restart behavior
RestartSec=30
```

---

## Service Management

```bash
# Start service
sudo systemctl start strategos

# Stop service
sudo systemctl stop strategos

# Restart service
sudo systemctl restart strategos

# Enable on boot
sudo systemctl enable strategos

# Disable on boot
sudo systemctl disable strategos

# View status
sudo systemctl status strategos

# View logs
sudo journalctl -u strategos -f

# View recent logs
sudo journalctl -u strategos -n 100
```

---

## Troubleshooting

### Service Won't Start

```bash
# Check logs
sudo journalctl -u strategos -n 50

# Check environment file
sudo cat /opt/strategos/.env

# Test manually
sudo -u strategos node /opt/strategos/build/index.js
```

### Ollama Connection Error

```bash
# Check Ollama status
systemctl status ollama

# Restart Ollama
sudo systemctl restart ollama

# Test connection
curl http://localhost:11434/api/tags
```

### Telegram Bot Not Responding

1. Verify bot token is correct
2. Verify chat ID is correct
3. Check bot was added to chat (if group)
4. Check logs for errors

### Memory Issues

```bash
# Check memory usage
sudo systemctl status strategos

# Increase memory limit
sudo systemctl edit strategos
# Add: MemoryMax=4G

sudo systemctl daemon-reload
sudo systemctl restart strategos
```

---

## Backup and Restore

### Backup Data

```bash
# Stop service
sudo systemctl stop strategos

# Create backup
sudo tar -czf strategos-backup-$(date +%Y%m%d).tar.gz \
    /var/lib/strategos \
    /opt/strategos/.env

# Restart service
sudo systemctl start strategos
```

### Restore Data

```bash
# Stop service
sudo systemctl stop strategos

# Extract backup
sudo tar -xzf strategos-backup-YYYYMMDD.tar.gz -C /

# Set permissions
sudo chown -R strategos:strategos /var/lib/strategos

# Restart service
sudo systemctl start strategos
```

---

## Uninstall

```bash
# Run uninstall script
sudo ./uninstall.sh

# Or manually:
sudo systemctl stop strategos
sudo systemctl disable strategos
sudo rm -rf /opt/strategos
sudo rm -rf /var/lib/strategos
sudo rm -rf /var/log/strategos
sudo rm /etc/systemd/system/strategos.service
sudo userdel strategos
```

---

## Support

- Documentation: `/opt/strategos/docs/`
- Logs: `/var/log/strategos/`
- Data: `/var/lib/strategos/`
