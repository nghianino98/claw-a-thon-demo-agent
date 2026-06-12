# Gap Analysis R2 — Re-check sau đợt code mới (2026-06-11, tối)

> Đánh giá lại theo đúng danh sách của `GAP-ANALYSIS-DESIGN-VS-CODE-2026-06-11.md` (R1). Code mới = commit `688f502` (Phase 1 Quick Fixes + Didi Admin API) + ~1.140 dòng working-tree chưa commit (M4b/M4c/M4d/scheduler/eval). Mỗi mục ghi trạng thái R1 → R2 kèm bằng chứng.

## 1. Kết luận nhanh

**Hoàn thành tổng thể: ~57% → ~80%.** Gần như toàn bộ gap list R1 đã được code: CRUD skills/workflows, scheduler cron, Model Router, conversation context, search v2 + RRF + breadcrumb, KB MAP, queo_sync client, eval 50 câu (đã chạy 2 lần, có baseline).

**NHƯNG có 2 bug P0 mới làm 2 luồng chính không chạy được** (đều là lỗi wiring nhỏ, sửa ~5 dòng):

1. 🔴 **Mọi tin nhắn Telegram thường sẽ crash.** `adapter.py:259` truyền `user_msg_db_id=` vào `IncomingMessage`, nhưng dataclass `channels/base.py` **không có field này** → `TypeError` trên mọi message không phải lệnh (đã reproduce). Exception nằm trong asyncio task → bot **im lặng hoàn toàn**. Eval không phát hiện vì `run_eval.py` gọi thẳng router, không qua adapter. Sửa kèm: router cũng phải truyền `user_msg_db_id` vào `AgentContext`, nếu không `agent_loop.py:74` sẽ lưu user message **lần thứ hai** (adapter đã lưu) → history trùng đôi.
2. 🔴 **Scheduled workflow luôn fail.** `cron_scheduler.py:117` gọi `self.workflows.trigger(...)` — `WorkflowEngine` **không có method `trigger`** (chỉ có `start`) → AttributeError mỗi lần đến giờ chạy. Test `test_cron_scheduler_triggers` không bắt được vì engine là `MagicMock` và chỉ test `_reload_schedules`.

Khuyến nghị: sửa 2 bug trên + commit working tree (1.140 dòng chưa commit là rủi ro mất code) trước khi làm gì khác.

## 2. Trạng thái theo milestone (R1 → R2)

| Milestone | R1 | R2 | Ghi chú |
|---|---|---|---|
| M0 Skeleton | ✅ 95% | ✅ 100% | git ✓ (2 commit, secrets sạch), persona migrations đã gộp về 0002 (A2 ✓) |
| M1 KB + Agent core | ✅ 95% | ✅ 95% | không đổi |
| M2 Telegram + security | 🟡 80% | 🟡 90%* | rate limit ✓, `/new` ✓ — *nhưng bug P0-1 đang chặn cả luồng chat |
| M3 Admin API | 🟡 85% | ✅ 95% | PATCH/POST skills + workflows ✓ (+test) → **đã mở khóa Didi D3** |
| M3b KB auto-sync | 🟡 60% | ✅ 90% | `queo_sync.py` ✓ (--once/--watch, excludes đủ `.env/credentials/sqlite3`) + launchd plist ✓; chống xóa >30% ✓ (+test); import `log_event` ✓ |
| M4 Workflow + slash động | 🟡 50% | 🟡 70% | scheduler có nhưng bug P0-2; synthesis cuối bằng deep model ✓; setMyCommands ✓ một phần; **alias resolver vẫn chưa có** |
| M4b Model Router | ❌ 5% | 🟡 75% | profile_models.py (test A–F) ✓, `model_profiles` ✓, resolve theo class ✓, fallback chain ✓; deep budget có code nhưng **không bao giờ kích hoạt** (xem §4) |
| M4c Conversation context | ❌ 10% | 🟡 80%* | đủ cả 4 cơ chế A/B/C/D — *bị bug P0-1 chặn toàn bộ; `tg_anchors` không bao giờ được ghi |
| M4d Retrieval v2 + deep | 🟡 35% | 🟡 70% | search v2 phrase→AND→OR + RRF ✓, stopwords ✓, recency ✓, breadcrumb chunking ✓, KB MAP ✓, budget scale ✓ — nhưng nâng trần tool/read **chưa có hiệu lực** (xem §4); progress edit + /cancel QA vẫn chưa |
| M5 Hardening | 🟡 70% | 🟡 85% | artifact cleanup loop ✓; **eval 50 câu đã chạy 2 lần** — success 40–44%, citation 68–70% (mục tiêu thiết kế: ≥80%) |

## 3. Chi tiết re-check theo gap list R1

### 3.1. Nhóm "vá ngay" (R1 §7.1) — 5/5 ĐÃ LÀM ✅

| Gap R1 | R2 | Bằng chứng |
|---|---|---|
| git init + push | ✅ | `.git` ✓, 2 commit, `git ls-files` không dính `.env*`/sqlite/zip |
| import `log_event` kb.py | ✅ | `kb.py:20` |
| Rate limit Telegram | ✅ | `adapter.py:152-155` check + audit + câu trả lời tĩnh |
| Chống xóa >30% | ✅ | `kb.py:810` (kèm điều kiện `active_count > 10` hợp lý) + test `test_kb_delta_deletion_threshold` |
| A2 persona migrations | ✅ | 0003–0009 đã xóa, nội dung gộp vào `0002_seed.sql` |

### 3.2. Mở khóa Didi D3 (R1 §7.2) — ĐÃ LÀM ✅

`POST/PATCH /admin/api/skills`, `POST/PATCH /admin/api/workflows` (main.py:381-487): validate id, 409 trùng, partial update qua `model_dump(exclude_unset)`, audit đủ, `list_all()` cho admin xem cả disabled. Có test `test_admin_skills_and_workflows`. Field names từ Pydantic model nên không có SQL injection. **Đạt.**

### 3.3. M4 — scheduler + slash động

- **Scheduler cron**: `cron_scheduler.py` mới — tick 15s, `croniter`, reload schedule từ DB mỗi vòng (= hot-reload schedule ✓), notify owner + gửi artifact qua Telegram khi xong. **Nhưng bug P0-2** (`workflows.trigger` không tồn tại) → mọi lần trigger đều fail. Sửa: đổi thành `await self.workflows.start(workflow_id, "", "schedule", "scheduler", None)`.
- **setMyCommands**: `adapter.sync_commands()` ✓ gọi lúc startup. 3 hạn chế: (a) regex `^[a-z0-9_]{1,32}$` **loại mọi id chứa `-`** — hầu hết workflow KB (`cs-ticket-report`, `product-audit`, `morning-briefing`…) sẽ KHÔNG vào menu; thiết kế yêu cầu normalize `-`→`_` (`02` §6.1); (b) không re-sync sau khi PATCH/POST skills/workflows (chỉ chạy lúc boot); (c) dùng thẳng `workflow_id`/`skill_id` thay vì cột `command_alias` (DDL vẫn chưa có 2 cột `command_alias`/`show_in_menu`).
- **Resolver lệnh động**: ❌ vẫn chưa có — `_command()` không nhận diện alias; user gõ `/product-audit` (hoặc bấm lệnh trong menu) → rơi xuống LLM như text thường. Menu đăng ký lệnh mà không xử lý lệnh = trải nghiệm gãy.
- **Synthesis cuối**: ✅ `engine._write_report` giờ gọi model `deep` tổng hợp theo `spec.system`, fallback ghép cơ học khi lỗi, ghi `llm_calls` purpose `workflow_synthesis`. Đúng `02` §5.2.
- NL intent → workflow + xác nhận: ❌ vẫn chưa (router không có nhánh workflow).

### 3.4. M4b — Model Router

✅ Đã có: `scripts/profile_models.py` probe đủ 6 trục (native/json/vn/long-ctx/code/latency) ghi `model_profiles`; `LLMClient.resolve_model(task_class)` đọc `model_routing` từ settings (hot — đọc DB mỗi call); fallback chain trong `chat()`; `llm_calls.model` ghi model thực dùng ✓; Router gán task_class (lite/agent/code/deep); một lượt loop dùng một model xuyên suốt ✓.

Lệch còn lại: (a) classify bằng **regex** thay vì lite LLM — chấp nhận được, nhưng pattern quá rộng (`\bnguồn\b`, `\bip\b`, `\bsource\b` → rất nhiều câu tiếng Việt thường bị gắn `code`); (b) **deep budget không bao giờ kích hoạt**: `resolve_model` đếm `llm_calls WHERE purpose='deep'` nhưng không chỗ nào ghi purpose `'deep'` (agent ghi `'agent'`, synthesis ghi `'workflow_synthesis'`) → COUNT luôn = 0; (c) chưa validate `model_routing` khi PATCH settings (thiết kế: 409 nếu model không pass tool-calling); (d) fallback chain thử model kế cả với lỗi 4xx (thiết kế: 4xx raise ngay).

### 3.5. M4c — Conversation context

✅ Đã code đủ 4 cơ chế: migration `0003_v1_7_schema` (session_state, tg_anchors, 2 cột messages); `get/save_session_state`; history theo segment; rolling summary (lite, ngưỡng >6 tin, merge summary cũ, ≤1500 chars, lưu con trỏ); `/new`; auto-segment idle 6h; reply/quote → `[L4b] REPLY CONTEXT` (ưu tiên quote.text, tra `tg_anchors` + `messages`); `tg_message_id` lưu 2 chiều; L5b/L5c vào prompt.

❌ Nhưng thực tế trên Telegram = **0%** cho tới khi sửa bug P0-1 (TypeError chặn mọi message). Thêm: `tg_anchors` **chỉ được SELECT và DELETE, không nơi nào INSERT** → reply vào file báo cáo/progress không bao giờ có ngữ cảnh run (nhánh enrichment là dead code; `hasattr(reply_handle, "run_id")` trong engine cũng vô tác dụng vì handle không có attr đó và không ai ghi anchor khi `send_document`).

### 3.6. M4d — Retrieval v2 + deep mode

| Mục | R2 | Ghi chú |
|---|---|---|
| Phrase→AND→OR + RRF | ✅ | `search_async`: 3 query chạy song song `asyncio.to_thread`, RRF k=60. Khác thiết kế (chạy cả 3 thay vì dừng ở bậc đầu ≥3 hit) — chấp nhận được, tốn hơn chút |
| Stopwords VN+EN | ✅ | `_compile_fts_queries` |
| Query expansion | 🟡 | vẫn dict tĩnh Việt→Anh; chưa có expansion bằng lite LLM |
| Recency decay | ✅ | theo `m.mtime` (đã SELECT trong SQL — kiểm tra ✓ không crash; lưu ý `except KeyError` sai loại — sqlite3.Row ném IndexError — hiện vô hại) |
| Group-by-file | ✅ | tối đa 2 chunk/file |
| Chunking breadcrumb | ✅ | `[Breadcrumb: file > H1 > H2 > H3]` — **chỉ áp dụng cho file index MỚI** (chunk store content-addressed): KB hiện tại phải re-index/full upload lại mới hưởng |
| KB MAP (L3b) | ✅ | `prompts._kb_map()` — dạng listing ≤200 entries ưu tiên 05/01. ⚠️ Không cache, `rglob` toàn cây **mỗi lượt chat** — trên KB thật 53k file sẽ chậm rõ; thiết kế yêu cầu sinh khi activate + cache. Chưa kèm khối "nguồn nào cho việc gì" |
| Context budget theo ctx_window | ✅/🟡 | `_compact` dùng budget theo `model_profiles.ctx_window` ✓. **Nhưng** `ctx.tool_result_max_chars=24000` / `ctx.kb_read_max_chars=40000` được set rồi **không ai đọc**: `ToolRegistry.execute` và `kb.read` vẫn cắt theo `settings` (8000/12000) → mục tiêu "agent đọc được nhiều hơn" (T2c) chưa có hiệu lực thực |
| Progress editMessageText + /cancel QA | ❌ | chưa có (grep editMessageText = 0); deep 7 phút vẫn không có tiến độ |
| Bước 0 chẩn đoán 10 câu | 🟡 | thay bằng eval 50 câu chạy 2 lần (tinh thần tương đương, chưa gắn nhãn lỗi theo RETRIEVAL_MISS/READ_MISS…) |

### 3.7. M5

- ✅ `artifact_cleanup_loop` theo `ARTIFACT_RETENTION_DAYS` (xóa thư mục + runs cũ + tg_anchors).
- ✅ Eval: `tests/eval/questions.yaml` 50 câu thật + `scripts/run_eval.py` chấm must_contain + citation. **Đã chạy 2 lần** (IMPLEMENTATION_NOTES): precision 60–70%, citation recall 68–70%, both 40–44% → **dưới ngưỡng 80%** của thiết kế nhưng đã có baseline đo được — đúng hướng.
- Còn lại như R1: S3 staging chưa bật (điều kiện go-live), guardrail config chưa hot-reload.

## 4. Bug & wiring gap phát hiện trong R2 (theo độ ưu tiên)

| # | Mức | Vấn đề | Sửa |
|---|---|---|---|
| 1 | 🔴 P0 | `IncomingMessage` không có field `user_msg_db_id` → TypeError mọi tin Telegram thường (adapter.py:259) | Thêm field vào `channels/base.py` + router truyền tiếp vào `AgentContext` (tránh lưu message trùng 2 lần) |
| 2 | 🔴 P0 | `cron_scheduler` gọi `workflows.trigger()` không tồn tại → scheduled run luôn fail | Đổi sang `workflows.start(wid, "", "schedule", "scheduler", None)` |
| 3 | 🟠 P1 | `tg_anchors` không bao giờ INSERT → reply-vào-artifact/run không có ngữ cảnh (dead code 2 phía) | Ghi anchor trong `send_document`/progress của run (handle đã trả message_id) |
| 4 | 🟠 P1 | Nâng trần `tool_result/kb_read` theo ctx_window không hiệu lực (tools/kb đọc settings, không đọc ctx) | Truyền ctx vào `ToolRegistry.execute`/`kb.read` hoặc set qua settings runtime |
| 5 | 🟠 P1 | sync_commands: regex loại id có `-` → menu gần như chỉ còn start/whoami/new; không re-sync sau mutation; chưa có resolver `/alias` | Normalize `-`→`_` 2 chiều như `02` §6.1 + gọi sync sau PATCH/POST + thêm nhánh resolve trong `_command` |
| 6 | 🟡 P2 | Deep budget chết: đếm `purpose='deep'` nhưng không ai ghi purpose đó | Ghi `purpose=task_class` trong `_record_llm_call` |
| 7 | 🟡 P2 | `_kb_map()` rglob mỗi lượt — latency lớn trên KB 53k file | Cache khi activate version (như thiết kế L3b) |
| 8 | 🟡 P2 | Task-class regex quá rộng (`\bnguồn\b`, `\bip\b`…) → câu thường thành `code` | Thu hẹp pattern hoặc dùng lite LLM như thiết kế |
| 9 | 🟡 P2 | Fallback chain thử tiếp cả khi 4xx; `except KeyError` sai loại cho sqlite Row | 4xx raise ngay; đổi IndexError |
| 10 | 🟡 P2 | 1.140 dòng (toàn bộ M4b/c/d) **chưa commit** | Commit ngay sau khi sửa bug 1–2 |

## 5. Việc còn mở so với thiết kế v1.7 (sau R2)

1. Sửa bug §4.1–4.5 (≈ ½ ngày) — khi đó M2/M4c mới "chạy được" đúng nghĩa.
2. Slash command động trọn vẹn: cột `command_alias`/`show_in_menu` + resolver + normalize + re-sync menu (`02` §6.1–6.2) — phần duy nhất của yêu cầu "/monthly-report-generate" còn thiếu.
3. Progress editMessageText + `/cancel` lượt QA (`04` §2.3) — deep mode đang "câm" suốt 7 phút.
4. Query expansion bằng lite LLM + re-index KB để breadcrumb có hiệu lực toàn bộ.
5. Validate `model_routing` khi PATCH (409) + lite-LLM classify.
6. Eval đang 40–44% → chạy lại sau khi sửa bug 4 (trần đọc) + re-index breadcrumb, gắn nhãn lỗi theo giao thức `03` §4.0b để biết fix tiếp cái gì.
7. Go-live M5: bật S3 staging, chạy lại checklist `04` §4.3 (mục rate-limit giờ đã pass được).
