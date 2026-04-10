#!/bin/bash
#
# Operant - Development Installation Script
# Operates in-repo, auto-restarts on crash, tunnels via Cloudflare
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# ── Configuration ──────────────────────────────────────────────────
DEV_DIR="${DEV_DIR:-$(dirname "$(readlink -f "$0")")}"
DEV_USER="${DEV_USER:-$(logname)}"
DEV_GROUP="${DEV_GROUP:-$(id -gn "$DEV_USER")}"
DASHBOARD_PORT="${DASHBOARD_PORT:-3088}"
DASHBOARD_DOMAIN="${DASHBOARD_DOMAIN:-dashboard.ishanparihar.com}"
CLOUDFLARED_TUNNEL_ID="${CLOUDFLARED_TUNNEL_ID:-}"

# LLM Configuration (qwen-proxy defaults)
LLM_BASE_URL="${LLM_BASE_URL:-http://127.0.0.1:3000/v1}"
LLM_MODEL="${LLM_MODEL:-coder-model}"
LLM_CONTEXT_TOKENS="${LLM_CONTEXT_TOKENS:-262144}"
LLM_MAX_TOKENS="${LLM_MAX_TOKENS:-65536}"
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-qwen3-embedding:0.6b}"

# Directories (in-repo)
DATA_DIR="$DEV_DIR/.operant-data"
LOG_DIR="$DEV_DIR/.operant-logs"

log_info()    { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1"; }

# ── Checks ─────────────────────────────────────────────────────────
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

# ── System Deps ────────────────────────────────────────────────────
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
        log_info "Node.js $NODE_VER already installed ($(node -v))"
        return 0
    fi

    local node_version=20
    case "$OS" in
        "Ubuntu"|"Debian"|"Linux Mint"|"Pop!_OS")
            curl -fsSL https://deb.nodesource.com/setup_${node_version}.x | bash -
            apt-get install -y -qq nodejs
            ;;
        "Fedora"|"CentOS"|"RHEL"|"AlmaLinux"|"Rocky")
            curl -fsSL https://rpm.nodesource.com/setup_${node_version}.x | bash -
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

# ── Directories ────────────────────────────────────────────────────
create_directories() {
    log_info "Creating data/log directories..."

    mkdir -p "$DATA_DIR/lancedb"
    mkdir -p "$DATA_DIR/kanban"
    mkdir -p "$DATA_DIR/messages"
    mkdir -p "$DATA_DIR/agents"
    for office in operant coo-productivity cpo-psychologist cro-relational cfo-financial cmo-content cio-intelligence physician-health; do
        mkdir -p "$DATA_DIR/agents/$office"
    done
    mkdir -p "$LOG_DIR"

    chown -R "$DEV_USER:$DEV_GROUP" "$DATA_DIR" "$LOG_DIR"

    log_success "Directories created in $DEV_DIR"
}

# ── Application Install ────────────────────────────────────────────
install_application() {
    log_info "Installing Operant application..."

    cd "$DEV_DIR"

    log_info "Installing npm dependencies..."
    su - "$DEV_USER" -c "cd $DEV_DIR && npm install"

    log_info "Building application..."
    su - "$DEV_USER" -c "cd $DEV_DIR && npx tsc"

    log_success "Application built"
}

create_env_file() {
    log_info "Creating environment configuration..."

    cat > "$DEV_DIR/.env" << EOFENV
# Operant Environment Configuration
# Generated: $(date -Iseconds)

TELEGRAM_BOT_TOKEN=your_bot_token_here
TELEGRAM_CHAT_ID=your_chat_id_here

LLM_BASE_URL=$LLM_BASE_URL
LLM_MODEL=$LLM_MODEL
LLM_CONTEXT_TOKENS=$LLM_CONTEXT_TOKENS
LLM_MAX_TOKENS=$LLM_MAX_TOKENS
OLLAMA_HOST=$OLLAMA_HOST
OLLAMA_EMBED_MODEL=$OLLAMA_EMBED_MODEL

LANCEDB_DIR=$DATA_DIR/lancedb
KANBAN_DB=$DATA_DIR/kanban/kanban.db
MESSAGES_DB=$DATA_DIR/messages/messages.db

LOG_LEVEL=info
LOG_FILE=$LOG_DIR/operant.log
EOFENV

    chmod 600 "$DEV_DIR/.env"
    chown "$DEV_USER:$DEV_GROUP" "$DEV_DIR/.env"

    log_success "Environment file created at $DEV_DIR/.env"
    log_warn "IMPORTANT: Edit .env and set TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID"
}

create_config_json() {
    log_info "Creating JSON configuration..."

    local config_dir="/home/$DEV_USER/.operant"
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
    "lancedb": "$DATA_DIR/lancedb",
    "kanbanDb": "$DATA_DIR/kanban/kanban.db",
    "messagesDb": "$DATA_DIR/messages/messages.db",
    "agentOffices": "$DEV_DIR/agents",
    "logFile": "$LOG_DIR/operant.log"
  },
  "telegram": {
    "botToken": "your-bot-token-from-botfather",
    "chatId": "your-chat-id-from-userinfobot"
  },
  "logging": {
    "level": "info",
    "file": "$LOG_DIR/operant.log",
    "maxFileBytes": 10485760
  }
}
EOFCONFIG

    chmod 600 "$config_dir/config.json"

    log_success "JSON config created at $config_dir/config.json"
    log_warn "IMPORTANT: Edit config.json and set telegram.botToken + telegram.chatId"
}

# ── Systemd Services (dev mode) ────────────────────────────────────
create_systemd_service() {
    log_info "Creating Operant systemd service (dev mode)..."

    cat > /etc/systemd/system/operant.service << EOFSERVICE
[Unit]
Description=Operant Multi-Agent Orchestrator (Dev)
After=network.target

[Service]
Type=simple
User=$DEV_USER
Group=$DEV_GROUP
WorkingDirectory=$DEV_DIR
Environment=NODE_ENV=production
EnvironmentFile=$DEV_DIR/.env
ExecStart=/usr/bin/node $DEV_DIR/build/index.js
Restart=always
RestartSec=5

StandardOutput=append:$LOG_DIR/operant.log
StandardError=append:$LOG_DIR/operant.error.log

LimitNOFILE=65536
MemoryMax=2G
CPUQuota=200%

[Install]
WantedBy=multi-user.target
EOFSERVICE

    chmod 644 /etc/systemd/system/operant.service
    systemctl daemon-reload
    systemctl enable operant.service

    log_success "Operant service created (Restart=always)"
}

# ── Dashboard ──────────────────────────────────────────────────────
install_dashboard() {
    log_info "Installing Dashboard..."

    if [ ! -d "$DEV_DIR/dashboard" ]; then
        log_warn "Dashboard directory not found, skipping"
        return 0
    fi

    cd "$DEV_DIR/dashboard"

    log_info "Installing dashboard dependencies..."
    su - "$DEV_USER" -c "cd $DEV_DIR/dashboard && npm install"

    log_info "Building dashboard..."
    su - "$DEV_USER" -c "cd $DEV_DIR/dashboard && npm run build"

    log_success "Dashboard built"
}

create_dashboard_env() {
    log_info "Creating dashboard environment configuration..."

    cat > "$DEV_DIR/dashboard/.env.local" << EOFDASHENV
# Operant Dashboard Environment Configuration
NODE_ENV=production
PORT=$DASHBOARD_PORT
DATABASE_URL=postgresql://operant:operant_password@localhost:5432/operant
EOFDASHENV

    chmod 600 "$DEV_DIR/dashboard/.env.local"
    chown "$DEV_USER:$DEV_GROUP" "$DEV_DIR/dashboard/.env.local"

    log_success "Dashboard env created at $DEV_DIR/dashboard/.env.local"
}

create_dashboard_systemd_service() {
    log_info "Creating Dashboard systemd service (dev mode)..."

    cat > /etc/systemd/system/operant-dashboard.service << EOFDASHSERVICE
[Unit]
Description=Operant Dashboard (Next.js Dev)
After=network.target operant.service
Wants=operant.service

[Service]
Type=simple
User=$DEV_USER
Group=$DEV_GROUP
WorkingDirectory=$DEV_DIR/dashboard
Environment=NODE_ENV=production
Environment=PORT=$DASHBOARD_PORT
Environment=DATABASE_URL=postgresql://operant:operant_password@localhost:5432/operant
ExecStart=/usr/bin/node $DEV_DIR/dashboard/node_modules/next/dist/bin/next start -p $DASHBOARD_PORT
Restart=always
RestartSec=5

StandardOutput=append:$LOG_DIR/dashboard.log
StandardError=append:$LOG_DIR/dashboard.error.log

LimitNOFILE=65536
MemoryMax=1G
CPUQuota=100%

[Install]
WantedBy=multi-user.target
EOFDASHSERVICE

    chmod 644 /etc/systemd/system/operant-dashboard.service
    systemctl daemon-reload
    systemctl enable operant-dashboard.service

    log_success "Dashboard service created (Restart=always)"
}

# ── Cloudflare Tunnel ──────────────────────────────────────────────
configure_cloudflared_tunnel() {
    log_info "Configuring Cloudflare Tunnel for dashboard..."

    if ! command -v cloudflared &>/dev/null; then
        log_warn "cloudflared not installed — skipping tunnel configuration"
        return 0
    fi

    if [ -z "$CLOUDFLARED_TUNNEL_ID" ]; then
        log_info "Detecting existing tunnel..."
        CLOUDFLARED_TUNNEL_ID=$(su - "$DEV_USER" -c "cloudflared tunnel list --output json 2>/dev/null" | python3 -c "import sys,json; tunnels=json.load(sys.stdin); print(tunnels[0]['id'] if tunnels else '')" 2>/dev/null)
        if [ -z "$CLOUDFLARED_TUNNEL_ID" ]; then
            log_warn "No existing tunnel found."
            log_warn "  cloudflared tunnel create operant"
            log_warn "Then set CLOUDFLARED_TUNNEL_ID=xxx and re-run."
            return 0
        fi
        log_info "Using tunnel: $CLOUDFLARED_TUNNEL_ID"
    fi

    local cf_config="/etc/cloudflared/config.yml"

    if [ -f "$cf_config" ]; then
        sed -i "/- hostname: $DASHBOARD_DOMAIN/d" "$cf_config"
        sed -i "/service: http:\/\/localhost:.*$/d; /service: http_status:404/d" "$cf_config"

        echo "  - hostname: $DASHBOARD_DOMAIN" >> "$cf_config"
        echo "    service: http://localhost:$DASHBOARD_PORT" >> "$cf_config"
        echo "  - service: http_status:404" >> "$cf_config"

        log_info "Updated $cf_config with dashboard route"
    else
        cat > "$cf_config" << EOFCF
tunnel: $CLOUDFLARED_TUNNEL_ID
credentials-file: /home/$DEV_USER/.cloudflared/${CLOUDFLARED_TUNNEL_ID}.json
ingress:
  - hostname: postiz.ishanparihar.com
    service: http://localhost:5000
  - hostname: chatwoot.ishanparihar.com
    service: http://localhost:3000
  - hostname: localn8n.ishanparihar.com
    service: http://localhost:5678
  - hostname: agent0.ishanparihar.com
    service: http://localhost:50001
  - hostname: $DASHBOARD_DOMAIN
    service: http://localhost:$DASHBOARD_PORT
  - service: http_status:404
EOFCF
        log_info "Created $cf_config"
    fi

    TUNNEL_ORIGIN_CERT="/home/$DEV_USER/.cloudflared/cert.pem"
    if [ -f "$TUNNEL_ORIGIN_CERT" ]; then
        cloudflared tunnel route dns \
            --origincert "$TUNNEL_ORIGIN_CERT" \
            "$CLOUDFLARED_TUNNEL_ID" "$DASHBOARD_DOMAIN" 2>/dev/null || {
            log_warn "DNS route may already exist — continuing"
        }
    fi

    systemctl restart cloudflared 2>/dev/null || {
        log_warn "Could not restart cloudflared — do: sudo systemctl restart cloudflared"
    }

    log_success "Cloudflare Tunnel: https://$DASHBOARD_DOMAIN → http://localhost:$DASHBOARD_PORT"
}

# ── CLI Symlink ────────────────────────────────────────────────────
create_cli_symlink() {
    log_info "Installing CLI command..."

    local bin_target="/usr/local/bin/operant"
    local cli_source="$DEV_DIR/bin/operant.mjs"

    if [ -f "$cli_source" ]; then
        ln -sf "$cli_source" "$bin_target"
        chmod +x "$bin_target"
        log_success "CLI installed: operant → $bin_target"
    else
        log_warn "CLI source not found at $cli_source"
    fi
}

# ── Verification ───────────────────────────────────────────────────
verify_installation() {
    log_info "Verifying installation..."

    local errors=0

    command -v node &>/dev/null || { log_error "Node.js not found"; errors=$((errors + 1)); }
    [ -f "$DEV_DIR/build/index.js" ] || { log_error "Application not built"; errors=$((errors + 1)); }
    systemctl list-unit-files | grep -q operant || { log_error "Operant service not installed"; errors=$((errors + 1)); }

    if [ -d "$DEV_DIR/dashboard" ]; then
        [ -d "$DEV_DIR/dashboard/.next" ] || { log_error "Dashboard not built"; errors=$((errors + 1)); }
        systemctl list-unit-files | grep -q operant-dashboard || { log_error "Dashboard service not installed"; errors=$((errors + 1)); }
    fi

    if [ $errors -eq 0 ]; then
        log_success "Installation verified"
    else
        log_error "$errors error(s) found"
    fi
}

print_next_steps() {
    echo ""
    echo "=============================================="
    echo "  Operant Dev Installation Complete!"
    echo "=============================================="
    echo ""
    echo "Working directory: $DEV_DIR"
    echo ""
    echo "1. Configure Telegram bot:"
    echo "   nano $DEV_DIR/.env"
    echo ""
    echo "2. Start services:"
    echo "   sudo systemctl start operant"
    echo "   sudo systemctl start operant-dashboard"
    echo ""
    echo "3. Check status:"
    echo "   sudo systemctl status operant"
    echo "   sudo systemctl status operant-dashboard"
    echo ""
    echo "4. Dashboard:"
    echo "   Local:  http://localhost:$DASHBOARD_PORT"
    echo "   Remote: https://$DASHBOARD_DOMAIN"
    echo ""
    echo "5. Logs:"
    echo "   tail -f $LOG_DIR/operant.log"
    echo "   tail -f $LOG_DIR/dashboard.log"
    echo ""
    echo "Both services have Restart=always — they auto-recover on crash."
    echo ""
    echo "For active frontend development, run manually instead:"
    echo "   cd $DEV_DIR/dashboard && PORT=$DASHBOARD_PORT npx next dev"
    echo "=============================================="
}

# ── Main ───────────────────────────────────────────────────────────
main() {
    echo "=============================================="
    echo "  Operant Development Setup"
    echo "=============================================="
    echo ""

    check_root
    detect_os

    log_info "Starting installation..."
    echo ""

    install_system_deps
    install_nodejs
    create_directories
    install_application
    create_env_file
    create_config_json
    create_systemd_service
    install_dashboard
    create_dashboard_env
    create_dashboard_systemd_service
    configure_cloudflared_tunnel
    create_cli_symlink

    echo ""
    verify_installation

    print_next_steps
}

main "$@"
