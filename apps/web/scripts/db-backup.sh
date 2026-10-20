#!/usr/bin/env bash
# Dev: dump the local database (compose.dev.yaml container) before anything
# that changes the schema. Used automatically by `npm run db:migrate` and
# `npm run db:reset`; run it by hand any time: `npm run db:backup -- <label>`.
# Dumps go to apps/web/.db-backups/ (gitignored); the newest 20 are kept.
set -euo pipefail
cd "$(dirname "$0")/.."
LABEL="${1:-manual}"
DIR=.db-backups
COMPOSE=(docker compose -f ../../compose.dev.yaml)
mkdir -p "$DIR"

if ! "${COMPOSE[@]}" exec -T db pg_isready -U scout -d scouttavling >/dev/null 2>&1; then
	echo "db-backup: the dev database container is not running (docker compose -f compose.dev.yaml up -d)." >&2
	echo "db-backup: refusing to continue without a backup. Set SKIP_BACKUP=1 to override." >&2
	[ "${SKIP_BACKUP:-}" = "1" ] && exit 0 || exit 1
fi

FILE="$DIR/$(date -u +%Y%m%dT%H%M%SZ)-$LABEL.dump"
"${COMPOSE[@]}" exec -T db pg_dump -U scout -d scouttavling -Fc > "$FILE.tmp"
mv "$FILE.tmp" "$FILE"
echo "db-backup: $FILE ($(du -h "$FILE" | cut -f1))"
ls -1t "$DIR"/*.dump 2>/dev/null | tail -n +21 | xargs -r rm -f
