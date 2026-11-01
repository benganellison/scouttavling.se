#!/usr/bin/env bash
# Dev: restore a dump made by db-backup.sh (default: the newest one).
#   npm run db:restore                 # newest dump
#   npm run db:restore -- <file>       # a specific dump from .db-backups/
# Replaces the whole local database. The current state is backed up first.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=.db-backups
COMPOSE=(docker compose -f ../../compose.dev.yaml)
FILE="${1:-$(ls -1t "$DIR"/*.dump 2>/dev/null | head -1 || true)}"
[ -n "$FILE" ] && [ -f "$FILE" ] || { echo "db-restore: no dump found (looked in $DIR/)" >&2; exit 1; }

scripts/db-backup.sh before-restore
echo "db-restore: restoring $FILE"
"${COMPOSE[@]}" exec -T db psql -U scout -d scouttavling -q -c "drop schema public cascade; create schema public;"
"${COMPOSE[@]}" exec -T db pg_restore -U scout -d scouttavling --no-owner --exit-on-error < "$FILE"
echo "db-restore: done"
