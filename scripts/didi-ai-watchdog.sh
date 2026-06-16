#!/bin/bash

set -u

APP_DIR="${DIDI_APP_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
APP_PORT="${DIDI_AI_PORT:-3001}"
LOG_FILE="$APP_DIR/logs/watchdog.log"
FAILURES=0

mkdir -p "$APP_DIR/logs"

log() {
    printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

is_pid_alive() {
    [ -n "$1" ] && kill -0 "$1" 2>/dev/null
}

pid_cwd() {
    lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1
}

find_pids_by_cwd_and_pattern() {
    PATTERN="$1"
    for PID in $(pgrep -f "$PATTERN" 2>/dev/null); do
        if [ "$(pid_cwd "$PID")" = "$APP_DIR" ]; then
            echo "$PID"
        fi
    done
}

find_port_pids_by_cwd() {
    for PID in $(lsof -t -iTCP:"$APP_PORT" -sTCP:LISTEN 2>/dev/null); do
        if [ "$(pid_cwd "$PID")" = "$APP_DIR" ]; then
            echo "$PID"
        fi
    done
}

stop_pid_tree() {
    PID="$1"
    if ! is_pid_alive "$PID"; then
        return 0
    fi

    for CHILD_PID in $(pgrep -P "$PID" 2>/dev/null); do
        stop_pid_tree "$CHILD_PID"
    done

    kill "$PID" 2>/dev/null || true
}

stop_pids() {
    PIDS="$(printf "%s\n" "$@" | awk 'NF && !seen[$0]++')"
    [ -z "$PIDS" ] && return 0

    log "Stopping app process tree(s): $PIDS"
    for PID in $PIDS; do
        stop_pid_tree "$PID"
    done

    sleep 2

    for PID in $PIDS; do
        if is_pid_alive "$PID"; then
            kill -9 "$PID" 2>/dev/null || true
        fi
    done
}

log "Watchdog started for $APP_DIR on port $APP_PORT"

while true; do
    DEV_PIDS="$(
        find_pids_by_cwd_and_pattern "npm run dev"
        find_pids_by_cwd_and_pattern "next dev"
        find_pids_by_cwd_and_pattern "node_modules/.bin/next dev"
    )"

    if [ -n "$DEV_PIDS" ]; then
        log "Detected dev server on production port. Replacing it with production service."
        stop_pids $DEV_PIDS $(find_port_pids_by_cwd)
        exit 0
    fi

    if curl -fsS --max-time 4 "http://localhost:$APP_PORT/api/health" >/dev/null 2>&1; then
        FAILURES=0
    else
        FAILURES=$((FAILURES + 1))
        log "Health check failed ($FAILURES/3)."
    fi

    if [ "$FAILURES" -ge 3 ]; then
        PORT_PIDS="$(find_port_pids_by_cwd)"
        if [ -n "$PORT_PIDS" ]; then
            log "Health stayed down. Killing listener(s) on port $APP_PORT so launchd can restart."
            stop_pids $PORT_PIDS
        else
            log "Health stayed down but no app listener was found."
        fi
        exit 0
    fi

    sleep 20
done
