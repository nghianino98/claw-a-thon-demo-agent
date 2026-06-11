#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo "usage: $0 https://agent-endpoint /path/to/wealth-kb.zip [activate=true] [part_size=50m]" >&2
  exit 2
fi

BASE_URL="${1%/}"
ZIP_PATH="$2"
ACTIVATE="${3:-true}"
PART_SIZE="${4:-50m}"

if [[ -z "${AGENT_ADMIN_TOKEN:-}" ]]; then
  echo "AGENT_ADMIN_TOKEN must be set in the environment" >&2
  exit 2
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

split -b "$PART_SIZE" -d -a 5 "$ZIP_PATH" "$TMP_DIR/part-"
TOTAL_PARTS="$(find "$TMP_DIR" -type f -name 'part-*' | wc -l | tr -d ' ')"
FILENAME="$(basename "$ZIP_PATH")"

START_JSON="$(python3 - <<PY
import json
print(json.dumps({"filename": "$FILENAME", "total_parts": int("$TOTAL_PARTS"), "activate": "$ACTIVATE".lower() == "true"}))
PY
)"

UPLOAD_ID="$(curl -fsS -X POST "$BASE_URL/admin/api/kb/chunked/start" \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H "X-Acting-User: ${ACTING_USER:-duy}" \
  -H "X-Acting-Role: ${ACTING_ROLE:-superadmin}" \
  -H "Content-Type: application/json" \
  -d "$START_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["upload_id"])')"

echo "upload_id=$UPLOAD_ID parts=$TOTAL_PARTS"

i=0
for part in "$TMP_DIR"/part-*; do
  echo "uploading part $((i+1))/$TOTAL_PARTS"
  curl -fsS -X POST "$BASE_URL/admin/api/kb/chunked/$UPLOAD_ID/part/$i" \
    -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" \
    -H "X-Acting-User: ${ACTING_USER:-duy}" \
    -H "X-Acting-Role: ${ACTING_ROLE:-superadmin}" \
    -F "file=@${part}" >/dev/null
  i=$((i+1))
done

curl -fsS -X POST "$BASE_URL/admin/api/kb/chunked/$UPLOAD_ID/complete" \
  -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" \
  -H "X-Acting-User: ${ACTING_USER:-duy}" \
  -H "X-Acting-Role: ${ACTING_ROLE:-superadmin}"
echo
