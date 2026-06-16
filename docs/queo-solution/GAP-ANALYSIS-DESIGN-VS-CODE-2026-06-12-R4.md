# Gap Analysis R4 — Re-check lần 4 (2026-06-12)

> Đánh giá theo danh sách "việc còn lại" §5 của bản R3. Code mới: 2 commit (`1f4fefc` Complete v1.7 runtime hardening — chốt toàn bộ phần R3; `028f76d` Improve KB retrieval exact lookup quality, +626 dòng), working tree **sạch**. 8.007 LOC app, 57 test function, `py_compile` sạch.

## 1. Kết luận nhanh

**Hoàn thành tổng thể: ~87% → ~91%.** Toàn bộ mục code trong danh sách R3 đã đóng, kể cả mục khó nhất (NL intent → workflow + xác nhận). Đã re-index KB (active v8) sau breadcrumb fix. **Mọi mục đều có test đi kèm** — kỷ luật giữ tốt qua 3 vòng liên tiếp.

Sự kiện đáng chú ý nhất của vòng này là **sự cố eval lần 4** (46/48/34, tụt từ 88/82/76): notes ghi đúng nguyên nhân — `model_routing` trong DB local trỏ model Qwen id cũ đã bị MaaS gỡ → provider 404 hàng loạt → run chỉ mang tính chẩn đoán, không so sánh được. Sự cố này **phơi ra một lỗ hổng thiết kế-vs-code thật** (xem §4): `_is_non_fallback_error` đang coi **404 và 429 là lỗi không-fallback** → fallback chain không cứu được đúng tình huống mà ADR-11 sinh ra nó để cứu ("model BETA đổi thường xuyên, bị gỡ đột ngột"). Riêng 429: thiết kế `02` §7.1 ghi rõ *"model lỗi (timeout/5xx/**429** sau retry) → thử model kế trong chain"* — code đang làm ngược.

| Milestone | R3 | R4 | Còn lại |
|---|---|---|---|
| M0 / M1 | ✅ | ✅ 100/95% | — |
| M2 Telegram + security | ✅ 95% | ✅ 97% | — (L2b block riêng ✓) |
| M3 Admin API | ✅ 95% | ✅ 95% | — |
| M3b KB auto-sync | ✅ 90% | ✅ 92% | `--dry-run` ✓; còn thiếu launchd auto-cài đặt thực tế (việc vận hành) |
| M4 Workflow + slash động | ✅ 85% | ✅ **95%** | NL intent + xác nhận ✓ — M4 coi như đủ scope thiết kế |
| M4b Model Router | ✅ 90% | ✅ 93% | validate đúng spec (agent/code mới đòi tool) ✓; còn lỗ hổng fallback 404/429 (§4) |
| M4c Conversation context | ✅ 95% | ✅ 95% | — |
| M4d Retrieval v2 + deep | ✅ 85% | ✅ 92% | re-index ✓ + exact-lookup mới ✓; eval full chính thức chưa chạy lại |
| M5 Hardening | 🟡 90% | 🟡 90% | **eval full 50 câu với routing đúng** + S3 staging + checklist go-live |

## 2. Re-check danh sách §5 của R3

| Mục R3 | R4 | Bằng chứng |
|---|---|---|
| 1. Commit working tree | ✅ | 2 commit mới, `git status` sạch — B10 đóng sau 2 vòng nhắc |
| 2. Re-index KB + eval lại | ✅/🟡 | Re-index xong (active **v8**, notes 2026-06-12). Eval full lần 4 không tính được (sự cố routing §4); **targeted q07–q16: 90% precision / 100% recall / 90% success**; q14–q16 rerun pass 100%. Còn nợ: **một lần full-run 50 câu** với routing đúng để có số chính thức thay cho 88/82/76 |
| 3. NL intent → workflow + xác nhận | ✅ Trọn vẹn | `router.py:100-303`: gate heuristic `_looks_workflow_request` (rẻ) → lite LLM classify JSON `{intent, workflow_id, params}` (temp 0, purpose `workflow_intent`) → heuristic fallback → lưu pending typed JSON vào `session_state.pending_question` → hỏi "Có/Không" → Có: start + `last_run_id` + audit; Không: hủy; trả lời khác: hỏi lại. Đúng `02` §5.3 + §6 bước 2 + hợp nhất pending về session_state (§8.1-B). Test `test_router_nl_workflow_intent_requires_confirmation_and_starts` |
| 4a. L2b block riêng | ✅ | `prompts.py:100` `[L2b] GUARDRAIL` hardcode `GUARDRAIL_RULES` — đủ 2 lớp defense-in-depth như `02` §2.2 |
| 4b. `/help` | ✅ | liệt kê đủ `/deep`, `/cancel [run_id]`, `/new` + hướng dẫn reply-để-hỏi-tiếp và alias menu (đúng gợi ý `04` §2.3) |
| 4c. Nới validate class `deep` | ✅ | `tool_tasks = {"agent", "code"}` — deep được phép route model synthesis-only, đúng `02` §7.1 |
| 4d. `--dry-run` queo_sync | ✅ | `queo_sync.py:214` in delta không upload |
| 5. Go-live: S3 + checklist + xoay token | ⬜ | chưa — việc hạ tầng/vận hành, không phải code |

## 3. Điểm mới ngoài danh sách (commit `028f76d`) — đánh giá TỐT

Phản ứng đúng giao thức chẩn đoán M4d (`03` §4.0b): chạy targeted eval → gắn nguyên nhân → fix đúng tầng retrieval:

- **Exact lookup cho định danh** (transID, mã ISSUE): bắt định danh trong query → tra trực tiếp; **miss → trả "chưa có dữ liệu, đừng suy đoán"** — đây là cải tiến chống-bịa đúng tinh thần TRUTH-mode #4, xử lý đúng ca q15.
- `kb_search` tự augment bằng grep khi query chứa mã issue (`test_kb_search_augments_exact_issue_lookup_with_grep`).
- **Path-hint ranking**: boost theo pattern đường dẫn suy từ query + intent sản phẩm/khu vực (`_path_hint_sql`, `_path_score_adjustment`, test `test_search_async_intent_path_boosts`).
- `run_eval.py` thêm `--questions/--from-id/--limit/--no-append/--output` — chạy targeted + xuất JSON chi tiết, đúng hạ tầng cần cho giao thức gắn nhãn lỗi.

## 4. Phát hiện mới R4 — lỗ hổng fallback chain (nên sửa trước go-live)

**Hiện tượng gốc (từ sự cố eval 4):** routing trỏ model đã bị gỡ → provider trả **404** → `_is_non_fallback_error` (`llm.py:247`) coi 404 là non-fallback → **raise ngay, không thử model kế trong `fallback_chain`** → hàng loạt câu fail dù chain có model sống.

| # | Mức | Vấn đề | Đề xuất |
|---|---|---|---|
| 1 | 🟠 P1 | **404 (model not found) bị coi là non-fallback.** Đây chính là tình huống ADR-11 nêu ("model BETA đổi version/ngừng đột ngột") — fallback chain phải cứu được | Cho 404 fallback-able (giữ 400/401/403/422 non-fallback) |
| 2 | 🟠 P1 | **429 bị coi là non-fallback** — ngược thiết kế `02` §7.1: "timeout/5xx/**429** sau retry → thử model kế" (`_chat_single` đã retry 429 nội bộ; hết retry thì phải sang model kế) | Bỏ 429 khỏi danh sách non-fallback |
| 3 | 🟡 P2 | Match mã lỗi bằng substring trên message ("404" có thể xuất hiện ngẫu nhiên trong detail) | Truyền status code có cấu trúc (exception attribute) thay vì parse chuỗi |
| 4 | 🟡 P2 | Routing stale trong DB chỉ được validate lúc PATCH — model bị gỡ sau đó không ai phát hiện đến khi user chạm | Cảnh báo chủ động: resolve_model gặp 404 → audit `model_routing_stale` + (tùy chọn) tự rơi về `LLM_MODEL` env cho lượt đó |
| 5 | 🟢 nhỏ | Khi đang pending xác nhận workflow, user hỏi một câu khác hẳn → bot lặp "Bạn xác nhận giúp mình: Có/Không" thay vì xử lý câu mới (kẹt vòng xác nhận đến khi nói "không") | Coi tin nhắn không-phải-xác-nhận dài/khác chủ đề là "Không" ngầm rồi xử lý tiếp câu hỏi |

## 5. Việc còn lại để đóng v1.7

1. **Sửa fallback 404/429** (§4.1–4.2 — vài dòng, có sự cố thật chứng minh) + chạy lại **eval full 50 câu** với routing đúng → con số chính thức thay cho 88/82/76. Đây là 2 việc chặn "đạt M5".
2. Go-live M5 (việc vận hành, ngoài code): bật `S3_*` staging → verify redeploy restore; chạy checklist `04` §4.3 mục 1–7; regenerate bot token (PRE-DEV #1); cài queo_sync launchd trên máy thật.
3. Tùy chọn nhỏ: §4.3–4.5; pytest xanh trên máy Duy trước mỗi commit (sandbox này không chạy được — Python 3.10).

**Đánh giá chung R4: chất lượng vòng này tốt — mọi mục R3 đóng có test, sự cố eval được ghi nhận trung thực kèm root cause, và cải tiến exact-lookup đi đúng giao thức chẩn đoán thay vì sửa mò. Codebase hiện bám sát thiết kế v1.7 ở mức ~91%; phần còn lại chủ yếu là vận hành (S3, token, launchd) + 1 fix fallback nhỏ + 1 lần eval chính thức.**
