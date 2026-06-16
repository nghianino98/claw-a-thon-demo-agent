#!/bin/bash

set -u

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$APP_DIR" || exit 1

APP_PORT="${DIDI_AI_PORT:-3001}"
APP_MODE="${DIDI_AI_MODE:-production}"
DATA_DIR="data"
LOG_DIR="logs"
PID_FILE="$DATA_DIR/app.pid"
PORT_FILE="$DATA_DIR/app.port"
DAEMON_PID_FILE="$DATA_DIR/syncDaemon.pid"
BUILD_ID_FILE=".next/BUILD_ID"
WARMUP_ROUTES=(
    "/"
    "/knowledge-base"
    "/history"
    "/workflows"
    "/settings"
    "/settings/mcp"
    "/agent-admin/dashboard"
    "/agent-admin/agent-connects"
    "/agent-admin/bot-management"
    "/agent-admin/instructions"
    "/agent-admin/skills"
    "/agent-admin/knowledge"
)

export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(node -v 2>/dev/null)/bin:$PATH"

mkdir -p "$DATA_DIR" "$LOG_DIR"
echo "$APP_PORT" > "$PORT_FILE"

is_pid_alive() {
    [ -n "$1" ] && kill -0 "$1" 2>/dev/null
}

is_didi_port() {
    curl -fsS --max-time 4 "http://localhost:$APP_PORT/api/health" 2>/dev/null | grep -q '"app":"didi-ai-tool"'
}

find_pids_by_cwd_and_pattern() {
    PATTERN="$1"
    for PID in $(pgrep -f "$PATTERN" 2>/dev/null); do
        CWD="$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
        if [ "$CWD" = "$APP_DIR" ]; then
            echo "$PID"
        fi
    done
}

warm_up_routes() {
    PORT="$1"
    for ROUTE in "${WARMUP_ROUTES[@]}"; do
        curl -fsS --max-time 8 -o /dev/null "http://localhost:$PORT$ROUTE" >/dev/null 2>&1 || true
    done
}

warm_after_ready() {
    PORT="$1"
    for _ in $(seq 1 60); do
        if is_didi_port; then
            warm_up_routes "$PORT"
            return 0
        fi
        sleep 1
    done
}

needs_production_build() {
    if [ "$APP_MODE" != "production" ]; then
        return 1
    fi

    if [ ! -f "$BUILD_ID_FILE" ]; then
        return 0
    fi

    for FILE in package.json package-lock.json next.config.ts tsconfig.json; do
        if [ -f "$FILE" ] && [ "$FILE" -nt "$BUILD_ID_FILE" ]; then
            return 0
        fi
    done

    if find src -type f \( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.css" -o -name "*.svg" \) -newer "$BUILD_ID_FILE" -print -quit | grep -q .; then
        return 0
    fi

    return 1
}

start_sync_daemon() {
    if [ -f "$DAEMON_PID_FILE" ]; then
        DAEMON_PID="$(cat "$DAEMON_PID_FILE" 2>/dev/null)"
        if is_pid_alive "$DAEMON_PID"; then
            return 0
        fi
    fi

    EXISTING_DAEMON_PID="$(find_pids_by_cwd_and_pattern "node src/scripts/worker/syncDaemon.js" | head -n 1)"
    if [ -n "$EXISTING_DAEMON_PID" ]; then
        echo "$EXISTING_DAEMON_PID" > "$DAEMON_PID_FILE"
        return 0
    fi

    nohup env DIDI_APP_DIR="$APP_DIR" STATE_DIR="$APP_DIR/data" node src/scripts/worker/syncDaemon.js >> "$LOG_DIR/syncDaemon.log" 2>&1 < /dev/null &
    echo $! > "$DAEMON_PID_FILE"
}

prepare_standalone_assets() {
    mkdir -p .next/standalone/.next
    rm -rf .next/standalone/.next/static
    cp -R .next/static .next/standalone/.next/static
    if [ -d public ]; then
        rm -rf .next/standalone/public
        cp -R public .next/standalone/public
    fi
    if [ -f .env ]; then
        cp .env .next/standalone/.env
    fi
    if [ -d src/scripts/confluence_docs_tools ]; then
        mkdir -p .next/standalone/src/scripts
        rm -rf .next/standalone/src/scripts/confluence_docs_tools
        cp -R src/scripts/confluence_docs_tools .next/standalone/src/scripts/confluence_docs_tools
    fi
}

if ! command -v npm >/dev/null 2>&1; then
    echo "Missing npm. Install Node.js first." >&2
    exit 127
fi

if [ ! -d "node_modules" ]; then
    npm install --legacy-peer-deps
fi

if is_didi_port; then
    echo "Didi AI Tool is already available at http://localhost:$APP_PORT"
    start_sync_daemon
    warm_up_routes "$APP_PORT"
    while is_didi_port; do
        sleep 30
    done
fi

if [ "$APP_MODE" = "dev" ]; then
    start_sync_daemon
    echo "$$" > "$PID_FILE"
    ( warm_after_ready "$APP_PORT" ) &
    exec npm run dev -- --port "$APP_PORT"
fi

if needs_production_build; then
    npm run build
fi

prepare_standalone_assets
start_sync_daemon
echo "$$" > "$PID_FILE"
( warm_after_ready "$APP_PORT" ) &
exec env DIDI_APP_DIR="$APP_DIR" STATE_DIR="$APP_DIR/data" PORT="$APP_PORT" HOSTNAME="0.0.0.0" node .next/standalone/server.js
