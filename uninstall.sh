#!/bin/bash
#
# Operant Uninstall Script
# Removes all Operant components from the system
#
# Usage: sudo ./uninstall.sh
#

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

OPERANT_DIR="${OPERANT_DIR:-/opt/operant}"
OPERANT_DATA_DIR="${OPERANT_DATA_DIR:-/var/lib/operant}"
OPERANT_LOG_DIR="${OPERANT_LOG_DIR:-/var/log/operant}"
OPERANT_USER="${OPERANT_USER:-operant}"

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }

if [[ $EUID -ne 0 ]]; then
    echo "This script must be run as root"
    exit 1
fi

echo "=============================================="
echo "  Operant Uninstall"
echo "=============================================="
echo ""

# Stop and disable service
log_info "Stopping Operant service..."
systemctl stop operant.service 2>/dev/null || true
systemctl disable operant.service 2>/dev/null || true

# Remove systemd service
log_info "Removing systemd service..."
rm -f /etc/systemd/system/operant.service
systemctl daemon-reload

# Remove logrotate
log_info "Removing logrotate configuration..."
rm -f /etc/logrotate.d/operant

# Remove user
log_info "Removing system user..."
userdel "$OPERANT_USER" 2>/dev/null || true

# Remove directories (ask for confirmation)
echo ""
read -p "Remove data directory ($OPERANT_DATA_DIR)? This will delete all messages, memories, and Kanban data. [y/N] " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_info "Removing data directory..."
    rm -rf "$OPERANT_DATA_DIR"
else
    log_warn "Keeping data directory"
fi

read -p "Remove application directory ($OPERANT_DIR)? [y/N] " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_info "Removing application directory..."
    rm -rf "$OPERANT_DIR"
else
    log_warn "Keeping application directory"
fi

log_info "Removing log directory..."
rm -rf "$OPERANT_LOG_DIR"

echo ""
echo "=============================================="
echo "  Uninstall Complete"
echo "=============================================="
echo ""
echo "Note: Ollama and Node.js were NOT removed."
echo "Remove manually if no longer needed:"
echo "  sudo apt remove ollama nodejs  # Debian/Ubuntu"
echo "  sudo dnf remove ollama nodejs  # Fedora/RHEL"
echo ""
