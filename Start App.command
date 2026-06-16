#!/bin/bash

# Lấy đường dẫn thư mục hiện tại của file script
cd "$(dirname "$0")" || exit 1

APP_DIR="$(pwd)"
DATA_DIR="data"
LOG_DIR="logs"
PID_FILE="$DATA_DIR/app.pid"
PORT_FILE="$DATA_DIR/app.port"
DAEMON_PID_FILE="$DATA_DIR/syncDaemon.pid"
PORT_RANGE_START="${DIDI_AI_PORT_START:-3001}"
PORT_RANGE_END="${DIDI_AI_PORT_END:-3001}"
APP_MODE="${DIDI_AI_MODE:-production}"
BUILD_ID_FILE=".next/BUILD_ID"
APP_SERVER_PID=""
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

# Thêm đường dẫn phổ biến của Node.js (Homebrew, v.v.)
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(node -v 2>/dev/null)/bin:$PATH"

is_pid_alive() {
    [ -n "$1" ] && kill -0 "$1" 2>/dev/null
}

port_is_free() {
    ! lsof -t -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
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

find_app_server_pids() {
    find_pids_by_cwd_and_pattern "npm run dev"
    find_pids_by_cwd_and_pattern "npm run start"
    find_pids_by_cwd_and_pattern "next dev"
    find_pids_by_cwd_and_pattern "next start"
    find_pids_by_cwd_and_pattern "next-server"
    find_pids_by_cwd_and_pattern "node .next/standalone/server.js"
    find_pids_by_cwd_and_pattern ".next/standalone/server.js"
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

find_existing_port() {
    if [ -f "$PORT_FILE" ]; then
        SAVED_PORT="$(cat "$PORT_FILE" 2>/dev/null)"
        if [ -n "$SAVED_PORT" ] && is_didi_port "$SAVED_PORT"; then
            echo "$SAVED_PORT"
            return 0
        fi
    fi

    for PORT in $(seq "$PORT_RANGE_START" "$PORT_RANGE_END"); do
        if is_didi_port "$PORT"; then
            echo "$PORT"
            return 0
        fi
    done

    return 1
}

find_free_port() {
    for PORT in $(seq "$PORT_RANGE_START" "$PORT_RANGE_END"); do
        if port_is_free "$PORT"; then
            echo "$PORT"
            return 0
        fi
    done

    return 1
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

warm_up_routes() {
    PORT="$1"
    echo "⚡ Đang làm nóng các màn hình chính để bấm menu nhanh hơn..."
    for ROUTE in "${WARMUP_ROUTES[@]}"; do
        curl -fsS --max-time 8 -o /dev/null "http://localhost:$PORT$ROUTE" >/dev/null 2>&1 || true
    done
}

start_app_server() {
    if [ "$APP_MODE" = "dev" ]; then
        echo "🧪 Đang chạy DEV mode tại http://localhost:$APP_PORT ..."
        nohup npm run dev -- --port "$APP_PORT" > "$LOG_DIR/server.log" 2>&1 < /dev/null &
        APP_SERVER_PID=$!
        disown "$APP_SERVER_PID" 2>/dev/null || true
    else
        if needs_production_build; then
            echo "🏗️ Đang build production để app chạy nhanh hơn..."
            npm run build
            BUILD_STATUS=$?
            if [ "$BUILD_STATUS" -ne 0 ]; then
                echo "❌ Build production thất bại. Log gần nhất:"
                tail -n 80 "$LOG_DIR/server.log" 2>/dev/null || true
                exit "$BUILD_STATUS"
            fi
        else
            echo "✅ Production build vẫn mới, bỏ qua bước build."
        fi

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

        echo "🚀 Đang chạy PRODUCTION mode tại http://localhost:$APP_PORT ..."
        nohup env DIDI_APP_DIR="$APP_DIR" STATE_DIR="$APP_DIR/data" PORT="$APP_PORT" HOSTNAME="0.0.0.0" node .next/standalone/server.js > "$LOG_DIR/server.log" 2>&1 < /dev/null &
        APP_SERVER_PID=$!
        disown "$APP_SERVER_PID" 2>/dev/null || true
    fi
}

start_sync_daemon() {
    if [ -f "$DAEMON_PID_FILE" ]; then
        DAEMON_PID="$(cat "$DAEMON_PID_FILE" 2>/dev/null)"
        if is_pid_alive "$DAEMON_PID"; then
            echo "✅ Sync Daemon đang chạy sẵn (PID $DAEMON_PID)."
            return 0
        fi
    fi

    EXISTING_DAEMON_PID="$(find_pids_by_cwd_and_pattern "node src/scripts/worker/syncDaemon.js" | head -n 1)"
    if [ -n "$EXISTING_DAEMON_PID" ]; then
        echo "$EXISTING_DAEMON_PID" > "$DAEMON_PID_FILE"
        echo "✅ Sync Daemon đang chạy sẵn (PID $EXISTING_DAEMON_PID)."
        return 0
    fi

    echo "🔧 Đang khởi động tiến trình Đồng bộ ngầm (Sync Daemon)..."
    nohup env DIDI_APP_DIR="$APP_DIR" STATE_DIR="$APP_DIR/data" node src/scripts/worker/syncDaemon.js >> "$LOG_DIR/syncDaemon.log" 2>&1 < /dev/null &
    echo $! > "$DAEMON_PID_FILE"
    disown 2>/dev/null || true
}

echo "------------------------------------------"
echo "🚀 Đang kiểm tra DuyNQ5 AI Tool..."
echo "------------------------------------------"

# Kiểm tra xem npm có tồn tại không
if ! command -v npm &> /dev/null; then
    echo "❌ LỖI: Không tìm thấy 'npm' (Node.js). Vui lòng cài đặt Node.js trước!"
    echo "💡 Gợi ý: Chạy lệnh 'brew install node' trong Terminal."
    sleep 5
    exit 1
fi

# Tạo thư mục logs & data (nếu chưa có)
mkdir -p "$LOG_DIR"
mkdir -p "$DATA_DIR"

# Kiểm tra nếu chưa có node_modules thì cài đặt
if [ ! -d "node_modules" ]; then
    echo "📦 Đang cài đặt thư viện (chỉ thực hiện lần đầu)..."
    npm install --legacy-peer-deps
fi

EXISTING_PORT="$(find_existing_port)"
if [ -n "$EXISTING_PORT" ]; then
    echo "$EXISTING_PORT" > "$PORT_FILE"
    EXISTING_PID="$(find_pids_by_cwd_and_pattern "next dev" | head -n 1)"
    if [ -z "$EXISTING_PID" ]; then
        EXISTING_PID="$(find_pids_by_cwd_and_pattern "next start" | head -n 1)"
    fi
    if [ -z "$EXISTING_PID" ]; then
        EXISTING_PID="$(find_pids_by_cwd_and_pattern "next-server" | head -n 1)"
    fi
    if [ -z "$EXISTING_PID" ]; then
        EXISTING_PID="$(find_pids_by_cwd_and_pattern ".next/standalone/server.js" | head -n 1)"
    fi
    if [ -n "$EXISTING_PID" ]; then
        echo "$EXISTING_PID" > "$PID_FILE"
    fi

    if [ "$APP_MODE" = "production" ] && needs_production_build; then
        echo "🔁 Source code mới hơn production build. Đang restart để build lại..."

        for PID in $EXISTING_PID $(lsof -t -iTCP:"$EXISTING_PORT" -sTCP:LISTEN 2>/dev/null); do
            stop_pid_tree "$PID"
        done
        sleep 2
        for PID in $EXISTING_PID $(lsof -t -iTCP:"$EXISTING_PORT" -sTCP:LISTEN 2>/dev/null); do
            if is_pid_alive "$PID"; then
                kill -9 "$PID" 2>/dev/null
            fi
        done

        APP_PORT="$EXISTING_PORT"
        echo "$APP_PORT" > "$PORT_FILE"
        start_app_server
        APP_PID="$APP_SERVER_PID"
        echo "$APP_PID" > "$PID_FILE"

        start_sync_daemon

        echo "⏱️ Đang đợi app sẵn sàng..."
        for _ in $(seq 1 40); do
            if is_didi_port "$APP_PORT"; then
                warm_up_routes "$APP_PORT"
                echo "✅ Đã khởi động xong!"
                echo "🌐 URL: http://localhost:$APP_PORT"
                open "http://localhost:$APP_PORT"
                sleep 4
                exit 0
            fi

            if ! is_pid_alive "$APP_PID"; then
                echo "❌ App vừa khởi động nhưng đã dừng. Log gần nhất:"
                tail -n 40 "$LOG_DIR/server.log"
                sleep 8
                exit 1
            fi

            sleep 1
        done

        echo "❌ Hết thời gian chờ app khởi động."
        tail -n 40 "$LOG_DIR/server.log"
        sleep 8
        exit 1
    fi

    echo "✅ App đã đang chạy sẵn ở http://localhost:$EXISTING_PORT"
    start_sync_daemon
    warm_up_routes "$EXISTING_PORT"
    echo "🌐 Đang mở lại trình duyệt..."
    open "http://localhost:$EXISTING_PORT"
    sleep 4
    exit 0
fi

APP_PORT="$(find_free_port)"
if [ -z "$APP_PORT" ]; then
    echo "❌ LỖI: Không tìm thấy cổng trống trong khoảng $PORT_RANGE_START-$PORT_RANGE_END."
    echo "💡 Gợi ý: Tắt bớt app local khác hoặc chạy: DIDI_AI_PORT_START=3011 DIDI_AI_PORT_END=3020 ./Start\\ App.command"
    sleep 6
    exit 1
fi

echo "$APP_PORT" > "$PORT_FILE"

# Chạy app ở chế độ background bằng nohup, cố định đúng cổng đã chọn.
start_app_server
APP_PID="$APP_SERVER_PID"
echo "$APP_PID" > "$PID_FILE"

start_sync_daemon

echo "⏱️ Đang đợi app sẵn sàng..."
for _ in $(seq 1 40); do
    if is_didi_port "$APP_PORT"; then
        warm_up_routes "$APP_PORT"
        echo "✅ Đã khởi động xong!"
        echo "🌐 URL: http://localhost:$APP_PORT"
        echo "🎉 BẠN CÓ THỂ TẮT CỬA SỔ TERMINAL NÀY THOẢI MÁI MÀ APP VẪN CHẠY!"
        open "http://localhost:$APP_PORT"
        sleep 4
        exit 0
    fi

    if ! is_pid_alive "$APP_PID"; then
        echo "❌ App vừa khởi động nhưng đã dừng. Log gần nhất:"
        tail -n 40 "$LOG_DIR/server.log"
        sleep 8
        exit 1
    fi

    sleep 1
done

echo "⚠️ App khởi động lâu hơn dự kiến. Mình vẫn mở trình duyệt, nếu chưa thấy giao diện hãy đợi thêm vài giây."
echo "🌐 URL: http://localhost:$APP_PORT"
open "http://localhost:$APP_PORT"
sleep 4
exit 0
