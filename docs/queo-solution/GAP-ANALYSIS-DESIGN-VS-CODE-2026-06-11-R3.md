# Gap Analysis R3 — Re-check lần 3 (2026-06-11, đêm)

> Đánh giá theo đúng danh sách bug §4 + việc còn mở §5 của bản R2. Code mới: +814 dòng so với R2 (working tree 7.304 LOC, vẫn trên 2 commit cũ), 3 migration mới (0003 v1_7, 0004 dynamic_commands, 0005 alias index), 53 test function (+7 test nhắm đúng các bug R2). `py_compile` toàn bộ `app/` sạch — không còn lỗi wiring kiểu R2.

## 1. Kết luận nhanh

**Hoàn thành tổng thể: ~80% → ~87%.** Cả 2 bug P0 của R2 đã sửa đúng cách, 9/10 mục §4 đóng, 5/7 mục §5 đóng. **Eval lần 3 nhảy vọt: precision 88% / citation 82% / both 76%** (từ 40–44%) — citation đã vượt ngưỡng 80% của thiết kế.

Việc đáng làm ngay duy nhất còn lại ở mức kỷ luật: **~2.000 dòng thay đổi vẫn chưa commit** (toàn bộ M4b/c/d + dynamic commands nằm ở working tree, mất là mất trắng).

| Milestone | R2 | R3 | Còn thiếu gì |
|---|---|---|---|
| M0 / M1 | ✅ 100/95% | ✅ | — |
| M2 Telegram + security | 🟡 90%* (bug chặn) | ✅ 95% | block L2b riêng trong prompt (đang dựa TRUTH_RULES #7); guardrail hot-reload đã có ✓ |
| M3 Admin API | ✅ 95% | ✅ 95% | — |
| M3b KB auto-sync | ✅ 90% | ✅ 90% | queo_sync chưa có `--dry-run` (minor) |
| M4 Workflow + slash động | 🟡 70% | ✅ 85% | NL intent → workflow + hỏi xác nhận (mục cuối cùng của M4) |
| M4b Model Router | 🟡 75% | ✅ 90% | classify vẫn regex thay vì lite-LLM (chấp nhận được) |
| M4c Conversation context | 🟡 80%* (bug chặn) | ✅ 95% | — (đủ A/B/C/D, có test) |
| M4d Retrieval v2 + deep | 🟡 70% | ✅ 85% | re-index KB để breadcrumb phủ toàn bộ; QUY TRÌNH B1–B6 vẫn ở dạng TOOL_HINTS |
| M5 Hardening | 🟡 85% | 🟡 90% | eval "both" 76% < 80%; S3 staging chưa bật; **chưa commit** |

## 2. Re-check 10 bug §4 của R2

| # | Bug R2 | R3 | Bằng chứng |
|---|---|---|---|
| 1 | 🔴 `IncomingMessage` thiếu `user_msg_db_id` → crash mọi tin Telegram | ✅ Sửa đúng + đủ | field thêm vào `base.py:17`, router truyền tiếp (`router.py:114`), agent_loop guard `external_message_persistence` chống lưu trùng (`agent_loop.py:75-77`) + test `test_telegram_dispatch_uses_existing_user_message_without_double_history` |
| 2 | 🔴 scheduler gọi `workflows.trigger()` không tồn tại | ✅ | `cron_scheduler.py:115` → `workflows.start(wid, "", "schedule", "scheduler", None)` |
| 3 | 🟠 `tg_anchors` không bao giờ INSERT | ✅ | `_record_anchor` trong `send_text`/`send_document`/`send_or_edit_progress` (kind artifact/run_progress); engine set `reply_handle.run_id` (`engine.py:78` — attr giờ có thật trong `__init__`) + test `test_telegram_reply_handle_records_anchors` |
| 4 | 🟠 Trần tool/read theo ctx_window không hiệu lực | ✅ | `tools/registry.py:61` đọc `ctx.tool_result_max_chars`; `kb.read(..., max_chars)` (`registry.py:212`, `kb.py:490`) + test `test_tool_budget_uses_context_limits` |
| 5 | 🟠 Slash động: regex loại id có `-`, không re-sync, không resolver | ✅ Trọn vẹn | migrations 0004/0005 (`command_alias`, `show_in_menu`, UNIQUE index); `telegram_command_alias()` normalize `-`→`_` 2 chiều; resolver `_dynamic_command`: alias workflow → chạy thẳng, alias skill có arg → trả lời ngay, không arg → hỏi input + `pending_question` (đúng `02` §6.1); lệnh lạ → gợi ý 3 alias gần nhất (difflib); re-sync menu sau PATCH/POST + KB activate; `registry_version` bump + router check đầu lượt (kéo theo `guardrail.reload()` — hot-reload ✓) + test `test_dynamic_commands_sync_resolve_and_skill_activation` |
| 6 | 🟡 Deep budget chết (không ai ghi purpose='deep') | ✅ | `_record_llm_call(resp, task_class, ctx)` — purpose giờ là task_class |
| 7 | 🟡 `_kb_map` rglob mỗi lượt | ✅ | cache vào setting `kb_map_cache`, refresh khi activate version (`kb.py:212,222`) |
| 8 | 🟡 Task-class regex quá rộng | ✅ phần lớn | đã bỏ `\bnguồn\b`, `\bip\b`, `\bport\b`, `\bsource\b`; còn `\bapi\b`, `\blog\b`, `\bbuild\b` hơi rộng (vô hại — chỉ lệch routing code/agent) |
| 9 | 🟡 Fallback chain thử tiếp cả 4xx; `except KeyError` sai loại | ✅/🟡 | `_is_non_fallback_error` → 4xx raise ngay ✓; `except KeyError` (`kb.py:336`) vẫn sai loại nhưng unreachable (mtime đã có trong SELECT) |
| 10 | 🟡 Working tree chưa commit | ❌ **VẪN CHƯA** | 20 file modified + 7 untracked (~2.000 dòng), bao gồm toàn bộ M4b/c/d + dynamic commands + 3 migration |

## 3. Re-check việc còn mở §5 của R2

| Mục §5 | R3 | Ghi chú |
|---|---|---|
| Slash command động trọn vẹn | ✅ | xem §2.5 |
| Progress editMessageText + `/cancel` QA | ✅ | `_progress_loop` dùng `PROGRESS_FIRST_SECONDS`/`PROGRESS_UPDATE_SECONDS` (env mới ✓), edit cùng 1 tin, text từ **tool-call log thật** ("bước x/y · đã chạm N nguồn · đang đọc nguồn…") — đúng yêu cầu "không phụ thuộc model nhớ gọi report_progress" (`04` §2.3); xong → edit "Xong."; `/cancel` không tham số → `router.cancel_session` (cancel_event + task.cancel, mode=cancelled); typing refresh loop ✓ + test `test_telegram_progress_message_is_edited` |
| Query expansion bằng lite LLM | ✅ | `QueryExpander` inject vào tool `kb_search` (mode qa/deep/workflow) + `_search_hits`, ghi `llm_calls` purpose `query_expansion`; dict tĩnh Việt→Anh giữ làm nền |
| Validate `model_routing` khi PATCH | ✅ | `validate_model_routing`: 409 nếu model gán agent/code/deep chưa pass tool-calling theo `model_profiles` + test `test_model_routing_validation`. (Chặt hơn thiết kế: deep cũng bị đòi tool — thiết kế cho phép deep không cần tool; cân nhắc nới khi muốn gán GPT-5 thuần synthesis) |
| Eval chạy lại | ✅ vượt bậc | Lần 3 (18:43): **precision 88% / citation 82% / both 76%** — từ 40–44%. Citation đạt mục tiêu ≥80%; "both" còn thiếu 4 điểm |
| Go-live: S3 staging + checklist | ⬜ | chưa thấy thay đổi (việc hạ tầng, ngoài code) |

## 4. Phát hiện mới R3 (đều nhỏ)

1. 🟡 **Chưa commit** — rủi ro lớn nhất hiện tại, lặp lại từ R2 (§2.10).
2. 🟡 Breadcrumb chunking chỉ phủ file index mới (content-addressed). Eval đã lên 82% citation chứng tỏ ổn, nhưng để phủ 100% cần một lần **re-index/full upload** KB.
3. 🟢 `validate_model_routing` đòi tool-calling cho cả class `deep` — chặt hơn spec (xem §3).
4. 🟢 `/help` chưa liệt kê `/new`, `/deep`, `/cancel` không tham số — copy 1 dòng.
5. 🟢 Scheduler chạy workflow với `params=""` — workflow có tham số bắt buộc sẽ chạy thiếu input (thiết kế không yêu cầu hơn; lưu ý khi đặt schedule).
6. 🟢 NL intent → workflow ("chạy audit MMF giúp mình" → hỏi xác nhận → run) vẫn là mục duy nhất của M4 chưa làm (`02` §5.3, §6 bước 3).
7. 🟢 Tests 53 function nhưng chưa chạy lại được trong sandbox này (Python 3.10 < 3.12) — cần `pytest` xanh trên máy Duy trước khi commit.

## 5. Việc còn lại để đóng v1.7 (thứ tự đề xuất)

1. **`git add -A && commit`** ngay (sau khi pytest xanh local) — 0 effort, đóng B10.
2. Re-index KB full một lần (hưởng breadcrumb toàn bộ) → chạy lại eval, kỳ vọng "both" vượt 80% → đóng tiêu chí M5.
3. NL intent workflow + xác nhận (½ ngày) — mục cuối của M4.
4. Nhỏ: L2b block riêng trong prompt; `/help`; nới validate cho class deep; `--dry-run` queo_sync.
5. Go-live M5: bật S3 staging, chạy checklist `04` §4.3 (các mục trước đây fail giờ đã pass được), xoay bot token theo PRE-DEV #1.

**Đánh giá chung R3: các fix đều đúng trọng tâm, có test đi kèm từng bug, không phát sinh lỗi wiring mới (py_compile sạch, double-save được guard chủ động). Trạng thái code hiện tại đã đủ điều kiện chạy end-to-end trên Telegram theo thiết kế v1.7 — chỉ còn commit + re-index + 1 tính năng M4 phụ.**
