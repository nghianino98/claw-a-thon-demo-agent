# Implementation Notes

## 2026-06-10

- Scope adjusted per product discussion: build the Quéo bot runtime first, defer the admin dashboard.
- Admin-facing configuration is currently represented by `.env`, `config/persona.md`, SQLite settings, and Telegram owner commands.
- The service/API boundaries follow the approved docs so a future admin UI can call the same backend services.
- Model probing is not completed yet. Fill `LLM_MODEL`, `LLM_MODEL_LITE`, `TOOLCALL_MODE`, and `CONTEXT_BUDGET_CHARS` after running `scripts/probe_model.py`.

## 2026-06-11

- Wealth Solution KB path confirmed: `/Users/lap16947/Library/CloudStorage/GoogleDrive-nguyenquangduy0211@gmail.com/My Drive/GOOGLE DRIVE/01. My Work/02. ZALOPAY/02. ZaloPay PO/02. Product/ZLP Workspace/Wealth Solution`.
- Local scan after exclusions: 53,217 files, 30,344 text-indexable files, about 2.63GB total file bytes, 26 `SKILL.md` files, 12 workflow markdown files.
- Model probe using the demo `.env` passed native tool calling, JSON mode, and Vietnamese response checks. Use `TOOLCALL_MODE=native` unless a later MaaS model change requires JSON mode.
- Deploy safety update: removed app bootstrapping from bundled `bootstrap/queo.sqlite3` and `bootstrap/wealth_kb.zip`; Docker/git ignore now excludes `bootstrap/`, `*.zip`, and SQLite files. First deploy should restore state from S3 or upload/sync KB after runtime creation.
- Admin API auth update: replaced `ADMIN_API_KEY`/`X-Admin-Api-Key` with `AGENT_ADMIN_TOKEN` Bearer auth plus `X-Acting-User` and `X-Acting-Role`; read routes accept viewer+, content/KB/run mutations require operator+, backup/settings mutations require superadmin.
- Guardrail update: added deterministic pre-LLM guardrail with built-in patterns plus `config/guardrail.yaml`. Blocks prompt injection, secret requests, unsafe file reads, and bypass/exploit intent before LLM/tool use; audit stores category + prompt hash only.
- QA path update: business Q&A with LLM now uses the agentic native/JSON tool loop instead of one-shot retrieval. One-shot retrieval helpers remain as fallback support.
- Staging deploy finding: runtime without S3 loses KB state across image updates/restarts, so production should not go live until `S3_*` is configured and redeploy restore is verified.
- SQLite lock resilience: rate-limit, audit, memory side effects, and LLM call metrics now retry short locks and fail soft where safe, after staging exposed `database is locked` during/after large KB ingestion.
- Deep mode foundation: `/deep <question>` and "tìm kỹ/check kỹ/nghiên cứu sâu" route to `mode=deep`, using `AGENT_DEEP_MAX_STEPS` and `AGENT_DEEP_TIMEOUT_SECONDS`.
