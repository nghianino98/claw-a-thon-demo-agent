#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 /path/to/Wealth\\ Solution [output.zip] [--no-media]" >&2
  exit 2
fi

SOURCE="$1"
OUTPUT="${2:-wealth-kb.zip}"
NO_MEDIA="${3:-}"

EXCLUDES=(
  ".git/*" "*/.git/*" ".next/*" "*/.next/*" ".obsidian/*" "*/.obsidian/*"
  ".vscode/*" "*/.vscode/*" ".sixth/*" "*/.sixth/*"
  "*/venv/*" "*/node_modules/*" "*/__pycache__/*"
  ".DS_Store" "*/.DS_Store" "*.sqlite3" "*.pyc"
  "*.env" "*/.env*" "*credentials*" ".greennode.json" "*/.greennode.json"
)

if [[ "$NO_MEDIA" == "--no-media" ]]; then
  EXCLUDES+=("*.svg" "*.png" "*.jpg" "*.jpeg")
fi

cd "$SOURCE"
zip -qr "$OUTPUT" . -x "${EXCLUDES[@]}"
