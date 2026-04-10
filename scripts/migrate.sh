#!/usr/bin/env bash
# ===========================================
# Operant Database Migration Runner
# Usage: ./scripts/migrate.sh
# ===========================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

if [[ -f "${PROJECT_DIR}/.env" ]]; then
  set -a
  source "${PROJECT_DIR}/.env"
  set +a
fi

export DATABASE_URL="${DATABASE_URL:-postgresql://operant:operant_password@localhost:5432/operant}"

echo "Running Drizzle migrations..."
echo "  Database: ${DATABASE_URL}"

cd "$PROJECT_DIR"

if command -v bun &>/dev/null; then
  bunx drizzle-kit migrate
elif command -v npx &>/dev/null; then
  npx drizzle-kit migrate
else
  echo "Error: Neither 'bun' nor 'npx' found. Install one to run migrations."
  exit 1
fi

echo "Migrations complete."
