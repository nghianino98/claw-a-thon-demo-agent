#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://localhost:8080}"

curl -fsS "$BASE_URL/health"
echo

if [[ -n "${AGENT_API_KEY:-}" ]]; then
  curl -fsS -X POST "$BASE_URL/invocations" \
    -H "Content-Type: application/json" \
    -H "X-Agent-Api-Key: $AGENT_API_KEY" \
    -d '{"message":"health check từ smoke test","user_id":"smoke","session_id":"smoke"}'
  echo
fi

