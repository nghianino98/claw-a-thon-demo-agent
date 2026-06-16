#!/bin/bash

LABEL="com.didi-ai-tool.app"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
USER_ID="$(id -u)"

launchctl bootout "gui/$USER_ID" "$PLIST_PATH" >/dev/null 2>&1 || true
launchctl disable "gui/$USER_ID/$LABEL" >/dev/null 2>&1 || true
rm -f "$PLIST_PATH"

echo "✅ Auto-start đã tắt."
sleep 4
