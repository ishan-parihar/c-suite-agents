#!/bin/bash
#
# Strategos Installation Verification Script
# Checks all components are properly installed and configured
#
# Usage: ./verify-install.sh
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

STRATEGOS_DIR="${STRATEGOS_DIR:-/opt/strategos}"
STRATEGOS_DATA_DIR="${STRATEGOS_DATA_DIR:-/var/lib/strategos}"
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-qwen3-embedding:0.6b}"

PASS=0
FAIL=0
WARN=0

check_pass() {
    echo -e "${GREEN}✓${NC} $1"
    PASS=$((PASS + 1))
}

check_fail() {
    echo -e "${RED}✗${NC} $1"
    FAIL=$((FAIL + 1))
}

check_warn() {
    echo -e "${YELLOW}⚠${NC} $1"
    WARN=$((WARN + 1))
}

echo "=============================================="
echo "  Strategos Installation Verification"
echo "=============================================="
echo ""

# Check Node.js
echo "Checking Node.js..."
if command -v node &> /dev/null; then
    NODE_VER=$(node -v)
    NODE_MAJOR=$(echo $NODE_VER | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_MAJOR" -ge 18 ]; then
        check_pass "Node.js $NODE_VER installed"
    else
        check_fail "Node.js $NODE_VER too old (need 18+)"
    fi
else
    check_fail "Node.js not installed"
fi

# Check npm
echo "Checking npm..."
if command -v npm &> /dev/null; then
    check_pass "npm $(npm -v) installed"
else
    check_fail "npm not installed"
fi

# Check Ollama
echo "Checking Ollama..."
if command -v ollama &> /dev/null; then
    check_pass "Ollama installed"
    
    # Check if service is running
    if systemctl is-active --quiet ollama 2>/dev/null || curl -s "$OLLAMA_HOST/api/tags" &> /dev/null; then
        check_pass "Ollama service running"
    else
        check_warn "Ollama service not running (start with: sudo systemctl start ollama)"
    fi
    
    # Check embedding model
    if ollama list 2>/dev/null | grep -q "$OLLAMA_EMBED_MODEL"; then
        check_pass "Embedding model ($OLLAMA_EMBED_MODEL) installed"
    else
        check_fail "Embedding model not installed (run: ollama pull $OLLAMA_EMBED_MODEL)"
    fi
else
    check_fail "Ollama not installed"
fi

# Check SQLite
echo "Checking SQLite..."
if command -v sqlite3 &> /dev/null; then
    check_pass "SQLite3 installed"
else
    check_warn "SQLite3 not found (may use bundled sql.js)"
fi

# Check application directory
echo "Checking application..."
if [ -d "$STRATEGOS_DIR" ]; then
    check_pass "Application directory exists ($STRATEGOS_DIR)"
    
    if [ -f "$STRATEGOS_DIR/build/index.js" ]; then
        check_pass "Application built"
    else
        check_fail "Application not built (run: npm run build)"
    fi
    
    if [ -f "$STRATEGOS_DIR/package.json" ]; then
        check_pass "Package files present"
    else
        check_fail "Package files missing"
    fi
else
    check_warn "Application directory not found (development mode?)"
fi

# Check environment file
echo "Checking configuration..."
if [ -f "$STRATEGOS_DIR/.env" ]; then
    check_pass "Environment file exists"
    
    if grep -q "TELEGRAM_BOT_TOKEN=your_bot_token" "$STRATEGOS_DIR/.env" 2>/dev/null; then
        check_warn "Telegram bot token not configured"
    else
        check_pass "Telegram bot token configured"
    fi
    
    if grep -q "TELEGRAM_CHAT_ID=your_chat_id" "$STRATEGOS_DIR/.env" 2>/dev/null; then
        check_warn "Telegram chat ID not configured"
    else
        check_pass "Telegram chat ID configured"
    fi
elif [ -f ".env" ]; then
    check_pass "Environment file exists (development)"
else
    check_warn "Environment file not found"
fi

# Check systemd service
echo "Checking systemd service..."
if [ -f "/etc/systemd/system/strategos.service" ]; then
    check_pass "Systemd service file exists"
    
    if systemctl is-enabled strategos.service &>/dev/null; then
        check_pass "Service enabled on boot"
    else
        check_warn "Service not enabled (run: sudo systemctl enable strategos)"
    fi
    
    if systemctl is-active --quiet strategos.service 2>/dev/null; then
        check_pass "Service is running"
    else
        check_warn "Service not running (start with: sudo systemctl start strategos)"
    fi
else
    check_warn "Systemd service not installed (development mode?)"
fi

# Check data directories
echo "Checking data directories..."
if [ -d "$STRATEGOS_DATA_DIR" ]; then
    check_pass "Data directory exists"
    
    if [ -d "$STRATEGOS_DATA_DIR/lancedb" ]; then
        check_pass "LanceDB directory exists"
    fi
    
    if [ -d "$STRATEGOS_DATA_DIR/kanban" ]; then
        check_pass "Kanban directory exists"
    fi
    
    if [ -d "$STRATEGOS_DATA_DIR/messages" ]; then
        check_pass "Messages directory exists"
    fi
else
    check_warn "Data directory not found (will be created on first run)"
fi

# Check log directory
echo "Checking log directories..."
if [ -d "/var/log/strategos" ]; then
    check_pass "Log directory exists"
else
    check_warn "Log directory not found (will be created on first run)"
fi

# Summary
echo ""
echo "=============================================="
echo "  Verification Summary"
echo "=============================================="
echo -e "${GREEN}Passed:${NC}   $PASS"
echo -e "${RED}Failed:${NC}   $FAIL"
echo -e "${YELLOW}Warnings:${NC} $WARN"
echo ""

if [ $FAIL -eq 0 ]; then
    echo -e "${GREEN}Installation looks good!${NC}"
    echo ""
    echo "Next steps:"
    echo "1. Configure .env file with Telegram credentials"
    echo "2. Start service: sudo systemctl start strategos"
    echo "3. Check logs: sudo journalctl -u strategos -f"
    echo "4. Test in Telegram: Send /start to your bot"
    exit 0
else
    echo -e "${RED}Installation has issues. Please fix the failed checks above.${NC}"
    echo ""
    echo "Run 'sudo ./install.sh' to complete installation"
    exit 1
fi
