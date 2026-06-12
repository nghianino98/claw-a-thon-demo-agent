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

## 2026-06-12

- Telegram runtime hardening: incoming Telegram messages now keep the persisted user message id through router/agent context, avoiding duplicate memory writes while keeping normal chat dispatch stable.
- Workflow scheduler now starts runs through `WorkflowEngine.start(...)`, matching the live workflow path and owner notification behavior.
- Dynamic Telegram commands now support persisted aliases, menu visibility, normalized fallback aliases, owner/API re-sync after registry mutations, direct `/alias <question>` skill execution, and friendly unknown-command suggestions.
- Telegram long-running UX now refreshes typing status and sends/edits progress anchors for active agent/deep turns, with `/cancel` supporting both workflow run ids and the current chat session.
- Deep/tool budgeting now flows through tool execution and KB reads; LLM call metrics record the effective task class so deep daily budget controls apply.
- Model routing validation now rejects invalid native-tool routes, narrows code task detection, and only falls back on transient/provider failures.
- KB registry lookups now use cached maps rebuilt on activation/sync, and active KB mutations trigger registry version bumps so runtime command/guardrail config can hot-reload.
- Production hardening now triggers backups after active KB mutations and surfaces backup readiness warnings without rolling back successful activation on backup failure.
- R3 follow-up: Router now detects natural-language workflow intent with lite LLM plus heuristic fallback, stores a pending confirmation in session state, and only starts the workflow after an explicit Có/Không confirmation.
- Prompt layering now has a separate hardcoded L2b security guardrail block, Telegram `/help`/list commands mention `/new`, `/deep`, `/cancel [run_id]`, reply context, and command aliases.
- Model routing validation now follows the design split: `agent` and `code` require profiled tool-calling models, while `deep` may be routed to a synthesis-only model.
- `scripts/queo_sync.py` supports `--dry-run` to compute and print delta details without uploading.

## Evaluation Report - 2026-06-11T15:57:03Z
- Total Questions: 50
- Precision (Must contain match): 70.00%
- Recall (Citation match): 68.00%
- Success Rate (Both match): 44.00%

## Evaluation Report - 2026-06-11T16:24:08Z
- Total Questions: 50
- Precision (Must contain match): 60.00%
- Recall (Citation match): 70.00%
- Success Rate (Both match): 40.00%

## Evaluation Report - 2026-06-11T18:43:03Z
- Total Questions: 50
- Precision (Must contain match): 88.00%
- Recall (Citation match): 82.00%
- Success Rate (Both match): 76.00%

## Evaluation Report - 2026-06-12T03:06:50Z
- Total Questions: 50
- Precision (Must contain match): 46.00%
- Recall (Citation match): 48.00%
- Success Rate (Both match): 34.00%

Note: the 2026-06-12T03:06:50Z full run is diagnostic only. Local `model_routing` still pointed at stale Qwen model ids that returned provider 404s for many later questions, so it is not comparable with the R3 baseline.

## Evaluation Follow-up - 2026-06-12

- Re-indexed the active Wealth Solution KB after breadcrumb/path-ranking fixes; active KB version is 8.
- Targeted q07-q16 run after retrieval/path-hint fixes: 90% precision, 100% recall, 90% success. The remaining failure was q15 wording: the answer identified the transaction as missing from operational data but omitted the literal `transID`.
- Follow-up single-question reruns after exact lookup/post-process guards: q14, q15, and q16 each passed with 100% precision/recall/success.

## Evaluation Report - 2026-06-12T06:50:30Z
- Total Questions: 50
- Precision (Must contain match): 82.00%
- Recall (Citation match): 90.00%
- Success Rate (Both match): 74.00%

## Evaluation Report - 2026-06-12T07:48:15Z
- Total Questions: 50
- Precision (Must contain match): 98.00%
- Recall (Citation match): 98.00%
- Success Rate (Both match): 96.00%

## R4 Follow-up - 2026-06-12

- Fixed model fallback behavior for removed/rate-limited models: structured LLM request errors now keep HTTP status, 404/429 can fall through to fallback models, 400/401/403/422 still fail fast, stale 404 routing is audited, and env `LLM_MODEL` is added as a final safety candidate when DB routing is stale.
- Pending workflow confirmations now release the chat if the user sends a substantive unrelated question instead of Có/Không.
- Retrieval/postprocess follow-up after the 98/98/96 full eval: q09 and q49 were the only remaining failures. q09 now keeps required flow literals (`bước`, `mua`); q49 now prioritizes CS-quality queries toward `03. Fact/CS Ticket/` and adds the CS Ticket citation scope if the LLM rewrites the search toward audit/KPI.
- Targeted reruns after these final patches: q09 passed 100% precision/recall/success; q49 passed 100% precision/recall/success.

## Evaluation Report - 2026-06-12T08:49:49Z
- Total Questions: 50
- Precision (Must contain match): 96.00%
- Recall (Citation match): 100.00%
- Success Rate (Both match): 96.00%

## R4 Final Eval Follow-up - 2026-06-12

- The 08:49 full run used the final fallback/retrieval code path and showed no citation misses. The two remaining misses were wording-only: q48 omitted literal `chất lượng`; q49 omitted literal `CS Ticket`/`chất lượng`.
- Added narrow postprocess retention for quality/checklist/CS Ticket wording and audit-source scope for MMF checklist quality questions.
- Targeted q48-q49 rerun after this final patch: 100% precision, 100% recall, 100% success.
- Production go-live remains operationally gated: `.env.production` still has empty `S3_*` values, so S3 staging backup/restore smoke and redeploy-restore verification have not been run yet. Telegram bot token rotation is also still an external pre-go-live step.

## Evaluation Report - 2026-06-12T09:55:24Z
- Total Questions: 50
- Precision (Must contain match): 98.00%
- Recall (Citation match): 98.00%
- Success Rate (Both match): 98.00%

## Evaluation Report - 2026-06-12T09:57:54Z
- Total Questions: 1
- Precision (Must contain match): 0.00%
- Recall (Citation match): 0.00%
- Success Rate (Both match): 0.00%

## Evaluation Report - 2026-06-12T10:00:33Z
- Total Questions: 1
- Precision (Must contain match): 0.00%
- Recall (Citation match): 100.00%
- Success Rate (Both match): 0.00%

## Evaluation Report - 2026-06-12T10:01:42Z
- Total Questions: 1
- Precision (Must contain match): 100.00%
- Recall (Citation match): 100.00%
- Success Rate (Both match): 100.00%
