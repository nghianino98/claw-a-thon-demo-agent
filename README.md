# Quéo Solution Agent

Runtime-first implementation of the Quéo bot described in `docs/queo-solution/`.

This first build intentionally keeps the agent headless. Configuration is loaded from
environment variables, `config/persona.md`, the SQLite backend, Telegram owner commands,
and `/admin/api/**` endpoints intended to be proxied by Didi with `AGENT_ADMIN_TOKEN`.

## Quick Start

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python -m app.cli migrate
uvicorn app.main:app --reload --host 0.0.0.0 --port 8080
```

Index a KB folder:

```bash
python -m app.cli index-kb --source "/path/to/Wealth Solution" --activate
```

## Knowledge Auto-sync

Local auto-sync is configured with a private env file plus a YAML source map:

- `~/.queo-sync.env`: endpoint, sync key, and local runtime paths. Keep this file `chmod 600`.
- `~/.queo-sync.yaml`: one or more sync sources. Each source can run manually, on an interval, and/or through folder watch events.
- `config/queo-sync.example.yaml`: committed example for adding more sources.

Useful commands:

```bash
# List configured sources
set -a; source ~/.queo-sync.env; set +a
python scripts/queo_sync.py --config ~/.queo-sync.yaml --list-sources

# Manual trigger for one source
python scripts/queo_sync.py --config ~/.queo-sync.yaml --source wealth_knowledge --once

# Dry-run without uploading
python scripts/queo_sync.py --config ~/.queo-sync.yaml --source wealth_knowledge --once --dry-run

# Run watch + interval sources continuously
python scripts/queo_sync.py --config ~/.queo-sync.yaml --serve
```

For a source rooted at `.../05. Knowledge`, set `prefix: 05. Knowledge` so files are uploaded as
`05. Knowledge/<Product>/...` and the agent can classify `area=knowledge` plus the corresponding product.

Chat locally through the core loop:

```bash
python -m app.cli chat
```

## Scope

Included now:

- FastAPI runtime, `/health`, `/invocations`, Telegram webhook/polling.
- Default-deny Telegram access with owner approval commands.
- SQLite WAL state, audit log, memory, settings, skill/workflow registries.
- Hybrid KB tools: FTS5 search, `ripgrep` live scan, read, list.
- Agent loop with native OpenAI tool calls and JSON-action fallback.
- Pre-LLM guardrail for prompt injection, secret requests, unsafe file access, and bypass/exploit intent.
- `/deep` routing and deep-mode step/timeout budgets.
- File/DB backed configuration and headless admin REST API.

Deferred:

- Didi Agent Admin UI.
- Full Didi account/RBAC/vault platform work.
- Model Router, conversation anchors, and full Retrieval v2/deep-mode progress UX.
