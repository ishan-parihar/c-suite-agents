#!/usr/bin/env bash
# ===========================================
# Operant PostgreSQL Backup & Restore
# Usage: ./scripts/backup.sh [backup|restore] [filename]
# ===========================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups"
RETENTION_DAYS=7

if [[ -f "${PROJECT_DIR}/.env" ]]; then
  set -a
  source "${PROJECT_DIR}/.env"
  set +a
fi

PGHOST="${PGHOST:-localhost}"
PGPORT="${PGPORT:-5432}"
PGUSER="${POSTGRES_USER:-operant}"
PGDATABASE="${POSTGRES_DB:-operant}"
export PGPASSWORD="${POSTGRES_PASSWORD:-operant_password}"

mkdir -p "$BACKUP_DIR"

usage() {
  echo "Usage: $0 [backup|restore] [filename]"
  echo ""
  echo "Modes:"
  echo "  backup   Create a compressed backup (default)"
  echo "  restore  Restore from a backup file"
  echo ""
  echo "Examples:"
  echo "  $0 backup                          # Creates operant_YYYYMMDD_HHMMSS.sql.gz"
  echo "  $0 backup custom_name              # Creates custom_name.sql.gz"
  echo "  $0 restore operant_20250101.sql.gz # Restore from specific backup"
  echo "  $0 restore latest                  # Restore from most recent backup"
  exit 1
}

timestamp() {
  date +"%Y%m%d_%H%M%S"
}

backup() {
  local filename="${1:-operant_$(timestamp)}"
  local outfile="${BACKUP_DIR}/${filename}.sql.gz"

  echo "Starting backup..."
  echo "  Database: ${PGDATABASE}@${PGHOST}:${PGPORT}"
  echo "  Output:   ${outfile}"

  pg_dump -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE" \
    --no-owner --no-privileges --clean --if-exists | gzip > "$outfile"

  local size
  size=$(du -h "$outfile" | cut -f1)
  echo "Backup complete: ${outfile} (${size})"

  echo "Cleaning up backups older than ${RETENTION_DAYS} days..."
  find "$BACKUP_DIR" -name "*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
  echo "Done."
}

restore() {
  local filename="$1"

  if [[ -z "$filename" ]]; then
    echo "Error: restore requires a filename."
    usage
  fi

  if [[ "$filename" == "latest" ]]; then
    filename=$(ls -t "${BACKUP_DIR}"/*.sql.gz 2>/dev/null | head -1)
    if [[ -z "$filename" ]]; then
      echo "Error: No backup files found in ${BACKUP_DIR}"
      exit 1
    fi
    echo "Using latest backup: $(basename "$filename")"
  elif [[ ! "$filename" =~ \.sql\.gz$ ]]; then
    filename="${BACKUP_DIR}/${filename}.sql.gz"
  fi

  if [[ ! -f "$filename" ]]; then
    echo "Error: Backup file not found: ${filename}"
    exit 1
  fi

  echo "WARNING: This will DROP and recreate all tables in database '${PGDATABASE}'."
  echo "Restore from: ${filename}"
  read -p "Continue? (y/N): " confirm
  if [[ "$confirm" != "y" && "$confirm" != "Y" ]]; then
    echo "Aborted."
    exit 0
  fi

  echo "Restoring..."
  gunzip -c "$filename" | psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$PGDATABASE"

  echo "Restore complete."
}

case "${1:-backup}" in
  backup)
    backup "$2"
    ;;
  restore)
    restore "$2"
    ;;
  *)
    usage
    ;;
esac
