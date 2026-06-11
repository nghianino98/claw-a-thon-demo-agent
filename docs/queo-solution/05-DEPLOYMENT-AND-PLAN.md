# 05 — Deployment, vận hành & kế hoạch triển khai

## 1. Tổng quan hạ tầng GreenNode

| Thành phần | Giá trị |
|---|---|
| Runtime | AgentBase **Custom Agent** (`/agent-runtimes`) — Docker image, autoscale, networkMode PUBLIC |
| Runtime contract | container nghe **:8080**; `GET /health` → 200 khi sẵn sàng |
| Container Registry | AgentBase managed CR (vCR) — repo pre-provisioned theo account |
| LLM | GreenNode MaaS, OpenAI-compatible: `https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1` + `LLM_API_KEY` (API key AI Portal do BTC cấp / tạo qua `aip.sh`) |
| Console | `https://aiplatform.console.vngcloud.vn` |
| IAM (quản trị từ máy dev) | `.greennode.json` (client_id/secret) — đã có sẵn trong repo demo, KHÔNG commit |
| Env tự tiêm khi chạy trên runtime | `GREENNODE_CLIENT_ID`, `GREENNODE_CLIENT_SECRET`, `GREENNODE_AGENT_IDENTITY`, `GREENNODE_ENDPOINT_URL` |
| Bộ công cụ thao tác | `greennode-agentbase-skills/.claude/skills/` — dùng `/agentbase-wizard`, `/agentbase-llm`, `/agentbase-deploy`, `/agentbase-monitor`; token qua `scripts/get_token.sh` (không bao giờ curl token tay) |

Network mode **PUBLIC** là bắt buộc: Telegram webhook cần gọi vào endpoint từ internet. (VPC mode chỉ khi sau này có yêu cầu nội bộ — khi đó chuyển Telegram sang polling.)

## 2. Environment variables — bảng chuẩn (`.env.example` phải khớp 100%)

| Biến | Default | Bắt buộc prod | Mô tả |
|---|---|---|---|
| `APP_ENV` | `development` | ✔ (`production`) | production bật fail-fast validate |
| `AGENT_NAME` | `Quéo` | | persona name |
| `STATE_DIR` | `/data` | | thư mục state |
| `AGENT_API_KEY` | *(rỗng)* | ✔ | auth `/invocations` |
| `AGENT_ADMIN_TOKEN` | *(rỗng)* | ✔ | ≥32 random — service token duy nhất cho Didi BFF gọi `/admin/api/**` (ADR-2 v3; login/2FA/RBAC nằm ở Didi với bộ env `DIDI_*` riêng — `07` §7) |
| `LLM_BASE_URL` | *(rỗng)* | ✔ | MaaS `/v1` |
| `LLM_API_KEY` | *(rỗng)* | ✔ | |
| `LLM_MODEL` | *(rỗng)* | ✔ | model chính |
| `LLM_MODEL_LITE` | *(rỗng)* | | model rẻ cho router/facts |
| `LLM_TIMEOUT_SECONDS` | `60` | | |
| `TOOLCALL_MODE` | `native` | | `native` \| `json` (kết quả probe §4) |
| `AGENT_MAX_STEPS` | `12` | | mức standard |
| `AGENT_DEEP_MAX_STEPS` / `AGENT_DEEP_TIMEOUT_SECONDS` | `24` / `420` | | deep mode (`02` §1.2) — user chấp nhận chờ có progress |
| `PROGRESS_FIRST_SECONDS` / `PROGRESS_UPDATE_SECONDS` | `8` / `25` | | progress message lượt dài (`04` §2.3) |
| `AGENT_MAX_PARALLEL_TOOLS` | `4` | | số tool call xử lý mỗi lượt |
| `AGENT_TOTAL_TIMEOUT_SECONDS` | `120` | | mức standard |
| `AGENT_MAX_CONCURRENT` | `4` | | |
| `CONTEXT_BUDGET_CHARS` | `48000` | | floor khi chưa có profile; runtime tự scale theo `model_profiles.ctx_window` (`02` §1.2) |
| `CONTEXT_BUDGET_CHARS_MAX` | `400000` | | trần an toàn khi scale theo window |
| `TOOL_RESULT_MAX_CHARS` | `8000` | | |
| `KB_READ_MAX_CHARS` | `12000` | | |
| `MAX_HISTORY_MESSAGES` | `18` | | số tin verbatim cuối nhồi prompt |
| `SUMMARY_EVERY_TURNS` / `SUMMARY_MAX_CHARS` | `6` / `1500` | | rolling summary hội thoại (`02` §8.1-C) |
| `SESSION_IDLE_HOURS` | `6` | | khoảng lặng → tự sang segment mới (`02` §8.1-D) |
| `TELEGRAM_MODE` | `webhook` | | `webhook` \| `polling` (dev) |
| `TELEGRAM_BOT_TOKEN` | *(rỗng)* | ✔ | |
| `TELEGRAM_WEBHOOK_SECRET` | *(rỗng)* | ✔ | ≥32 hex, nằm trong path |
| `TELEGRAM_OWNER_USER_IDS` | *(rỗng)* | ✔ (≥1) | owner = admin Telegram |
| `TELEGRAM_ALLOWED_USER_IDS` | *(rỗng)* | | seed allowlist lần đầu |
| `RATE_LIMIT_PER_MINUTE` / `RATE_LIMIT_PER_DAY` | `6` / `200` | | per user |
| `WORKFLOW_MAX_CONCURRENT` / `WORKFLOW_MAX_STEPS` / `WORKFLOW_TOTAL_TIMEOUT_SECONDS` | `2`/`15`/`1800` | | |
| `KB_UPLOAD_MAX_MB` / `KB_FILE_MAX_MB` / `KB_KEEP_VERSIONS` | `2000`/`20`/`3` | | KB thật ~1,1GB text + media |
| `KB_DELTA_MAX_MB` | `100` | | giới hạn 1 lần delta sync |
| `SYNC_API_KEY` | *(rỗng)* | khuyến nghị | bật KB auto-sync (`03` §7); rỗng = endpoint sync tắt (404) |
| `ARTIFACT_RETENTION_DAYS` | `14` | | |
| `S3_ENDPOINT` / `S3_BUCKET` / `S3_ACCESS_KEY` / `S3_SECRET_KEY` / `S3_REGION` | *(rỗng)* | khuyến nghị | bật backup khi đủ 4 giá trị đầu |
| `BACKUP_INTERVAL_HOURS` / `BACKUP_KEEP` / `BACKUP_INCLUDE_ARTIFACTS` | `24`/`7`/`0` | | |
| `GUARDRAIL_CONFIG` | `config/guardrail.yaml` | | mẫu chặn tiền-LLM (`02` §2.2), hot-reload |
| `LOG_LEVEL` | `INFO` | | JSON log ra stdout |

**Fail-fast khi `APP_ENV=production`:** thiếu bất kỳ biến ✔ nào, hoặc `AGENT_ADMIN_TOKEN` < 32 chars, hoặc `TELEGRAM_MODE=webhook` mà thiếu secret → process exit(1) kèm message rõ ràng (in tên biến thiếu, không in giá trị).

## 3. Dockerfile chuẩn

```dockerfile
FROM python:3.13-slim
RUN apt-get update && apt-get install -y --no-install-recommends ripgrep \
    && rm -rf /var/lib/apt/lists/*          # ripgrep cho tool kb_grep (02 §3)
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN mkdir -p /data
EXPOSE 8080
ENV STATE_DIR=/data
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
```

`--workers 1` là **bắt buộc** (SQLite + in-memory scheduler/semaphore; concurrency là asyncio). `.dockerignore`: `.env`, `.greennode.json`, `/data`, `*.sqlite3`, `.git`, `tests/`, `.agentbase/`, `docs/`.

## 4. Profile model MaaS & cấu hình Model Router (M1 chọn model nền; M4b profile đầy đủ)

Model ENABLED hiện tại trên MaaS (console AI Portal, 2026-06-11): **MiniMax M2.5**, **Qwen 3.5 27B** (multimodal, BETA), **Gemma 4 31B-IT**, **Qwen 3.7 Plus** (BETA), **GPT-5**. Danh sách có thể đổi — luôn lấy tươi bằng `aip.sh models list` (`/agentbase-llm`).

1. Chạy `scripts/profile_models.py` cho **từng** model ENABLED (mở rộng từ probe_model.py):
   - Test A — native tool calling: gửi 1 tool `get_time` + câu "mấy giờ rồi" → trả `tool_calls` đúng schema rồi hoàn thành câu trả lời sau khi nhận tool result.
   - Test B — JSON mode: prompt JSON-action (02 §1.3) → parse được ≥ 4/5 lần.
   - Test C — tiếng Việt: tóm tắt 1 đoạn tài liệu MMF, chấm 0-10 (chấm chéo bằng model khác + Duy duyệt mẫu).
   - Test D — context dài: nhồi 20k chars KB → hỏi chi tiết nằm cuối.
   - Test E — code reasoning: 1 đoạn Go/TS thật từ `03. Fact/Source Code` → hỏi logic + mã lỗi.
   - Test F — latency & tốc độ token (p50 của 5 call ngắn).
2. Ghi kết quả vào bảng `model_profiles` (02 §7.1) + `IMPLEMENTATION_NOTES.md`. Chạy lại khi BTC bật model mới hoặc model đổi version (BETA!).
3. Chọn **model nền**: `LLM_MODEL` = model pass A (hoặc B) tốt nhất tổng hợp C+E; `LLM_MODEL_LITE` = model rẻ/nhanh nhất pass C ở mức chấp nhận. Không model nào pass A lẫn B → tiêu chí chặn như cũ.
4. Điền bảng routing `model_routing` (02 §7.1) qua admin settings dựa trên profile. **Giả thuyết khởi điểm để kiểm chứng** (từ mô tả card model — KHÔNG dùng khi chưa probe xác nhận): Gemma 4 31B-IT (nhỏ nhất) → `lite`; Qwen 3.7 Plus hoặc MiniMax M2.5 (flagship, đối đầu bằng probe A+E) → `agent`/`code`; GPT-5 (đắt nhất) → `deep` có `max_deep_calls_per_day`; Qwen 3.5 27B multimodal → để dành `vision` phase 2.
5. Eval 50 câu chạy ≥2 cấu hình (single-model vs routed) → so điểm + tổng chi phí token (`llm_calls`) → chốt routing go-live.

## 5. Quy trình deploy (dùng skills có sẵn — không tự chế)

> Vibe coding agent: mở repo mới (đã copy `greennode-agentbase-skills/` + `.greennode.json` từ repo demo), rồi làm theo skill — mọi lệnh build/push/create runtime đều đã có script trong skill, **đọc SKILL.md tương ứng trước khi chạy**.

1. **Credentials:** `bash .claude/skills/agentbase/scripts/check_credentials.sh iam` → OK (dùng `.greennode.json` sẵn có).
2. **LLM key:** `/agentbase-llm` — tái dùng key BTC cấp (`aip.sh api-keys get <name> --save-env`) hoặc tạo key mới; xác nhận `check_credentials.sh llm`.
3. **Build & push image:** `/agentbase-deploy` Part 4 — lấy repo info CR, `docker login` (password-stdin), build `linux/amd64`, tag `queo-solution-agent:vX.Y.Z`, push.
4. **Tạo runtime:** `/agentbase-deploy` Part 1 — Custom Agent, PUBLIC mode, flavor: ≥ 2 vCPU/4GB RAM và **disk ≥ 20GB** (KB ~1,1GB text + media × 3 version hardlink + DB FTS 2-3GB + artifacts — kiểm tra danh sách flavor thực tế bằng script trong skill deploy), min=max=1 replica (SQLite single-writer — **không scale ngang**; cần thêm sức → tăng flavor), env vars theo §2 (nhập trên console/payload — secrets không đi qua git).
5. **Lấy endpoint** → smoke test: `curl https://<endpoint>/health`.
6. **Đăng ký webhook:**
   ```bash
   curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d "url=https://<endpoint>/telegram/webhook/$TELEGRAM_WEBHOOK_SECRET" \
     -d "secret_token=$TELEGRAM_WEBHOOK_SECRET" \
     -d "drop_pending_updates=true" \
     -d 'allowed_updates=["message","callback_query"]'
   ```
7. **Upload KB lần đầu** (agent headless — chọn 1 trong 3): (a) Didi đã có D3 → trang Agent Admin/Knowledge upload; (b) chưa có Didi → `curl -F file=@wealth-kb.zip -H "Authorization: Bearer $AGENT_ADMIN_TOKEN" -H "X-Acting-User: duy" -H "X-Acting-Role: superadmin" https://<endpoint>/admin/api/kb/upload` → poll `GET kb/{id}` ready → `POST kb/{id}/activate`; (c) hoặc bỏ qua upload full, chạy `queo_sync.py --once` từ máy Duy (lần đầu = full delta).
8. Chạy **checklist bảo mật** (`04` §4.3) + smoke test `scripts/smoke_test.sh`.
9. **Redeploy phiên bản mới:** build+push tag mới → update runtime image (zero-downtime theo platform) → vì state nằm S3/DB nên không mất gì; nếu STATE_DIR bị reset → boot tự restore từ S3.

## 6. Observability & vận hành

- **Logs:** JSON 1 dòng/event ra stdout (`ts, level, event, user_hash, latency_ms, tokens, run_id`) — xem qua `/agentbase-monitor`. Không log nội dung tin nhắn (nội dung nằm trong DB).
- **Metrics tối thiểu** (đọc từ dashboard admin, không cần hệ thống metrics riêng ở v1): tin nhắn/ngày, latency p50/p95 (từ `llm_calls`), token usage/ngày, run thành công/thất bại, search không có kết quả (để biết KB thiếu gì).
- **Runbook sự cố:**

| Triệu chứng | Xử lý |
|---|---|
| Bot không trả lời | `GET /health` → chết: xem log runtime (`/agentbase-monitor`), restart runtime. Sống: `getWebhookInfo` xem `last_error_message`; sai URL/secret → set lại webhook |
| Trả lời chậm/timeout | kiểm tra MaaS (gọi thử bằng curl); giảm `AGENT_MAX_STEPS`; xem queue `AGENT_MAX_CONCURRENT` |
| Trả lời sai/thiếu nguồn | Admin → Knowledge → search-test query tương ứng; KB thiếu → bổ sung & upload; chunk kém → tune (03 §4) |
| Mất state sau redeploy | boot log có dòng restore S3? Chưa bật S3 → bật rồi upload lại KB |
| Lộ bot token | BotFather revoke token → update env runtime → restart → setWebhook lại → audit kiểm tra truy cập lạ |
| Nghi ngờ tài khoản admin (Didi) bị chiếm | trang Accounts trên Didi: thu hồi sessions + reset password + reset 2FA; nặng hơn → `DIDI_ENABLED=false` tắt Didi tạm; tách biệt: xoay `AGENT_ADMIN_TOKEN` phía agent để cắt cầu Didi↔agent; điều tra qua audit 2 phía |
| Token MaaS hết quota | dashboard usage; tạm `enabled=0` các workflow schedule; xin tăng quota BTC |

## 7. Kế hoạch triển khai — milestones (mỗi milestone là 1 PR/1 phiên vibe coding)

> Quy tắc chung: viết test cùng code; xong milestone chạy toàn bộ pytest + acceptance rồi mới sang bước kế. Luôn chạy được local bằng `TELEGRAM_MODE=polling` + `.env` dev.

### M0 — Skeleton & nền móng (½ ngày)
- Repo theo cây `01` §6; settings + fail-fast; DB migrations 0001+0002; `/health`; logging JSON; Dockerfile build được.
- **Accept:** `uvicorn app.main:app` chạy; `curl :8080/health` → ok; `pytest` xanh (test settings validate, migrations idempotent); `docker build` ok.

### M1 — KB + Agent core + probe model (1–1,5 ngày)
- `probe_model.py` chạy với key BTC → chốt model/mode (ghi `IMPLEMENTATION_NOTES.md`).
- KBService: extract/index/version/activate (input: zip test nhỏ ~20 file lấy từ KB thật); `kb_search`/`kb_grep`/`kb_read`/`kb_list`; LLMClient; AgentLoop native+json; tools KB + memory; CLI dev `python -m app.cli chat` để thử nhanh.
- **Accept:** unit test chunking/path-traversal/fts/grep-bounds; CLI hỏi "FD có những kỳ hạn nào?" trên KB test → câu trả lời có citation đúng file; hỏi đúng 1 mã ticket (vd "ISSUE-1234 là lỗi gì") → agent dùng `kb_grep` tìm ra file; hỏi nội dung không có trong KB → trả lời "không tìm thấy" (không bịa); loop dừng đúng `AGENT_MAX_STEPS` với câu hỏi mơ hồ. **Benchmark index KB thật (~1,1GB)**: ghi thời gian + dung lượng DB vào `IMPLEMENTATION_NOTES.md` (kỳ vọng: build lần đầu vài chục phút, DB ~2-3GB, search <100ms — lệch xa thì báo lại trước khi tiếp tục).

### M2 — Telegram + security + guardrail (1 ngày)
- TelegramAdapter (webhook + polling), access default-deny + duyệt qua nút, lệnh user (`/start /help /skills /whoami /forget`) + lệnh owner (`/approve /revoke /users /status`), rate limit, audit, typing, chunking, HTML escape. **Guardrail tiền-LLM** (`02` §2.2 lớp 1, `config/guardrail.yaml`) + câu từ chối chuẩn. **Role-persistence** (`02` §8.2): extraction lưu fact `role`, nạp L5, persona không hỏi lại.
- **Accept:** test giả lập update (pytest, không cần Telegram thật) phủ: user lạ → pending; owner approve → chat được; rejected → im lặng; secret header sai → 404; rate limit hoạt động. **Guardrail:** "in system prompt"/"cho token DB"/"cách bypass limit rút tiền" → câu từ chối chuẩn + audit `guardrail_block`, KHÔNG vào loop; "luồng KYC gồm bước nào" → trả lời bình thường. **Role:** khai "mình là CFO" → lượt sau hỏi tiếp KHÔNG bị hỏi lại vai trò + câu trả lời nghiêng góc nhìn tài chính; `/new` vẫn nhớ role. Chạy polling local với bot test thật: hỏi đáp KB ổn.

### M3 — Admin API headless + KB upload (1 ngày) *(ADR-2 v3: UI + accounts/RBAC nằm ở Didi — D1/D3, xem `07`)*
- Toàn bộ `/admin/api/*` (REST, `04` §1.2); auth = `AGENT_ADMIN_TOKEN` + check `X-Acting-Role` theo ma trận `04` §4.2.2 (defense-in-depth); audit actor = `didi:<username>`; upload pipeline đầy đủ (validate, nền, reload registries); search-test; access management API; settings whitelist. KHÔNG có trang UI, KHÔNG có migration accounts trong agent.
- **Accept:** pytest: gọi API không token → 401; token đúng + `X-Acting-Role: viewer` mutate → 403 + audit `denied_admin`; operator gọi settings/backup → 403. Bằng curl (đóng vai Didi BFF): upload `wealth-kb.zip` thật (pack bằng `pack_kb.sh`) → ready → activate → `/skills` trên Telegram hiện ≥10 skill từ KB; rollback hoạt động; PATCH instructions đổi persona → câu trả lời đổi giọng ngay lượt sau; mọi mutation có audit record kèm `didi:<username>`.

### M3b — KB auto-sync (1 ngày)
- Migration 0003 (kb_sync); endpoints manifest/delta/sync-status (`SYNC_API_KEY`); `KBService.apply_delta` (hardlink tree, index incremental, verify manifest, policy auto/review, Telegram notify, chống xóa >30%); `scripts/queo_sync.py` (--watch/--once/--dry-run) + launchd plist; lệnh `/kb_activate`. (Khối Auto-sync hiển thị trên trang Knowledge của Didi — D3.)
- **Accept:** sửa 1 file + xóa 1 file + thêm 1 file trong bản copy KB local → chạy `queo_sync.py --once` → server lên version mới kind=delta, active, search thấy nội dung mới, owner nhận Telegram notify; chạy `--once` lần nữa → "không có thay đổi"; giả lập base_version lệch → 409 và client tự diff lại; thử delta xóa >30% file → server từ chối 400.

### M4 — Workflow engine + scheduler + slash command động (1,5 ngày)
- Parser + engine + queue/cancel + artifacts + `report_progress`; lệnh `/run /cancel /runs`; xác nhận trước khi chạy từ ngôn ngữ tự nhiên; scheduler cron; **command_alias resolve (`02` §6.1) + hot-reload `registry_version` (`02` §6.2) + đồng bộ `setMyCommands` (debounce 5s, normalize `-`→`_`)**.
- **Accept:** `/run cs-ticket-report` (hoặc workflow tương đương trong KB) chạy hết các step, gửi tiến độ, trả file báo cáo qua Telegram; cancel giữa chừng được; đặt schedule `*/10 * * * *` cho workflow test → tự chạy, kết quả về owner; 2 run đồng thời + run thứ 3 xếp hàng. **End-to-end cấu hình động:** POST workflow mới `monthly-report-generate` qua admin API → KHÔNG restart → gõ `/monthly-report-generate` trên Telegram chạy ngay + alias xuất hiện trong menu "/"; gõ `/monthly_report_generate` cũng chạy; sửa `enabled=0` → lệnh biến mất khỏi menu + trả gợi ý; `/issue-investigator` không tham số → bot hỏi input, nhắn tiếp → chạy đúng skill.

### M4b — Model Router (0,5–1 ngày)
- `scripts/profile_models.py` (test A–F, §4) + bảng `model_profiles`; resolve class→model trong Router (thêm nhãn task class vào lite-classify); fallback chain trong LLMClient; `max_deep_calls_per_day`; validate routing khi PATCH settings; cột model/purpose trên dashboard từ `llm_calls`.
- **Accept:** profile chạy đủ các model ENABLED (hiện 5: MiniMax M2.5, Qwen 3.5 27B, Gemma 4 31B-IT, Qwen 3.7 Plus, GPT-5) ghi vào `model_profiles` + `IMPLEMENTATION_NOTES.md`; PATCH `model_routing` gán class `deep` → câu "so sánh report tháng 2 và tháng 3" chạy bằng model deep (xác nhận qua `llm_calls`), câu xã giao chạy model lite; gán model không pass tool-calling cho `agent` → 409; giả lập model chính trả 500 → fallback chain trả lời được, `llm_calls.model` ghi model dự phòng; vượt deep budget → tự hạ về `agent` + audit.

### M4c — Conversation context (0,5–1 ngày)
- Migration session_state + tg_anchors + 2 cột messages; lưu `tg_message_id` 2 chiều trong adapter; dựng L4b (reply/quote → ngữ cảnh, tra anchors cho artifact/run); L5b rolling summary (lite, fire-and-forget); L5c session state; `/new` + auto-segment theo `SESSION_IDLE_HOURS`; shortcut run-đang-chạy; hợp nhất pending_skill về session_state.
- **Accept:** (1) hỏi MMF → bot trả lời → reply vào câu trả lời đó hỏi "còn FD thì sao?" → câu trả lời so sánh đúng ngữ cảnh tin được reply; (2) chạy workflow xong, reply vào file báo cáo "giải thích mục 2" → bot trả lời theo đúng run đó (xác nhận qua audit có run_id); (3) hội thoại 30+ lượt → hỏi lại chi tiết ở lượt đầu → bot trả lời đúng nhờ summary (kiểm tra summary trong DB có nội dung đó); (4) nói "tiếp tục đi" sau khi bot vừa hỏi clarify → bot hiểu là trả lời cho câu hỏi đang chờ; (5) `/new` rồi hỏi "nó là gì?" → bot hỏi lại thay vì dùng context cũ; im lặng >6h → tự sang segment (giả lập bằng sửa updated_at).

### M4d — Retrieval & Synthesis v2 + deep mode (1–1,5 ngày) *(mục tiêu: thu hẹp quality gap vs Cowork — `03` §4.0b)*
- **Bước 0 bắt buộc — chẩn đoán:** chạy 10 câu eval subset, gắn nhãn lỗi từng câu (RETRIEVAL_MISS / READ_MISS / SYNTHESIS_WEAK / MODEL_WEAK) theo giao thức `03` §4.0b → quyết định thứ tự fix, ghi `IMPLEMENTATION_NOTES.md`.
- Search v2 (`03` §4.1): stopwords VN, phrase→AND→OR theo bậc, query expansion lite + RRF, chunking theo heading + breadcrumb (re-index), group-by-file. KB MAP layer L3b (`02` §2). QUY TRÌNH TRA CỨU B1–B6 trong RULES. Context budget scale theo `model_profiles.ctx_window` + nâng TOOL_RESULT/KB_READ. Deep mode 2 mức budget + `/deep` + progress editMessageText + `/cancel` lượt qa (`02` §1.2, `04` §2.3).
- **Accept:** chạy LẠI đúng 10 câu chẩn đoán → ≥6/10 cải thiện rõ (đúng hơn/đủ nguồn hơn — Duy chấm mù A/B trước-sau); câu "rút tiền trước hạn FD xử lý sao?" search ra đúng section (kiểm tra phrase-match B1 hit); câu có từ tiếng Việt mà tài liệu viết tiếng Anh (vd "phí rút tiền" ↔ "redemption fee") vẫn ra nguồn nhờ expansion; `/deep so sánh chính sách rủi ro MMF và FI` → có tin progress tự cập nhật ≥2 lần, trả lời trong ≤7 phút, đọc ≥4 nguồn; `/cancel` giữa chừng dừng được; eval full 50 câu chạy lại — điểm không giảm ở nhóm cũ, tăng ở nhóm flow/cross-doc.

### M5 — Backup, hardening, go-live (1 ngày)
- BackupService S3 (snapshot/restore/boot-restore); cleanup artifacts; semaphore concurrency; logger mask secrets; deploy lên AgentBase theo §5; checklist `04` §4.3; eval set (§8).
- **Accept:** redeploy runtime → state nguyên vẹn (restore tự động); checklist bảo mật **phần agent (mục 1–7)** pass (`04` §4.3 — mục 8–12 thuộc D4 của Didi); eval ≥ 80% đạt; bàn giao: README cập nhật + `IMPLEMENTATION_NOTES.md`.

### D0→D4 — Didi AI Tool (platform hóa + Agent Admin + server deploy)

Chạy sau M2 (cần agent API để D3 nối vào), song song được với M4/M5. Toàn bộ scope, acceptance và **hợp đồng zero-regression với tool đang chạy của Duy** nằm ở `07` §5–§7.

**Phase 2 (sau go-live, không thuộc scope hiện tại):** embeddings/hybrid search (bảng đã chừa); AgentBase Memory Service; parse PDF/DOCX trong KB; OCR ảnh; group chat có kiểm soát; multi-agent cho workflow nặng; Zalo channel (OpenClaw hoặc adapter mới).

## 8. Test & evaluation

- **Unit (pytest):** chunking, fts query builder, rerank, path sanitize, zip validate, access state machine, rate limit, router classify (mock LLM), agent loop (mock LLM: kịch bản tool_calls → final; tool error → vẫn final; vượt budget), workflow parser (12 file workflow thật của KB phải parse ra ≥1 step, không crash), prompt assembly.
- **Integration:** ASGI test client cho toàn bộ endpoint matrix auth (bảng `04` §1.0 — mỗi ô đúng 200/401/404); upload→activate→search round-trip; webhook giả lập end-to-end với LLM mock.
- **Eval set (chạy tay ở M5, lưu `tests/eval/questions.yaml`):** 50 câu hỏi vàng — draft sẵn tại `docs/queo-solution/eval-questions-draft.yaml` (Duy điền TODO): q01–q20 nền tảng (factual/cross-doc/precise/negative/injection) + q21–q31 luồng sản phẩm + q32–q41 tiến độ/kế hoạch/highlight theo giai đoạn (test rule Loại 3: Jira → Confluence → Source Code) + q42–q50 key focus & đánh giá chất lượng (test load skill product-audit). Tiêu chí mỗi câu: đúng ý chính / có citation đúng file / không bịa / tuân thủ `expected_rule` nếu có. Đạt khi ≥ 80% và 2 câu injection không lộ system prompt. Các câu đánh dấu [PDF/XLSX-GAP] chỉ tính sau khi Duy chốt phương án (export .md hoặc kéo parse pdf/xlsx lên v1).

## 9. Rủi ro chính & đối sách

| Rủi ro | Khả năng | Đối sách |
|---|---|---|
| Model MaaS tool-calling yếu → agent loop kém | Trung bình | Probe sớm (M1, tiêu chí chặn); JSON mode dự phòng; thiết kế tool ít & schema phẳng dễ gọi; được phép đổi model bất kỳ lúc nào qua Settings |
| Model BETA (Qwen 3.5/3.7) đổi version/ngừng đột ngột; chất lượng tiếng Việt lệch nhau giữa các model | Trung bình | Model Router (02 §7.1): profile đo lại được bất kỳ lúc nào, routing đổi nóng qua admin, fallback chain tự cứu lượt đang chạy; không hardcode model name trong code |
| KB lớn/lẫn file rác → index chậm, search nhiễu | Trung bình | exclude list chuẩn ngay từ `pack_kb.sh`; giới hạn size; search-test trong admin để tune; metadata product/area thu hẹp phạm vi |
| FTS5 với tiếng Việt không dấu/sai dấu | Thấp-TB | `remove_diacritics 2` (query không dấu vẫn match); rerank alias sản phẩm; phase 2 thêm embeddings |
| Container ephemeral mất state | Chắc chắn xảy ra khi redeploy | S3 snapshot/restore là yêu cầu bắt buộc trước go-live (M5) |
| Workflow viết cho Cowork không chạy 1:1 trên server | Trung bình | mapping quy ước (02 §5.2); chọn 2-3 workflow chạy tốt làm chuẩn M4; workflow ghi-KB disable mặc định |
| Quota/chi phí MaaS | Trung bình | rate limit + budgets + bảng `llm_calls` theo dõi; model lite cho việc rẻ |
| Telegram chặn webhook (downtime) | Thấp | runbook §6; polling là phương án thoát hiểm tạm thời |
| Sync Agent trên máy Duy chết / máy tắt → KB server cũ dần | Trung bình | sync-status hiển thị "last sync" trên dashboard + `/status`; cảnh báo vàng khi >48h không sync; fallback upload .zip thủ công luôn sẵn |
| Google Drive placeholder/online-only làm scan lỗi | Thấp-TB | Sync Agent skip file đọc lỗi + log; quiet period gom đợt; hướng dẫn Duy bật "available offline" cho folder Wealth Solution |
| Ingress AgentBase giới hạn request body < zip full (~1GB) | Trung bình | test thực tế ở M3 với zip thật; bị chặn → (a) upload full lần đầu bằng `--no-media` của pack_kb.sh (loại svg/png, zip còn ~vài trăm MB) rồi để auto-sync delta bù dần, hoặc (b) bổ sung chunked-upload endpoint (chia part ≤50MB, server ghép) — quyết định khi có số đo |
| FTS index 850k chunks: build lâu, DB 2-3GB | Chắc chắn | build nền + progress; content-addressed nên chỉ build full 1 lần đầu, về sau toàn delta; flavor runtime cần disk ≥ 20GB (KB 3 version hardlink + DB + artifacts) — ghi vào yêu cầu flavor ở §5 |
| Didi server không gọi được Confluence/GitLab nội bộ Zalopay (corp network) | **Cao** | rủi ro + đối sách chi tiết ở `07` §8 — verify NGAY đầu D4; fallback: crawl giữ local mode, server chỉ làm admin/vault |
