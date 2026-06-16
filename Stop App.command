#!/bin/bash

# Lấy đường dẫn thư mục hiện tại của file script
cd "$(dirname "$0")" || exit 1

APP_DIR="$(pwd)"
DATA_DIR="data"
PID_FILE="$DATA_DIR/app.pid"
PORT_FILE="$DATA_DIR/app.port"
DAEMON_PID_FILE="$DATA_DIR/syncDaemon.pid"
AUTO_START_LABEL="com.didi-ai-tool.app"
AUTO_START_PLIST="$HOME/Library/LaunchAgents/$AUTO_START_LABEL.plist"

is_pid_alive() {
    [ -n "$1" ] && kill -0 "$1" 2>/dev/null
}

is_didi_port() {
    curl -fsS --max-time 4 "http://localhost:$1/api/health" 2>/dev/null | grep -q '"app":"didi-ai-tool"'
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

find_port_pids_by_cwd() {
    PORT="$1"
    for PID in $(lsof -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null); do
        CWD="$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
        if [ "$CWD" = "$APP_DIR" ]; then
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

    kill "$PID" 2>/dev/null
}

echo "------------------------------------------"
echo "🛑 Đang tắt DuyNQ5 AI Tool..."
echo "------------------------------------------"

if [ -f "$AUTO_START_PLIST" ]; then
    launchctl bootout "gui/$(id -u)" "$AUTO_START_PLIST" >/dev/null 2>&1 || true
fi

PIDS=""
DAEMON_PIDS=""

if [ -f "$PID_FILE" ]; then
    SAVED_PID="$(cat "$PID_FILE" 2>/dev/null)"
    if is_pid_alive "$SAVED_PID"; then
        PIDS="$PIDS $SAVED_PID"
    fi
fi

PIDS="$PIDS $(find_pids_by_cwd_and_pattern "npm run dev")"
PIDS="$PIDS $(find_pids_by_cwd_and_pattern "npm run start")"
PIDS="$PIDS $(find_pids_by_cwd_and_pattern "next dev")"
PIDS="$PIDS $(find_pids_by_cwd_and_pattern "next start")"
PIDS="$PIDS $(find_pids_by_cwd_and_pattern "next-server")"
PIDS="$PIDS $(find_pids_by_cwd_and_pattern ".next/standalone/server.js")"

if [ -f "$PORT_FILE" ]; then
    SAVED_PORT="$(cat "$PORT_FILE" 2>/dev/null)"
    if [ -n "$SAVED_PORT" ] && is_didi_port "$SAVED_PORT"; then
        PIDS="$PIDS $(lsof -t -iTCP:"$SAVED_PORT" -sTCP:LISTEN 2>/dev/null)"
    fi
    if [ -n "$SAVED_PORT" ]; then
        PIDS="$PIDS $(find_port_pids_by_cwd "$SAVED_PORT")"
    fi
fi

if [ -f "$DAEMON_PID_FILE" ]; then
    SAVED_DAEMON_PID="$(cat "$DAEMON_PID_FILE" 2>/dev/null)"
    if is_pid_alive "$SAVED_DAEMON_PID"; then
        DAEMON_PIDS="$DAEMON_PIDS $SAVED_DAEMON_PID"
    fi
fi

DAEMON_PIDS="$DAEMON_PIDS $(find_pids_by_cwd_and_pattern "node src/scripts/worker/syncDaemon.js")"

PIDS="$(printf "%s\n" $PIDS | awk 'NF && !seen[$0]++')"
DAEMON_PIDS="$(printf "%s\n" $DAEMON_PIDS | awk 'NF && !seen[$0]++')"

if [ -z "$PIDS" ] && [ -z "$DAEMON_PIDS" ]; then
    echo "✅ Ứng dụng không chạy."
else
    echo "🔧 Đang dọn dẹp tiến trình ngầm..."

    for PID in $PIDS $DAEMON_PIDS; do
        stop_pid_tree "$PID"
    done

    sleep 2

    for PID in $PIDS $DAEMON_PIDS; do
        if is_pid_alive "$PID"; then
            kill -9 "$PID" 2>/dev/null
        fi
    done

    echo "✅ Đã TẮT ứng dụng và giải phóng thành công!"
fi

rm -f "$PID_FILE" "$PORT_FILE" "$DAEMON_PID_FILE"

sleep 4
exit 0
