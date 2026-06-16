#!/bin/bash

cd "$(dirname "$0")" || exit 1

APP_DIR="$(pwd)"
LABEL="com.didi-ai-tool.app"
PLIST_DIR="$HOME/Library/LaunchAgents"
PLIST_PATH="$PLIST_DIR/$LABEL.plist"
SERVICE_SCRIPT="$APP_DIR/scripts/didi-ai-service.sh"
USER_ID="$(id -u)"

mkdir -p "$PLIST_DIR" logs data
chmod +x "$SERVICE_SCRIPT"
chmod +x "$APP_DIR/scripts/didi-ai-watchdog.sh"

launchctl bootout "gui/$USER_ID" "$PLIST_PATH" >/dev/null 2>&1 || true

PORT_PIDS="$(lsof -t -iTCP:3001 -sTCP:LISTEN 2>/dev/null)"
APP_PIDS=""
for PID in $(pgrep -f "next dev|next start|next-server|node_modules/.bin/next|.next/standalone/server.js|didi-ai-watchdog.sh" 2>/dev/null); do
  CWD="$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  if [ "$CWD" = "$APP_DIR" ] || [[ "$CWD" == "$APP_DIR"/* ]]; then
    APP_PIDS="$APP_PIDS $PID"
  fi
done

PIDS="$(printf "%s\n" $PORT_PIDS $APP_PIDS | awk 'NF && !seen[$0]++')"
if [ -n "$PIDS" ]; then
  kill $PIDS 2>/dev/null || true
  sleep 2
  for PID in $PIDS; do
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
  done
fi

cat > "$PLIST_PATH" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>

  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>-lc</string>
    <string>cd "$APP_DIR" &amp;&amp; exec "$SERVICE_SCRIPT"</string>
  </array>

  <key>WorkingDirectory</key>
  <string>$APP_DIR</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>DIDI_AI_PORT</key>
    <string>3001</string>
    <key>DIDI_AI_MODE</key>
    <string>production</string>
  </dict>

  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>30</integer>
  <key>ProcessType</key>
  <string>Interactive</string>

  <key>StandardOutPath</key>
  <string>$APP_DIR/logs/launchd.log</string>
  <key>StandardErrorPath</key>
  <string>$APP_DIR/logs/launchd-error.log</string>
</dict>
</plist>
EOF

launchctl bootstrap "gui/$USER_ID" "$PLIST_PATH"
launchctl enable "gui/$USER_ID/$LABEL"
launchctl kickstart -k "gui/$USER_ID/$LABEL" >/dev/null 2>&1 &
KICKSTART_PID=$!

for _ in $(seq 1 12); do
  if curl -fsS --max-time 2 "http://localhost:3001/api/health" >/dev/null 2>&1; then
    break
  fi

  if ! kill -0 "$KICKSTART_PID" 2>/dev/null; then
    break
  fi

  sleep 1
done

if kill -0 "$KICKSTART_PID" 2>/dev/null; then
  kill "$KICKSTART_PID" 2>/dev/null || true
  wait "$KICKSTART_PID" 2>/dev/null || true
fi

echo "✅ Auto-start đã bật."
echo "🌐 Link cố định: http://localhost:3001/knowledge-base"
sleep 4
