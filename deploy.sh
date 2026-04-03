#!/bin/bash
# Deploy script: build + auto-restart service
set -e

cd /home/ishanp/Documents/GitHub/strategos

echo "=== Building Strategos ==="
npm run build

echo "=== Reloading systemd ==="
systemctl --user daemon-reload

echo "=== Restarting systemd service ==="
systemctl --user restart strategos

echo "=== Waiting for startup ==="
sleep 5

if systemctl --user is-active --quiet strategos; then
  echo "✅ Strategos is running"
  systemctl --user status strategos --no-pager | head -10
  
  echo ""
  echo "=== Health Check ==="
  sleep 3
  curl -sf http://127.0.0.1:4097/health 2>/dev/null && echo "" || echo "⚠️ Health check not ready yet"
else
  echo "❌ Strategos failed to start"
  journalctl --user -u strategos --since "30 seconds ago" --no-pager | tail -20
  exit 1
fi
