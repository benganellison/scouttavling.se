#!/usr/bin/env bash
# Runs the e2e suites that use the dev server, each on fresh seed data, against ONE dev server.
# Usage: [PORT=5204] scripts/e2e-dev.sh [suite …]     (default: all; suites = e2e/<name>.config.ts)
# Needs: the dev database (npm run db:up), .env with DEV_LOGIN=1, and Playwright's Chromium.
# The production-build suites (uat, lifecycle, demo) have their own start commands in their headers.
set -u
cd "$(dirname "$0")/.." || exit 1
PORT="${PORT:-5204}"
ALL=(live series site-admin branding patrol-journey field admin-setup admin-patrols stats privacy)
# These change shared rows (series, owners) and need a full reset rather than a re-seed.
RESET=" series site-admin "
SUITES=("$@")
[ $# -eq 0 ] && SUITES=("${ALL[@]}")

started=0
if ! PORT=$PORT scripts/dev-server.sh status | grep -q running; then PORT=$PORT scripts/dev-server.sh start || exit 1; started=1; fi
trap '[ $started = 1 ] && PORT=$PORT scripts/dev-server.sh stop >/dev/null' EXIT

failed=()
for s in "${SUITES[@]}"; do
	if [[ "$RESET" == *" $s "* ]]; then npm run --silent db:reset >/dev/null 2>&1; else npm run --silent db:seed >/dev/null 2>&1; fi || { echo "== $s: could not prepare the database"; failed+=("$s"); continue; }
	echo "== $s"
	E2E_BASE_URL="http://localhost:$PORT" npx playwright test -c "e2e/$s.config.ts" || failed+=("$s")
done
npm run --silent db:seed >/dev/null 2>&1
if [ ${#failed[@]} -gt 0 ]; then echo "FAILED: ${failed[*]}"; exit 1; fi
echo "all passed: ${SUITES[*]}"
