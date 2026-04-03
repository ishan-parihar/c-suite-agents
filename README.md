
---

## 🚀 Installation

### Quick Install (Production)

```bash
# Clone repository
git clone https://github.com/your-org/strategos.git
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

- [Setup Guide](SETUP.md) - Complete setup and configuration
- [Architecture](docs/strategos-architecture.md) - System architecture
- [Organic Operations](docs/organic-operations-model.md) - Agent behaviors

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
```

## 📱 Telegram Commands

- `/start` - Welcome message
- `/org` - Organization chart
- `/staff` - Core staff list
- `/agents` - All agents
- `/wake [agent]` - Agent wake context
- `/messages [agent]` - Browse messages
- `/recall [query]` - Search memory
- `/status` - System status
- `/help` - Help

## 🗂 Directory Structure

```
/opt/strategos/           # Application directory
├── build/                # Compiled JavaScript
├── src/                  # TypeScript source
├── docs/                 # Documentation
├── .env                  # Environment config
└── package.json          # Dependencies

/var/lib/strategos/       # Data directory
├── lancedb/              # Vector embeddings
├── kanban/               # Kanban SQLite DB
└── messages/             # Messages SQLite DB

/var/log/strategos/       # Logs
├── strategos.log
└── strategos.error.log
```

## 🔐 Security

The systemd service includes security hardening:
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
```

## 📄 License

MIT License - see LICENSE file
