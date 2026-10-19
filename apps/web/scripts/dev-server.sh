#!/usr/bin/env bash
# Start/stop the dev server in the background with a PID file (used by agents and UAT).
# Usage: [PORT=5173] scripts/dev-server.sh start|stop|status   (one server per port)
set -u
cd "$(dirname "$0")/.." || exit 1
PORT="${PORT:-5173}"
PIDFILE=".dev-server-$PORT.pid"
LOG=".dev-server-$PORT.log"
case "${1:-status}" in
	start)
		if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "running (pid $(cat "$PIDFILE"))"; exit 0; fi
		setsid npx vite dev --port "$PORT" --strictPort > "$LOG" 2>&1 &
		echo $! > "$PIDFILE"
		for _ in $(seq 1 60); do curl -s -o /dev/null "http://localhost:$PORT/" && { echo "started (pid $(cat "$PIDFILE"))"; exit 0; }; sleep 1; done
		echo "failed to start; see $LOG"; tail -20 "$LOG"; exit 1 ;;
	stop)
		if [ -f "$PIDFILE" ]; then kill -- -"$(cat "$PIDFILE")" 2>/dev/null || kill "$(cat "$PIDFILE")" 2>/dev/null; rm -f "$PIDFILE"; echo stopped; else echo "not running"; fi ;;
	status)
		if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "running (pid $(cat "$PIDFILE"))"; else echo "not running"; fi ;;
esac
