#!/usr/bin/env bash
# Safe deploy: backup → migrate → only then replace the running app.
#
#   scripts/deploy.sh                       # production: .env.prod + compose.yaml + compose.prod.yaml
#   ENV_FILE=.env COMPOSE_FILES="compose.yaml" scripts/deploy.sh    # local test of the same flow
#
# Why not just `docker compose up -d`? Compose stops the old app container before
# it waits for `migrate`, so a failing migration takes the site down. Here the
# app is only touched after the dump and the migrations have succeeded; on any
# failure the old version keeps serving. See docs/dev/MIGRATIONS.md §10.
set -euo pipefail
cd "$(dirname "$0")/.."

ENV_FILE="${ENV_FILE:-.env.prod}"
read -r -a FILES <<< "${COMPOSE_FILES:-compose.yaml compose.prod.yaml}"
C=(docker compose --env-file "$ENV_FILE")
for f in "${FILES[@]}"; do C+=(-f "$f"); done

step() { printf '\n==> %s\n' "$*"; }
fail() { printf '\n✗ %s\n  The previously running app was not touched.\n' "$*" >&2; exit 1; }

[ -f "$ENV_FILE" ] || fail "missing $ENV_FILE"

step "Pulling images"
"${C[@]}" pull --ignore-buildable --quiet || fail "could not pull images (is APP_IMAGE a published release?)"

step "Database up"
"${C[@]}" up -d --wait db || fail "database did not become healthy"

step "Backup before migrating"
"${C[@]}" run --rm --no-deps backup-before-migrate || fail "pre-migrate backup failed — not migrating"

step "Applying migrations"
"${C[@]}" run --rm --no-deps migrate || fail "migrations failed — a pre-migrate dump is in the backups volume"

step "Replacing the app"
"${C[@]}" up -d --no-deps --wait app || fail "new app did not become healthy — roll back: set APP_IMAGE to the previous release and run this script again"

step "Starting the remaining services"
mapfile -t OTHERS < <("${C[@]}" config --services | grep -v -x -E 'db|app|migrate|backup-before-migrate' || true)
if [ "${#OTHERS[@]}" -gt 0 ] && ! "${C[@]}" up -d --no-deps --wait "${OTHERS[@]}"; then
	printf '\n✗ The new app is deployed, but these services did not start: %s\n' "${OTHERS[*]}" >&2
	exit 1
fi

printf '\n✓ Deployed. Check: logs (docker compose … logs --tail=50 app) and https://<domain>/healthz\n'
