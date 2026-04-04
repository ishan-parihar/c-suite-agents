#!/bin/bash
#
# Strategos Multi-Agent Orchestrator - Complete Installation Script
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

STRATEGOS_USER="${STRATEGOS_USER:-strategos}"
STRATEGOS_GROUP="${STRATEGOS_GROUP:-strategos}"
STRATEGOS_DIR="${STRATEGOS_DIR:-/opt/strategos}"
STRATEGOS_DATA_DIR="${STRATEGOS_DATA_DIR:-/var/lib/strategos}"
STRATEGOS_LOG_DIR="${STRATEGOS_LOG_DIR:-/var/log/strategos}"
NODE_VERSION="${NODE_VERSION:-20}"
# LLM Configuration (qwen-proxy defaults)
LLM_BASE_URL="${LLM_BASE_URL:-http://127.0.0.1:3000/v1}"
LLM_MODEL="${LLM_MODEL:-coder-model}"
LLM_CONTEXT_TOKENS="${LLM_CONTEXT_TOKENS:-262144}"
LLM_MAX_TOKENS="${LLM_MAX_TOKENS:-65536}"
# Legacy Ollama vars (kept for backward compatibility)
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-qwen3-embedding:0.6b}"

log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

check_first_run() {
    local config_file="/home/$(logname)/.strategos/config.json"
    if [ -f "$config_file" ] && ! grep -q '"wizard"' "$config_file" 2>/dev/null; then
        return 0  # first run
    fi
    return 1  # not first run
}

post_start_health_check() {
    log_info "Running post-start health check..."
    sleep 5
    if systemctl is-active --quiet strategos; then
        log_success "Strategos service is running"
        if grep -q "Strategos started" "$STRATEGOS_LOG_DIR/strategos.log" 2>/dev/null; then
            log_success "Service booted successfully"
        else
            log_warn "Service started but boot message not found in logs yet"
        fi
    else
        log_error "Service failed to start. Check logs:"
        log_error "  journalctl -u strategos -n 50 --no-pager"
        return 1
    fi
}

ensure_systemd_linger() {
    if command -v loginctl &>/dev/null; then
        if ! loginctl show-user "$(logname)" -p Linger 2>/dev/null | grep -q "yes"; then
            log_info "Enabling systemd linger for $(logname)..."
            loginctl enable-linger "$(logname)" 2>/dev/null || {
                log_warn "Could not enable linger (may require sudo)"
                log_warn "Run: sudo loginctl enable-linger $(logname)"
            }
        fi
    fi
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        log_error "This script must be run as root (use sudo)"
        exit 1
    fi
}

detect_os() {
    if [ -f /etc/os-release ]; then
        . /etc/os-release
        OS=$NAME
        VER=$VERSION_ID
    else
        log_error "Cannot detect OS"
        exit 1
    fi
    log_info "Detected OS: $OS $VER"
}

install_system_deps() {
    log_info "Installing system dependencies..."
    
    case "$OS" in
        "Ubuntu"|"Debian"|"Linux Mint"|"Pop!_OS")
            apt-get update -qq
            apt-get install -y -qq curl git wget gnupg ca-certificates build-essential sqlite3 libsqlite3-dev systemd
            ;;
        "Fedora"|"CentOS"|"RHEL"|"AlmaLinux"|"Rocky")
            dnf install -y -q curl git wget gnupg2 ca-certificates gcc gcc-c++ make sqlite sqlite-devel systemd
            ;;
        "Arch Linux"|"Manjaro"|"CachyOS")
            pacman -Sy --noconfirm curl git wget gnupg base-devel sqlite systemd
            ;;
        *)
            log_warn "Unknown OS, attempting generic install..."
            ;;
    esac
    
    log_success "System dependencies installed"
}

install_nodejs() {
    log_info "Installing Node.js..."
    
    if command -v node &> /dev/null; then
        NODE_VER=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        log_info "Node.js $NODE_VER already installed"
        return 0
    fi
    
    case "$OS" in
        "Ubuntu"|"Debian"|"Linux Mint"|"Pop!_OS")
            curl -fsSL https://deb.nodesource.com/setup_$NODE_VERSION.x | bash -
            apt-get install -y -qq nodejs
            ;;
        "Fedora"|"CentOS"|"RHEL"|"AlmaLinux"|"Rocky")
            curl -fsSL https://rpm.nodesource.com/setup_$NODE_VERSION.x | bash -
            dnf install -y -q nodejs
            ;;
        "Arch Linux"|"Manjaro"|"CachyOS")
            pacman -Sy --noconfirm nodejs npm
            ;;
        *)
            log_warn "Please install Node.js manually"
            ;;
    esac
    
    log_success "Node.js $(node -v) installed"
}

install_ollama() {
    log_info "Installing Ollama..."
    
    if command -v ollama &> /dev/null; then
        log_info "Ollama already installed"
        if ! systemctl is-active --quiet ollama 2>/dev/null; then
            log_info "Starting Ollama service..."
            systemctl start ollama || true
        fi
        return 0
    fi
    
    curl -fsSL https://ollama.com/install.sh | sh
    log_success "Ollama installed"
}

install_embedding_model() {
    log_info "Installing embedding model: $OLLAMA_EMBED_MODEL..."
    
    log_info "Waiting for Ollama to be ready..."
    for i in {1..30}; do
        if curl -s "$OLLAMA_HOST/api/tags" &> /dev/null; then
            log_success "Ollama is ready"
            break
        fi
        sleep 2
    done
    
    if ! ollama list | grep -q "$OLLAMA_EMBED_MODEL"; then
        log_info "Pulling $OLLAMA_EMBED_MODEL..."
        ollama pull $OLLAMA_EMBED_MODEL
        log_success "Embedding model installed"
    else
        log_info "Embedding model already present"
    fi
}

create_user() {
    log_info "Creating system user: $STRATEGOS_USER..."
    
    if id "$STRATEGOS_USER" &>/dev/null; then
        log_info "User already exists"
        return 0
    fi
    
    useradd --system --no-create-home --shell /bin/false \
        --home-dir "$STRATEGOS_DIR" \
        --comment "Strategos Service User" \
        "$STRATEGOS_USER"
    
    log_success "User created"
}

create_directories() {
    log_info "Creating directories..."
    
    mkdir -p "$STRATEGOS_DIR"
    mkdir -p "$STRATEGOS_DATA_DIR"
    mkdir -p "$STRATEGOS_LOG_DIR"
    mkdir -p "$STRATEGOS_DATA_DIR/lancedb"
    mkdir -p "$STRATEGOS_DATA_DIR/kanban"
    mkdir -p "$STRATEGOS_DATA_DIR/messages"
    mkdir -p "$STRATEGOS_DATA_DIR/agents"
    for office in strategos coo-productivity cpo-psychologist cro-relational cfo-financial cmo-content cio-intelligence physician-health; do
        mkdir -p "$STRATEGOS_DATA_DIR/agents/$office"
    done

    chown -R "$STRATEGOS_USER:$STRATEGOS_GROUP" "$STRATEGOS_DIR"
    chown -R "$STRATEGOS_USER:$STRATEGOS_GROUP" "$STRATEGOS_DATA_DIR"
    chown -R "$STRATEGOS_USER:$STRATEGOS_GROUP" "$STRATEGOS_LOG_DIR"
    chown -R "$STRATEGOS_USER:$STRATEGOS_GROUP" "$STRATEGOS_DATA_DIR/agents"
    chmod 750 "$STRATEGOS_DIR"
    chmod 750 "$STRATEGOS_DATA_DIR"
    chmod 750 "$STRATEGOS_LOG_DIR"
    
    log_success "Directories created"
}

install_application() {
    log_info "Installing Strategos application..."
    
    # Copy application files (preserve permissions)
    cp -r /home/ishanp/Documents/GitHub/strategos/* "$STRATEGOS_DIR/"
    
    # Install ALL dependencies (including devDependencies for build)
    cd "$STRATEGOS_DIR"
    log_info "Installing npm dependencies..."
    npm install
    
    # Build application using npx (no global tsc needed)
    log_info "Building application..."
    npx tsc
    chmod 755 "$STRATEGOS_DIR/build/index.js"
    
    # Install production dependencies only (cleaner)
    log_info "Installing production dependencies..."
    npm install --omit=dev
    
    # Set permissions
    chown -R "$STRATEGOS_USER:$STRATEGOS_GROUP" "$STRATEGOS_DIR"
    
    log_success "Application installed"
}

create_env_file() {
    log_info "Creating environment configuration..."
    
    cat > "$STRATEGOS_DIR/.env" << EOFENV
# Strategos Environment Configuration
# Generated: $(date -Iseconds)

# Telegram Bot Configuration
TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

# LLM Configuration (qwen-proxy defaults)
LLM_BASE_URL=$LLM_BASE_URL
LLM_MODEL=$LLM_MODEL
LLM_CONTEXT_TOKENS=$LLM_CONTEXT_TOKENS
LLM_MAX_TOKENS=$LLM_MAX_TOKENS
# Legacy Ollama Configuration (optional, for users who prefer Ollama)
OLLAMA_HOST=$OLLAMA_HOST
OLLAMA_EMBED_MODEL=$OLLAMA_EMBED_MODEL

# Data Directories
LANCEDB_DIR=$STRATEGOS_DATA_DIR/lancedb
KANBAN_DB=$STRATEGOS_DATA_DIR/kanban/kanban.db
MESSAGES_DB=$STRATEGOS_DATA_DIR/messages/messages.db

# Logging
LOG_LEVEL=info
LOG_FILE=$STRATEGOS_LOG_DIR/strategos.log

# Service Configuration
STRATEGOS_USER=$STRATEGOS_USER
STRATEGOS_GROUP=$STRATEGOS_GROUP
EOFENV

    chmod 600 "$STRATEGOS_DIR/.env"
    chown "$STRATEGOS_USER:$STRATEGOS_GROUP" "$STRATEGOS_DIR/.env"
    
    log_success "Environment file created at $STRATEGOS_DIR/.env"
    log_warn "IMPORTANT: Edit .env file and set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID"
}

create_config_json() {
    log_info "Creating JSON configuration..."
    
    local config_dir="/home/$(logname)/.strategos"
    mkdir -p "$config_dir"
    
    cat > "$config_dir/config.json" << EOFCONFIG
{
  "llm": {
    "provider": "qwen-proxy",
    "baseUrl": "$LLM_BASE_URL",
    "model": "$LLM_MODEL",
    "maxTokens": $LLM_MAX_TOKENS,
    "temperature": 0.3,
    "timeoutMs": 180000,
    "contextTokens": $LLM_CONTEXT_TOKENS
  },
  "context": {
    "maxMessages": 50,
    "maxContextTokens": $LLM_CONTEXT_TOKENS,
    "compaction": {
      "auto": true,
      "prune": true,
      "reserved": 20000,
      "keepRecent": 6,
      "maxHistoryShare": 0.5,
      "timeoutSeconds": 900
    },
    "pruning": {
      "protectTokens": 40000,
      "minimumFree": 20000,
      "protectedTools": ["memory.consolidate"]
    }
  },
  "agents": {
    "defaultAutonomy": 3,
    "maxConcurrent": 5,
    "maxToolRounds": 10,
    "heartbeatInterval": "5m",
    "directToUser": true
  },
  "paths": {
    "lancedb": "$STRATEGOS_DATA_DIR/lancedb",
    "kanbanDb": "$STRATEGOS_DATA_DIR/kanban/kanban.db",
    "messagesDb": "$STRATEGOS_DATA_DIR/messages/messages.db",
    "agentOffices": "$STRATEGOS_DIR/agents",
    "logFile": "$STRATEGOS_LOG_DIR/strategos.log"
  },
  "telegram": {
    "botToken": "your-bot-token-from-botfather",
    "chatId": "your-chat-id-from-userinfobot"
  },
  "logging": {
    "level": "info",
    "file": "$STRATEGOS_LOG_DIR/strategos.log",
    "maxFileBytes": 10485760
  }
}
EOFCONFIG

    chmod 600 "$config_dir/config.json"
    
    log_success "JSON config created at $config_dir/config.json"
    log_warn "IMPORTANT: Edit config.json and set telegram.botToken + telegram.chatId"
}

create_systemd_service() {
    log_info "Installing systemd service via daemon command..."
    
    # Ensure daemon CLI is available
    local daemon_cmd=""
    if command -v strategos &>/dev/null; then
        daemon_cmd="strategos daemon install --force"
    elif [ -f "$STRATEGOS_DIR/build/cli/program.js" ]; then
        daemon_cmd="node $STRATEGOS_DIR/build/cli/program.js daemon install --force"
    else
        log_warn "Daemon CLI not available, falling back to static service unit"
        create_systemd_service_fallback
        return
    fi
    
    # Run as the target user (not root) for user-level systemd service
    local target_user="${STRATEGOS_USER:-$(logname)}"
    if [[ "$target_user" == "root" ]]; then
        target_user="$(logname)"
    fi
    
    log_info "Installing user service for: $target_user"
    su - "$target_user" -c "$daemon_cmd" 2>/dev/null || {
        log_warn "User service install failed, falling back to static unit"
        create_systemd_service_fallback
    }
    
    log_success "Systemd service installed (user-level)"
}

create_systemd_service_fallback() {
    log_info "Creating static systemd service (fallback)..."
    
    cat > /etc/systemd/system/strategos.service << EOFSERVICE
[Unit]
Description=Strategos Multi-Agent Orchestrator
Documentation=https://github.com/strategos/strategos
After=network.target

[Service]
Type=simple
User=$STRATEGOS_USER
Group=$STRATEGOS_GROUP
WorkingDirectory=$STRATEGOS_DIR
Environment=NODE_ENV=production
EnvironmentFile=$STRATEGOS_DIR/.env
ExecStart=/usr/bin/node $STRATEGOS_DIR/build/index.js
Restart=on-failure
RestartSec=10
StandardOutput=append:$STRATEGOS_LOG_DIR/strategos.log
StandardError=append:$STRATEGOS_LOG_DIR/strategos.error.log

# Security hardening
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$STRATEGOS_DATA_DIR $STRATEGOS_LOG_DIR

# Resource limits
LimitNOFILE=65536
MemoryMax=2G
CPUQuota=200%

[Install]
WantedBy=multi-user.target
EOFSERVICE

    chmod 644 /etc/systemd/system/strategos.service
    systemctl daemon-reload
    systemctl enable strategos.service
    
    log_success "Systemd service created and enabled (system-level fallback)"
}

create_logrotate() {
    log_info "Creating logrotate configuration..."
    
    cat > /etc/logrotate.d/strategos << EOFLOGROTATE
$STRATEGOS_LOG_DIR/*.log {
    daily
    missingok
    rotate 14
    compress
    delaycompress
    notifempty
    create 0640 $STRATEGOS_USER $STRATEGOS_GROUP
    postrotate
        systemctl reload strategos.service > /dev/null 2>&1 || true
    endscript
}
EOFLOGROTATE

    log_success "Logrotate configuration created"
}

create_cli_symlink() {
    log_info "Installing CLI command..."
    
    local bin_target="/usr/local/bin/strategos"
    local cli_source="$STRATEGOS_DIR/bin/strategos.mjs"
    
    if [ -f "$cli_source" ]; then
        ln -sf "$cli_source" "$bin_target"
        chmod +x "$bin_target"
        log_success "CLI command installed: strategos → $bin_target"
    else
        log_warn "CLI source not found at $cli_source"
        log_warn "Users can still run: node $STRATEGOS_DIR/build/index.js <command>"
    fi
}

verify_installation() {
    log_info "Verifying installation..."
    
    local errors=0
    
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found"
        errors=$((errors + 1))
    fi
    
    if ! command -v ollama &> /dev/null; then
        log_warn "Ollama not found (optional, only needed if using Ollama provider)"
    fi
    
    if ! ollama list 2>/dev/null | grep -q "$OLLAMA_EMBED_MODEL"; then
        log_warn "Embedding model not found (optional, only needed if using Ollama embeddings)"
    fi
    
    if [ ! -f "$STRATEGOS_DIR/build/index.js" ]; then
        log_error "Application not built"
        errors=$((errors + 1))
    fi
    
    if ! systemctl list-unit-files | grep -q strategos; then
        log_error "Systemd service not installed"
        errors=$((errors + 1))
    fi
    
    if [ $errors -eq 0 ]; then
        log_success "Installation verified successfully"
        return 0
    else
        log_error "Installation completed with $errors error(s)"
        return 1
    fi
}

print_next_steps() {
    echo ""
    echo "=============================================="
    echo "  Strategos Installation Complete!"
    echo "=============================================="
    echo ""
    echo "Next steps:"
    echo ""
    echo "1. Configure Telegram bot:"
    echo "   sudo nano $STRATEGOS_DIR/.env"
    echo "   - Set TELEGRAM_BOT_TOKEN"
    echo "   - Set TELEGRAM_CHAT_ID"
    echo ""
    echo "2. Review LLM configuration (qwen-proxy defaults):"
    echo "   cat ~/.strategos/config.json"
    echo "   - LLM provider: qwen-proxy"
    echo "   - Model: $LLM_MODEL"
    echo "   - Base URL: $LLM_BASE_URL"
    echo ""
    echo "3. Start the service:"
    echo "   sudo systemctl start strategos"
    echo ""
    echo "4. Check status:"
    echo "   systemctl status strategos"
    echo ""
    echo "5. View logs:"
    echo "   sudo journalctl -u strategos -f"
    echo ""
    echo "6. Test in Telegram:"
    echo "   - Send /start to your bot"
    echo "   - Try /help for available commands"
    echo ""
    echo "CLI commands (available to all users):"
    echo "  strategos onboard              # Run setup wizard"
    echo "  strategos doctor               # Run diagnostic checks"
    echo "  strategos status               # Show system status"
    echo "  strategos status --deep        # Deep health check"
    echo "  strategos status --json        # JSON output (for scripts)"
    echo "  strategos reset --scope config # Reset configuration"
    echo "  strategos migrate              # Apply config migrations"
    echo "  strategos help                 # Show all commands"
    echo "  strategos version              # Show version"
    echo ""
    echo "Service management:"
    echo "  sudo systemctl start strategos    # Start service"
    echo "  sudo systemctl stop strategos     # Stop service"
    echo "  sudo systemctl restart strategos  # Restart service"
    echo "  sudo systemctl enable strategos   # Enable on boot"
    echo "  sudo systemctl disable strategos  # Disable on boot"
    echo ""
    echo "Logs:"
    echo "  $STRATEGOS_LOG_DIR/strategos.log"
    echo "  $STRATEGOS_LOG_DIR/strategos.error.log"
    echo ""
    echo "Data:"
    echo "  $STRATEGOS_DATA_DIR/"
    echo ""
    echo "Health checks:"
    echo "  sudo systemctl is-active strategos           # Check service status"
    echo "  sudo journalctl -u strategos -n 50           # Recent log entries"
    echo "  grep 'Strategos started' $STRATEGOS_LOG_DIR/strategos.log  # Boot confirmation"
    echo "  loginctl show-user $(logname) -p Linger      # Systemd linger status"
    echo ""
    echo "=============================================="
}

main() {
    echo "=============================================="
    echo "  Strategos Installation Script"
    echo "=============================================="
    echo ""
    
    check_root
    detect_os
    
    log_info "Starting installation..."
    echo ""
    
    install_system_deps
    install_nodejs
    # install_ollama        # Optional: uncomment if using Ollama as LLM provider
    # install_embedding_model  # Optional: uncomment if using Ollama embeddings
    create_user
    create_directories
    install_application
    create_env_file
    create_config_json
    create_systemd_service
    create_logrotate
    create_cli_symlink
    
    echo ""
    verify_installation
    
    print_next_steps
    
    echo ""
    ensure_systemd_linger

    if check_first_run; then
        log_info "First run detected — running setup wizard..."
        if command -v strategos &>/dev/null; then
            strategos onboard
        elif [ -f "$STRATEGOS_DIR/build/index.js" ]; then
            node "$STRATEGOS_DIR/build/index.js" onboard
        else
            cd "$STRATEGOS_DIR"
            bun run src/cli/setup-wizard.ts
        fi
        log_info "Running doctor check..."
        if command -v strategos &>/dev/null; then
            strategos doctor
        elif [ -f "$STRATEGOS_DIR/build/index.js" ]; then
            node "$STRATEGOS_DIR/build/index.js" doctor
        else
            cd "$STRATEGOS_DIR"
            bun run src/cli/doctor.ts
        fi
        log_info "Starting Strategos service..."
        sudo systemctl start strategos
        post_start_health_check
    else
        echo ""
        read -p "Would you like to run the setup wizard to customize your configuration? (y/N) " -r
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            log_info "Running setup wizard..."
            if command -v strategos &>/dev/null; then
                strategos onboard
            elif [ -f "$STRATEGOS_DIR/build/index.js" ]; then
                node "$STRATEGOS_DIR/build/index.js" onboard
            else
                cd "$STRATEGOS_DIR"
                bun run src/cli/setup-wizard.ts
            fi
            log_info "Running doctor check..."
            if command -v strategos &>/dev/null; then
                strategos doctor
            elif [ -f "$STRATEGOS_DIR/build/index.js" ]; then
                node "$STRATEGOS_DIR/build/index.js" doctor
            else
                cd "$STRATEGOS_DIR"
                bun run src/cli/doctor.ts
            fi
        else
            log_info "You can run the setup wizard later with: strategos onboard"
            log_info "Run doctor check with: strategos doctor"
        fi
    fi
}

main "$@"
