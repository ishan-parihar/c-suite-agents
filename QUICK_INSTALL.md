# Quick Installation Guide

## One-Command Install

```bash
cd /home/ishanp/Documents/GitHub/strategos
sudo ./install.sh
```

**Enter your password when prompted.**

## Manual Step-by-Step (if you prefer)

### 1. Install System Dependencies

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install -y curl git wget gnupg ca-certificates build-essential sqlite3 libsqlite3-dev

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Install embedding model
ollama pull qwen3-embedding:0.6b
```

### 2. Create Directories and User

```bash
sudo useradd --system --no-create-home --shell /bin/false --home-dir /opt/strategos --comment "Strategos Service User" strategos

sudo mkdir -p /opt/strategos
sudo mkdir -p /var/lib/strategos/{lancedb,kanban,messages}
sudo mkdir -p /var/log/strategos

sudo chown -R strategos:strategos /opt/strategos
sudo chown -R strategos:strategos /var/lib/strategos
sudo chown -R strategos:strategos /var/log/strategos
```

### 3. Install Application

```bash
cd /home/ishanp/Documents/GitHub/strategos
sudo cp -r * /opt/strategos/
cd /opt/strategos
sudo npm install --production
sudo npm run build
sudo chown -R strategos:strategos /opt/strategos
```

### 4. Configure Environment

```bash
sudo cp /opt/strategos/.env.example /opt/strategos/.env
sudo nano /opt/strategos/.env
# Edit TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
```

### 5. Create Systemd Service

```bash
sudo tee /etc/systemd/system/strategos.service > /dev/null << 'EOFSERVICE'
[Unit]
Description=Strategos Multi-Agent Orchestrator
Documentation=https://github.com/strategos/strategos
After=network.target ollama.service
Wants=ollama.service

[Service]
Type=simple
User=strategos
Group=strategos
WorkingDirectory=/opt/strategos
Environment=NODE_ENV=production
EnvironmentFile=/opt/strategos/.env
ExecStart=/usr/bin/node /opt/strategos/build/index.js
Restart=on-failure
RestartSec=10
StandardOutput=append:/var/log/strategos/strategos.log
StandardError=append:/var/log/strategos/strategos.error.log

NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/strategos /var/log/strategos

LimitNOFILE=65536
MemoryMax=2G
CPUQuota=200%

[Install]
WantedBy=multi-user.target
EOFSERVICE

sudo systemctl daemon-reload
sudo systemctl enable strategos
```

### 6. Start and Verify

```bash
sudo systemctl start strategos
sudo systemctl status strategos
sudo ./verify-install.sh
```

## Post-Installation

### Configure Telegram Bot

1. Talk to [@BotFather](https://t.me/BotFather) on Telegram
2. Send `/newbot` and follow instructions
3. Copy the bot token
4. Get your chat ID from [@userinfobot](https://t.me/userinfobot)
5. Edit the environment file:

```bash
sudo nano /opt/strategos/.env
```

Update:
```
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=123456789
```

### Restart Service

```bash
sudo systemctl restart strategos
```

### Test in Telegram

Send `/start` to your bot!

## Service Management

```bash
# Start/Stop/Restart
sudo systemctl start strategos
sudo systemctl stop strategos
sudo systemctl restart strategos

# Enable/Disable on boot
sudo systemctl enable strategos
sudo systemctl disable strategos

# View logs
sudo journalctl -u strategos -f
sudo tail -f /var/log/strategos/strategos.log

# Check status
sudo systemctl status strategos
```

## Troubleshooting

### Service won't start

```bash
# Check logs
sudo journalctl -u strategos -n 50

# Test manually
sudo -u strategos node /opt/strategos/build/index.js

# Check Ollama
sudo systemctl status ollama
curl http://localhost:11434/api/tags
```

### Permission issues

```bash
sudo chown -R strategos:strategos /opt/strategos
sudo chown -R strategos:strategos /var/lib/strategos
sudo chown -R strategos:strategos /var/log/strategos
```
