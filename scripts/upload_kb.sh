#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 https://agent-endpoint /path/to/wealth-kb.zip [activate=true]" >&2
  exit 2
fi

BASE_URL="${1%/}"
ZIP_PATH="$2"
ACTIVATE="${3:-true}"

if [[ -z "${AGENT_ADMIN_TOKEN:-}" ]]; then
  echo "AGENT_ADMIN_TOKEN must be set in the environment" >&2
  exit 2
fi

curl -fsS -X POST "$BASE_URL/admin/api/kb/upload?activate=$ACTIVATE" \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H "X-Acting-User: ${ACTING_USER:-duy}" \
  -H "X-Acting-Role: ${ACTING_ROLE:-superadmin}" \
  -F "file=@${ZIP_PATH}"
