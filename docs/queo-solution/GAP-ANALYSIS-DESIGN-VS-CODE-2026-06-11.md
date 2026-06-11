# Gap Analysis: Thiết kế v1.7 vs Source code thực tế — 2026-06-11

> Phạm vi: đối chiếu toàn bộ `docs/queo-solution/` (v1.7) với code `queo-solution-agent` (5.167 LOC Python, 42 test function). Mỗi đầu mục: **thiết kế yêu cầu gì → code làm đến đâu → đạt/không đạt + lý do**, kèm bằng chứng `file:dòng`.
>
> Lưu ý: review trước (`CODE-REVIEW-QUEO-AGENT-2026-06-11.md`) chấm theo docs v1.3; bản này chấm theo **v1.7** và phản ánh các fix đã làm sau review đó (P0-1, P0-2, P1-1, P1-3, P1-4, P1-6 → đã sửa).

## 1. Kết luận nhanh

**Mức hoàn thành tổng thể ≈ 55–60%** (trọng số theo ngày công thiết kế ở `05` §7).

- **Lõi M0→M3b làm tốt (~85%)**: agent loop 2 chế độ, 9 tool, KB pipeline content-addressed full+delta, Telegram default-deny, admin API headless đúng ADR-2 v3, backup S3 đầy đủ.
- **Cụm tính năng v1.1–v1.7 là khoảng trống chính**: Model Router (M4b) ❌, Conversation Context (M4c) ❌, Retrieval v2 + KB MAP (M4d) phần lớn ❌, slash command động + scheduler (M4) ❌. Đây đúng là các mục Duy bổ sung 2026-06-11 để thu hẹp quality gap với Cowork — **chưa được code**.
- **2 vi phạm acceptance đáng chú ý**: Telegram **không có rate limit** (acceptance M2 ghi rõ "rate limit hoạt động") và **repo chưa có git** (P0-3 còn nguyên).

| Milestone | Thiết kế (ngày) | Hoàn thành | Đánh giá |
|---|---|---|---|
| M0 Skeleton & nền móng | 0,5 | ~95% | ✅ Đạt |
| M1 KB + Agent core + probe | 1,5 | ~95% | ✅ Đạt |
| M2 Telegram + security + guardrail | 1 | ~80% | 🟡 Đạt một phần |
| M3 Admin API headless | 1 | ~85% | 🟡 Đạt một phần |
| M3b KB auto-sync | 1 | ~60% | 🟡 Server đạt, client chưa có |
| M4 Workflow + scheduler + slash động | 1,5 | ~50% | 🟡 Engine đạt, phần "động" chưa có |
| M4b Model Router | 0,5–1 | ~5% | ❌ Không đạt |
| M4c Conversation context | 0,5–1 | ~10% | ❌ Không đạt |
| M4d Retrieval v2 + deep mode | 1–1,5 | ~35% | 🟡 Deep đạt, search v2 chưa |
| M5 Backup, hardening, go-live | 1 | ~70% | 🟡 Backup đạt, eval/cleanup chưa |
| D0–D4 Didi | 3,5–5 | 0% (repo khác) | ⬜ Chưa bắt đầu; phía agent đã sẵn sàng cho D3 |

---

## 2. Chi tiết từng đầu mục

### M0 — Skeleton & nền móng ✅ Đạt

| Đầu mục thiết kế | Thực tế code | Đánh giá |
|---|---|---|
| Repo skeleton theo `01` §6 | Đủ chức năng nhưng layout khác: không có `web/public.py`/`admin_api.py`/`deps.py` (toàn bộ route nằm `main.py` 684 dòng), không có `channels/telegram/commands.py` (gộp vào `adapter.py`), không có `channels/direct.py`, tools gộp 1 file `tools/registry.py` | 🟡 Lệch cấu trúc, không lệch chức năng. `main.py` quá to — nên tách như thiết kế khi làm tiếp |
| Settings + fail-fast production | `settings.py:112-136` validate đủ biến ✔, check độ dài token ≥32 | ✅ Đạt. Thiếu các env mới của v1.4+: `PROGRESS_*`, `SUMMARY_*`, `SESSION_IDLE_HOURS` (vì tính năng tương ứng chưa làm) |
| Migrations 0001 init + 0002 seed | DDL `0001_init.sql` khớp `03` §2 (FTS5 unicode61 remove_diacritics 2, chunks_meta content-addressed, kb_files, sync_state ✔). **Nhưng có 0003→0009 = 7 migration UPDATE persona** | 🟡 A2 của review trước **chưa xử lý** — sai cơ chế versioning (instructions có version+rollback qua API nhưng persona lại đi bằng migration). Thiếu bảng v1.5+: `session_state`, `tg_anchors`, `model_profiles`; `messages` thiếu cột `tg_message_id`, `reply_to_tg_message_id` |
| `/health`, logging JSON, Dockerfile | `main.py:227-230` ✔; `utils.py:log_event` JSON + mask secret ✔; Dockerfile khớp `05` §3 từng dòng (ripgrep, workers 1) ✔ | ✅ Đạt |
| Git + ignore | `.gitignore`/`.dockerignore` đầy đủ (cover `.env*`, `bootstrap/`, `*.zip`, `*.sqlite3`) — **nhưng không có `.git/`** | ❌ P0-3 còn nguyên: không version control. `.env.production` chứa secret thật vẫn nằm trên đĩa repo |

### M1 — KB + Agent core + probe model ✅ Đạt

| Đầu mục | Thực tế | Đánh giá |
|---|---|---|
| `probe_model.py` | Có, test native + JSON + tiếng Việt (`scripts/probe_model.py`); kết quả ghi `IMPLEMENTATION_NOTES.md` (pass native) | ✅ Đạt cho scope M1 (test A/B/C; D/E/F thuộc M4b — chưa có) |
| KBService extract/index/version/activate | `kb.py`: zip validate (bomb/traversal/symlink) ✔, exclude list server-side đủ `.env*`/`credentials`/`*.sqlite3` ✔ (P1-4 đã sửa), index content-addressed theo (path, sha256) ✔, kb_files manifest cho mọi version ✔, symlink atomic ✔, archive + cleanup KB_KEEP_VERSIONS + GC chunk mồ côi ✔, svg không index nội dung ✔ (`TEXT_EXTENSIONS` kb.py:23) | ✅ Đạt, đúng thiết kế `03` §2–3 |
| 4 KB tool + load_skill + memory + run tools (9 tool) | `tools/registry.py`: đủ 9 tool đúng tên/schema/giới hạn; path traversal chặn ở `kb.py:_safe_current_path`; tool lỗi trả `{"error":...}` không vỡ loop ✔ | ✅ Đạt |
| LLMClient httpx, retry, 2 model | `llm.py`: retry 429/5xx/timeout backoff, parse string + list-of-parts, main+lite ✔ | ✅ Đạt |
| AgentLoop native + JSON | `agent_loop.py`: đúng pseudocode `02` §1.2 (budget bước, compact context, tổng hợp khi hết bước) + **auto-fallback native→json khi lỗi** (tốt hơn thiết kế), provenance-retry ép tra KB trước khi final (sáng tạo hợp lệ) | ✅ Đạt |
| CLI dev | `cli.py`: `chat`, `index-kb`, `status`, `migrate` ✔ | ✅ Đạt |
| Benchmark index KB thật ghi notes | Notes có số file scan (53.217) nhưng **không có số đo thời gian index/dung lượng DB/tốc độ search** như acceptance yêu cầu | 🟡 Thiếu số đo |

### M2 — Telegram + security + guardrail 🟡 Đạt một phần (~80%)

| Đầu mục | Thực tế | Đánh giá |
|---|---|---|
| Webhook 2 lớp + polling | `main.py:259-277` secret path + header, so `hmac.compare_digest`, sai → 404 ✔; polling dev ✔; message xử lý nền `asyncio.create_task` ✔ | ✅ Đạt |
| Default-deny + duyệt qua nút | `adapter.py`: chưa có record → tạo pending + nút Approve/Reject cho owner ✔; rejected/revoked → im lặng + audit ✔; group → leave + audit ✔; seed env chỉ là seed, DB là nguồn sự thật ✔ | ✅ Đạt đúng `04` §2.1 |
| Lệnh user + owner | Có: `/start /help /whoami /skills /workflows /forget /run /cancel` + owner `/approve /revoke /users /status /kb_activate /runs`. **Thiếu `/new`** (thuộc M4c), `/cancel` không tham số (hủy lượt Q&A), `/deep` đi qua router text ✔ | 🟡 Thiếu 2 lệnh |
| **Rate limit** | `RateLimiter` có (`rate_limit.py`) nhưng **chỉ gọi ở `/invocations`** (`main.py:244`). `grep rate_limit app/channels app/core` = 0 kết quả → **Telegram không giới hạn tần suất** | ❌ Không đạt — acceptance M2 ghi rõ "rate limit hoạt động"; user được allow có thể spam đốt token MaaS (threat `04` §4.1 DoS) |
| Guardrail tiền-LLM (lớp 1) | `guardrail.py` + `config/guardrail.yaml`: 4 nhóm pattern đúng `02` §2.2, câu từ chối chuẩn đúng nguyên văn, audit chỉ lưu category + hash ✔, chạy trước classify trong `router.py:38-47` ✔ | ✅ Đạt. Lưu ý: config load 1 lần lúc boot — thiết kế nói hot-reload |
| Guardrail lớp 2 (L2b trong prompt) | Không có block L2b riêng; chỉ TRUTH_RULES #7 "không tiết lộ system prompt/secret" (`prompts.py:20`) | 🟡 Một phần — thiếu chỉ thị từ chối theo *ý đồ khai thác* cho ca tinh vi lọt lớp 1 |
| Role-persistence (`02` §8.2) | Fact extraction qua model lite sau mỗi lượt (`agent_loop.py:_extract_facts`), normalize key role/department/name, role ghi đè (delete-then-insert `memory.py:upsert_fact`), prompt nhắc "TUYỆT ĐỐI không hỏi lại" (`prompts.py:62-66`), fact theo user_id xuyên phiên ✔ | ✅ Đạt |
| Typing + chunk + HTML | typing 1 lần (không refresh 5s); chunk ≤3900 cắt theo dòng ✔; HTML render qua `formatting.py` ✔ | 🟡 Thiếu refresh typing và progress message (thuộc M4d UX) |

### M3 — Admin API headless 🟡 Đạt một phần (~85%)

| Đầu mục | Thực tế | Đánh giá |
|---|---|---|
| Auth `AGENT_ADMIN_TOKEN` Bearer + `X-Acting-User/Role` + RBAC 3 cấp + actor `didi:<user>` | `web/auth.py`: đúng toàn bộ — viewer/operator/superadmin theo ma trận `04` §4.2.2 (read=viewer, content/KB/run=operator, settings/backup=superadmin), `hmac.compare_digest`, **key rỗng = từ chối kể cả dev** (P0-2 đã sửa, chặt hơn thiết kế) | ✅ Đạt ADR-2 v3 |
| Phủ endpoint `04` §1.2 | Có: status, instructions GET/POST/activate, skills GET, workflows GET + run, kb list/{id}/activate/upload/search-test, **chunked upload (sáng tạo hợp lệ — giải rủi ro ingress `05` §9)**, manifest/delta/sync-status (nhận cả sync key lẫn admin ✔ P1-6), access GET/POST, audit, **answers (sáng tạo — phục vụ eval)**, settings GET/PATCH whitelist, runs list/{id}/cancel/artifacts, backup POST/GET/restore | ✅ ~85% phủ |
| **Thiếu**: `PATCH/POST /admin/api/skills`, `PATCH/POST /admin/api/workflows` | Không có 4 route này → **không thể bật/tắt skill, sửa description/triggers/content_override, tạo skill/workflow mới từ Didi** — trong khi DB đã có sẵn các cột này | ❌ Gap nặng nhất của M3: trang Skills/Workflows của Didi (D3) sẽ không có API để gọi. ADR-10 ("admin có thể override/bật tắt qua DB") chưa dùng được |
| Hot-reload "sửa trên admin là dùng ngay" | Persona: ✔ thực tế (PromptBuilder đọc `active_instruction` mỗi lượt). Cơ chế `registry_version` + đồng bộ menu lệnh: ✗ (chỉ là key trong whitelist settings, không ai đọc) | 🟡 Persona hot ✔, phần còn lại chưa có gì để hot |
| Upload pipeline nền + poll | upload → background task → `GET kb/{id}` poll ✔ | ✅ Đạt |

### M3b — KB auto-sync 🟡 Server đạt, client chưa có (~60%)

| Đầu mục | Thực tế | Đánh giá |
|---|---|---|
| Schema kb_sync (kb_files, sync_state, kind/base_version/change_summary) | Có đủ ngay trong 0001 ✔ | ✅ Đạt |
| 3 endpoint sync, `SYNC_API_KEY` least-privilege, rỗng → 404 | `web/auth.py:require_sync_*` ✔; 409 khi base lệch / đang processing ✔; 413 quá ngưỡng ✔ | ✅ Đạt |
| `apply_delta`: hardlink tree, áp thay đổi atomic, index incremental, verify manifest, policy auto/review, Telegram notify, sync_state | `kb.py:597-850`: đủ và đúng thiết kế `03` §7.3, kể cả ghi file mới rồi `os.replace` không phá inode version cũ ✔, `/kb_activate` cho chế độ review ✔ | ✅ Đạt |
| **Chống xóa hàng loạt >30%** | Không có — `apply_delta` không kiểm số lượng `deleted` | ❌ Thiếu chốt an toàn (threat `04` §4.1: lộ SYNC_API_KEY → kẻ xấu xóa được KB) |
| **Bug mới phát hiện**: `kb.py:830` gọi `log_event` nhưng **không import** trong `kb.py` | Nếu gửi Telegram notify lỗi → `NameError` → cả delta sync bị đánh dấu failed dù đã áp xong | ❌ Bug latent, sửa 1 dòng import |
| **Sync Agent client** `scripts/queo_sync.py` + `com.queo.sync.plist` | **Không tồn tại** (chỉ có pack_kb/upload_kb thủ công + chunked) | ❌ Chưa làm — ADR-3 v2 "mọi thay đổi folder tự đồng bộ" chưa chạy được end-to-end; acceptance M3b không thể pass |

### M4 — Workflow engine + scheduler + slash động 🟡 (~50%)

| Đầu mục | Thực tế | Đánh giá |
|---|---|---|
| Parser markdown → steps | `workflows/parser.py`: section "Quy trình/Steps" → numbered list, không có → cả thân = 1 step ✔ | ✅ Đạt |
| Engine: chạy nền, state chung, semaphore, cancel, artifacts, log step | `workflows/engine.py`: asyncio task ✔, semaphore 2 ✔ (run 3 tự xếp hàng nhưng **không báo user "đang xếp hàng"**), cancel qua DB + task.cancel ✔, mapping Cowork→Quéo trong extra_system ✔, log từng step vào `workflow_runs.log` ✔ | ✅ Đạt phần lõi |
| Bước tổng hợp cuối qua agent loop | **Không có** — `_write_report` ghép cơ học summary các step thành report.md, không gọi LLM tổng hợp theo "mục Output của workflow" như `02` §5.2 | 🟡 Báo cáo sẽ rời rạc với workflow nhiều step |
| Kích hoạt: `/run` + admin run | ✔ cả hai; trigger 'api' có trong CHECK constraint | ✅ |
| Ngôn ngữ tự nhiên → intent workflow + hỏi xác nhận | **Không có** — router không phân loại intent workflow (không dùng LLM lite classify; `_classify_mode` chỉ regex chat/deep/qa) | ❌ Chưa làm |
| **Scheduler cron** | **Không có** — `croniter` nằm trong requirements nhưng 0 chỗ import; cột `schedule` được parse vào DB rồi bỏ đó | ❌ Chưa làm (P2-2 còn nguyên) |
| **Slash command động + `command_alias` + `setMyCommands` + hot-reload `registry_version`** | **Không có** — DDL skills/workflows thiếu 2 cột `command_alias`/`show_in_menu`; grep `setMyCommands`/`command_alias` = 0 | ❌ Chưa làm (P2-1 còn nguyên) — đây là yêu cầu "/monthly-report-generate" Duy đã chốt ở `02` §6.1–6.2 |

### M4b — Model Router ❌ Không đạt (~5%)

Thiết kế (`02` §7.1, `05` §4): profile 5 model MaaS bằng `scripts/profile_models.py` (test A–F) → bảng `model_profiles` → routing class lite/agent/code/deep qua settings `model_routing` → fallback chain → budget deep/ngày.

Thực tế: không có `profile_models.py`, không bảng `model_profiles`, không nhãn task class trong router, không fallback chain giữa các model (chỉ retry cùng model trong `llm.py`), không budget. `llm_calls.model` còn ghi cứng `settings.llm_model` thay vì model thực dùng (`agent_loop.py:529`). Duy nhất có: 2 model main/lite (`settings.lite_model`) — đúng baseline trước v1.1, và key `model_routing` nằm trong whitelist settings nhưng không ai đọc.

**Lý do không đạt:** toàn bộ cụm ADR-11 chưa bắt đầu. Đây là 1 trong 2 đòn bẩy chính (cùng M4d) để thu hẹp gap chất lượng T1 đã chẩn đoán ở `03` §4.0b.

### M4c — Conversation context ❌ Không đạt (~10%)

Thiết kế (`02` §8.1): (A) neo reply/quote Telegram, (B) session_state + pending_question, (C) rolling summary, (D) segment + `/new` + idle 6h.

Thực tế: không có bảng `session_state`/`tg_anchors`, messages không lưu `tg_message_id`, adapter không đọc `reply_to_message`/`quote`, không rolling summary, không `/new`, không auto-segment. Có duy nhất 1 shim nhỏ: `_effective_message` (`agent_loop.py:411-445`) bắt "thử lại/tiếp tục" → lấy lại câu hỏi gần nhất — giải được 1 ca hẹp của mục B bằng heuristic.

**Lý do không đạt:** 4 cơ chế thiết kế chưa làm; hội thoại dài sẽ rơi context (chỉ 18 tin verbatim, thực tế còn cắt xuống 4–8 tin trong `_history_for_context`), user không thể reply vào báo cáo để hỏi tiếp.

### M4d — Retrieval v2 + deep mode 🟡 (~35%)

| Đầu mục | Thực tế | Đánh giá |
|---|---|---|
| Bước 0: chẩn đoán 10 câu, gắn nhãn RETRIEVAL_MISS/READ_MISS/… | Không có dấu vết trong `IMPLEMENTATION_NOTES.md` (đã có `/admin/api/answers` làm hạ tầng trace ✔) | ⬜ Chưa làm — thiết kế ghi "bắt buộc làm TRƯỚC khi code M4d" |
| Search v2: stopwords VN, phrase→AND→OR theo bậc, query expansion lite + RRF | `kb.py:_match_query`: **vẫn OR-only toàn token**; không stopwords; không bậc match; không RRF. Có 1 phần expansion: **dict tĩnh Việt→Anh** (~20 cụm: nạp tiền→deposit, rút tiền→redemption…) — hữu ích nhưng hẹp hơn nhiều expansion bằng model lite | 🟡 ~25% — token phổ thông vẫn gây nhiễu trên 850k chunk đúng như chẩn đoán T3 |
| Chunking theo heading + breadcrumb | Vẫn cắt phẳng theo đoạn 1400/overlap 180 (`kb.py:_chunk_text`), có start/end line ✔ nhưng không breadcrumb `file > H1 > H2` | ❌ Chưa làm |
| Group-by-file khi trả kết quả | Không — mỗi chunk 1 entry | ❌ |
| Rerank | Có product-alias −10 ✔, fact −5 khi query nhóm sự cố ✔, thêm knowledge −5 (ngoài thiết kế, hợp lý); thiếu decay mtime | 🟡 ~70% |
| KB MAP (L3b) vào system prompt | Không có — agent vẫn "mò" bằng kb_list; đây là fix T2(b) tác động lớn/chi phí rẻ nhất theo `03` §4.0b | ❌ Chưa làm |
| QUY TRÌNH TRA CỨU B1–B6 trong RULES | Không có block B1–B6; thay bằng TOOL_HINTS + **quy tắc ĐỐI CHIẾU CHÉO bắt buộc Source Code** (`prompts.py:30-33`) — tinh thần tương đương B4 | 🟡 Một phần |
| Context budget scale theo `model_profiles.ctx_window`; nâng TOOL_RESULT/KB_READ | Không — vẫn hằng 48k/8k/12k (`settings.py:46-49`); compact giữ 5 đầu + 8 cuối ✔ | ❌ Phụ thuộc M4b chưa có; đây là fix T2(a) |
| Deep mode: `/deep`, keyword "tìm kỹ…", budget 24 bước/420s | `router.py:_extract_deep_command` + `_looks_deep` ✔; `agent_loop._max_steps_for_mode`/`_total_timeout_for_mode` ✔ | ✅ Đạt |
| Progress editMessageText + `/cancel` lượt Q&A | Không có editMessageText, không progress định kỳ, `/cancel` chỉ hủy workflow run | ❌ Chưa làm — deep mode hiện chạy tới 7 phút mà user không thấy gì (UX `04` §2.3) |

### M5 — Backup, hardening, go-live 🟡 (~70%)

| Đầu mục | Thực tế | Đánh giá |
|---|---|---|
| BackupService S3: snapshot VACUUM INTO + tar.zst, KB active, restore, boot-restore, keep N, list | `backup.py` + `main.py:174-204`: đủ, kèm chống traversal khi extract ✔, cleanup local + S3 theo `BACKUP_KEEP` ✔, interval scheduler ✔, trigger sau kb activate ✔ | ✅ Đạt |
| Cleanup artifacts theo `ARTIFACT_RETENTION_DAYS` | Setting có, **không có job nào dùng** | ❌ Chưa làm |
| Semaphore concurrency + logger mask secret | `agent_loop` semaphore ✔; `utils.sanitize` mask key chứa token/key/secret/password ✔; audit detail đi qua `safe_json` sanitize ✔ | ✅ Đạt |
| Bundled DB/KB trong image (P0-1) | Đã gỡ — không còn boot_copy, `bootstrap/` bị ignore cả git lẫn docker (xác nhận `.dockerignore`) | ✅ Đã sửa |
| Eval 50 câu | `eval-questions-draft.yaml` còn ở docs (draft, Duy chưa điền TODO); không có `tests/eval/questions.yaml`, không có runner | ⬜ Chưa làm (một phần chờ input Duy — pre-dev #6) |
| Checklist bảo mật `04` §4.3 mục 1–7 | Có thể pass 1,2,4,5,7 theo code; mục 3 pass; **mục có rate limit thì fail** (xem M2). Staging đã deploy nhưng notes ghi rõ: chưa có S3 → mất state khi redeploy → **chưa đủ điều kiện go-live theo chính ghi chú của repo** | 🟡 |
| Test | 42 test function, 4 file; review trước ghi nhận pass toàn bộ. (Không re-run được trong sandbox này — Python 3.10 < yêu cầu 3.12) | 🟡 Có test nền tảng; thiếu test cho phần chưa code là tất nhiên |

### 07 — Didi integration (D0–D4) ⬜ Chưa bắt đầu

Nằm ở repo Didi, ngoài phạm vi repo này. **Phần "tác động lên agent" của `07` §6 đã hoàn thành**: agent headless ✔, auth service token + X-Acting-* ✔, audit actor `didi:<username>` ✔. Điều kiện để D3 chạy được còn thiếu: 4 route mutation skills/workflows (xem M3).

---

## 3. Nguyên tắc bất biến (`00` §5) — tuân thủ

| # | Nguyên tắc | Trạng thái |
|---|---|---|
| 1 | Default-deny mọi lớp | ✅ — auth trả false khi key rỗng kể cả dev (chặt hơn thiết kế); fail-fast production ✔ |
| 2 | Secret không lọt log/git/image | ✅ — sanitize log, ignore files, bootstrap đã gỡ. ⚠️ `.env.production` thật còn trên đĩa repo (chấp nhận local, không được commit) |
| 3 | TRUTH-mode (bản v1.7: ẩn nguồn với user, giữ machine-readable) | ✅ — citations thu thập đủ (tools→ctx), trả `/invocations` + audit `message_out` + `/admin/api/answers`; text bị làm sạch triệt để (`output.py`) |
| 4 | Tiếng Việt mặc định | ✅ |
| 5 | Audit mọi hành động + message | ✅ — message_in/out, guardrail_block, kb_*, access_*, denied… |
| 6 | Idempotent & versioned | 🟡 — KB versioned ✔, instructions versioned ✔ qua API, nhưng persona sửa bằng 7 migration (A2) phá versioning |
| 7 | Agent chỉ đọc KB | ✅ — tool read-only, ghi duy nhất vào artifacts/ |
| 8 | Mọi giới hạn hữu hạn & cấu hình được | 🟡 — steps/timeout/size/concurrent ✔; **rate limit Telegram không được áp** |

## 4. Lỗi/rủi ro MỚI phát hiện trong lần review này

1. **`app/services/kb.py:830` — `log_event` chưa import** → NameError khi Telegram notify lỗi trong `apply_delta`, làm cả version delta bị ghi `failed` dù đã áp thành công. Sửa: thêm `log_event` vào import từ `app.utils`.
2. **Telegram không rate limit** (chỉ `/invocations` có) — vi phạm acceptance M2 + threat model DoS `04` §4.1. Sửa: gọi `rate_limit.check(f"tg-{user_id}")` trong `_dispatch_allowed` trước khi vào router, vượt → trả câu tĩnh.
3. **Thiếu chốt chống xóa >30%** trong `apply_delta` — giảm thiểu thiệt hại khi lộ `SYNC_API_KEY`.
4. `llm_calls.model` ghi `settings.llm_model` cứng — sai số liệu khi sau này có router/fallback.
5. Guardrail config không hot-reload (load 1 lần lúc boot) — thiết kế yêu cầu reload theo `registry_version`.

## 5. Điểm code làm TỐT HƠN thiết kế (giữ lại, chép ngược vào docs nếu cần)

- **Chunked upload** (start/part/complete) — giải đúng rủi ro ingress body-limit đã dự báo `05` §9.
- **Auto-fallback native→json** trong cùng lượt khi native lỗi (thiết kế chỉ chọn 1 mode qua env).
- **Provenance-retry**: ép model tra KB trước khi final ở mode qa/deep — giảm bịa.
- **`/admin/api/answers`**: trace hỏi-đáp + citations — đúng hạ tầng cần cho bước chẩn đoán M4d và eval M5.
- **SQLite lock resilience** (retry + fail-soft cho audit/memory/metrics) — phản ứng đúng sự cố staging thật.
- **Output cleaning** (`core/output.py`) thực thi triệt để quyết định ẩn nguồn v1.7 ở tầng code, không chỉ dựa prompt.
- Auth dev cũng default-deny (chặt hơn spec).

## 6. Trạng thái các finding của review trước (v1.3)

| Finding | Trạng thái |
|---|---|
| P0-1 DB/KB nhúng image | ✅ Đã sửa (bootstrap gỡ, ignore đủ) |
| P0-2 Auth mở khi không production | ✅ Đã sửa (deny khi key rỗng) |
| P0-3 Không có git | ❌ Còn nguyên |
| A1 Citation ẩn khỏi user | ✅ Đã hợp thức hóa vào docs v1.7 (§2.1 #5, §2.3) — code và docs nay khớp nhau |
| A2 Persona bằng migrations | ❌ Còn nguyên (0003–0009 vẫn đó) |
| P1-1 AGENT_ADMIN_TOKEN | ✅ Đã sửa |
| P1-2 Admin API thiếu | 🟡 Một phần — còn thiếu PATCH/POST skills & workflows |
| P1-3 admin_restore bug | ✅ Đã sửa |
| P1-4 exclude secrets server-side | ✅ Đã sửa |
| P1-5 svg index | ✅ Xác nhận không index (TEXT_EXTENSIONS) |
| P1-6 manifest cho admin | ✅ Đã sửa |
| P2-1 slash động + hot-reload | ❌ Còn nguyên |
| P2-2 scheduler cron | ❌ Còn nguyên |
| P2-3 queo_sync.py client | ❌ Còn nguyên |

## 7. Khuyến nghị thứ tự làm tiếp

1. **Vá ngay (≤ ½ ngày):** `git init` + push private (P0-3) → import `log_event` trong kb.py → rate limit Telegram → chốt chặn xóa >30% → gộp persona 0003–0009 về seed (A2).
2. **Mở khóa Didi D3 (½ ngày):** 4 route PATCH/POST skills/workflows (DB đã sẵn cột).
3. **M4d theo đúng giao thức:** chạy chẩn đoán 10 câu trên `/admin/api/answers` → fix theo nhãn lỗi (KB MAP L3b + nâng budget đọc là 2 việc rẻ nhất, rồi mới đến search v2/breadcrumb re-index).
4. **M3b client:** `queo_sync.py` + launchd — để ADR-3 "tự đồng bộ" thành sự thật.
5. **M4 phần động + M4b + M4c** theo thứ tự giá trị với user: slash động (Duy đã chốt) → conversation context → model router.
6. **M5 go-live:** bật S3 staging (notes đã cảnh báo mất state), eval 50 câu sau khi Duy điền draft.
