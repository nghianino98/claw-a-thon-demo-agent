# Design review để code tiếp — v1.7, 2026-06-11

> Review toàn bộ thiết kế kỹ thuật trước khi vibe code tiếp. Tập trung trọng tâm Duy nêu: **KB lên GreenNode an toàn + luôn cập nhật + hiểu yêu cầu → tìm đủ nguồn → tổng hợp/suy luận chính xác**. Phần sau đánh giá agent/admin/kiến trúc còn lại. Kết: thiết kế **đủ chặt để code tiếp**; có 1 quyết định mới cần ghi nhận và vài điểm nhỏ cần lưu ý.

---

## A. TRỌNG TÂM — Vòng đời KB Wealth Solution

Đánh giá theo 4 tiêu chí Duy đặt ra. Mỗi tiêu chí: **cơ chế đã thiết kế → điểm mạnh → rủi ro còn lại**.

### A1. Đưa KB lên GreenNode AN TOÀN

**Đã có:** 2 đường nạp — Sync Agent delta-push (`03` §7) và upload .zip/chunked (`03` §3). Bảo vệ nhiều lớp:
- Secret không lọt vào KB: exclude list dùng chung (`pack_kb.sh` + server-side §3.1/§3.2 bước 2) chặn `.env*`, `*credentials*`, `*.sqlite3`, `.greennode.json`.
- Kênh sync: `SYNC_API_KEY` least-privilege (chỉ 3 endpoint, không đụng admin; rỗng→404); chống xóa nhầm hàng loạt (>30% file → từ chối); version + rollback + Telegram notify mỗi lần sync.
- Upload an toàn: stream xuống đĩa, chống zip-bomb/traversal/symlink, giới hạn size; áp cho cả full lẫn delta.
- Tại nguồn (máy Duy): file config chmod 600; máy sau NAT nên client-push là hướng đúng (không mở cổng vào máy).
- Trên đường truyền: HTTPS qua ingress AgentBase. State trên server: `/data` + S3 snapshot mã hóa-tại-bucket (vStorage).

**Rủi ro còn lại & khuyến nghị:**
- 🟡 **KB chứa source code + CS ticket = dữ liệu nội bộ nhạy cảm nằm trên image/volume GreenNode.** Đây là đánh đổi chấp nhận được (cùng hệ sinh thái VNG Cloud) nhưng nên: bật S3 bucket **private + chỉ IAM của runtime đọc được**; không để KB trong Docker image (xem mục C — code hiện đang nhúng, phải sửa).
- 🟡 Exclude list là *blocklist* — file secret dạng lạ vẫn có thể lọt. Khuyến nghị thêm ở M4d: bước index quét nhanh mẫu secret high-entropy (AWS key, `PRIVATE KEY`, JWT) → cảnh báo + skip file, ghi `kb_versions.notes`. (Rẻ, một regex pass.)

### A2. KB LUÔN ĐƯỢC CẬP NHẬT ĐỦ

**Đã có:** Sync Agent watch folder (debounce 300s) → delta theo sha256 manifest → auto-activate + notify; content-addressed nên chỉ index phần đổi (sync nhanh, không re-index cả GB); `--once` cho cron; `sync_state` + cảnh báo ">48h chưa sync" trên dashboard; boot tự restore S3 khi volume reset.

**Điểm mạnh:** manifest sha-based ⇒ phát hiện đúng cái đổi, idempotent, không phụ thuộc mtime đơn thuần. Hai nguồn sync (máy Duy + Didi server) cùng dùng 1 protocol.

**Rủi ro còn lại:**
- 🟡 Phụ thuộc Sync Agent sống trên máy Duy — đã có cảnh báo staleness, nhưng nên thêm: nếu `kb_sync_activate='auto'` mà sync lỗi liên tiếp N lần → Telegram báo owner ngay (không đợi 48h).
- 🟢 Google Drive online-only đã có đối sách (skip file lỗi đọc + khuyến nghị bật offline).

### A3. HIỂU YÊU CẦU → TÌM ĐỦ NGUỒN LIÊN QUAN

**Đã có (đây là phần được nâng cấp mạnh nhất — `03` §4):**
- **Hiểu ý:** Router phân loại intent + skill match; KB MAP (L3b) cho agent "bản đồ" workspace; query expansion lite bắc cầu Việt↔Anh; QUY TRÌNH TRA CỨU B1–B6 ép model yếu đi đủ bước.
- **Tìm đủ:** hybrid FTS5 (phrase→AND→OR + RRF) + `kb_grep` ripgrep cho định danh chính xác + `kb_list` khám phá; metadata `product`/`area` thu hẹp; rerank ưu tiên Fact cho câu sự cố; deep mode cho phép 24 bước/420s khi cần quét rộng.
- **Đối chiếu nguồn:** RULES ép đối chiếu `03. Fact` cho câu hành vi hệ thống; ưu tiên nguồn theo rule workspace.

**Rủi ro còn lại:**
- 🟠 **Chất lượng phụ thuộc model MaaS** (T1 trong §4.0b) — không thể đưa ngang Cowork/Antigravity bằng kiến trúc. Đối sách đúng: Model Router route câu khó sang model mạnh nhất + giao thức chẩn đoán bắt buộc (gắn nhãn lỗi trước khi sửa). Kỳ vọng cần thực tế.
- 🟡 Query expansion thêm 1 lite-call/câu (độ trễ + chi phí) — đã cache theo query; chấp nhận được, đo ở M4d.

### A4. TỔNG HỢP & SUY LUẬN CHÍNH XÁC

**Đã có:** context budget scale theo `ctx_window` model (nhồi được nhiều nguồn hơn); đọc đủ dải dòng (KB_READ 40k); rolling summary giữ mạch hội thoại dài; deep/`code` route sang model mạnh; TRUTH-mode chống bịa; trả lời theo vai trò người hỏi (§8.2).

**Rủi ro còn lại:**
- 🟠 Synthesis là tầng phụ thuộc model nhất. Đối sách: eval 50 câu (có nhóm cross-doc) + chấm mù A/B trước-sau ở M4d; nhãn `SYNTHESIS_WEAK` để biết có phải sửa bằng đổi model deep không.

**Kết luận trọng tâm:** vòng đời KB **thiết kế chặt, đủ để code**. Hai việc nên nâng: (1) secret-scan khi index (A1), (2) cảnh báo sync-fail sớm (A2). Trần chất lượng là model MaaS — đã có Model Router + giao thức đo để đẩy kịch trần.

---

## B. Đánh giá các phần còn lại

| Hạng mục | Trạng thái thiết kế | Lưu ý khi code |
|---|---|---|
| **Agent loop** (`02` §1) | Chặt: native+JSON+fallback, budget 2 mức, context trimming, ngân sách hữu hạn | Một lượt = một model (đã chốt) |
| **Tools** (`02` §3) | 9 tool, schema phẳng, path-sanitize, mọi tool bắt exception | Đủ; vision tool để phase 2 |
| **Guardrail bảo mật** (`02` §2.2 — MỚI) | 2 lớp: lọc tiền-LLM deterministic + chỉ thị LLM; câu từ chối chuẩn không leo thang | `config/guardrail.yaml` cần Duy điền mẫu thực tế; test cả true-positive lẫn false-positive (câu nghiệp vụ có chữ "bảo mật") |
| **Ẩn nguồn** (`02` §2.1/§2.3 — MỚI) | RULES #5/#6; citations vẫn machine-readable cho eval/audit | Thống nhất: text user KHÔNG có nguồn; `/invocations` + audit CÓ |
| **Role-persistence** (`02` §8.2 — MỚI) | Fact `role` hạng nhất, xuyên phiên, không hỏi lại | Extraction map enum role; persona đã có logic không hỏi lại |
| **Conversation context** (`02` §8.1) | reply/quote, session_state, rolling summary, segment | M4c |
| **Model Router** (`02` §7.1) | Profile-driven, routing hot-reload, fallback chain, budget | M4b; không hardcode model |
| **Workflow engine** (`02` §5) | Parser md, semaphore, cancel, queue, artifacts | M4 |
| **Slash command động + hot-reload** (`02` §6.1-6.2) | command_alias + registry_version + setMyCommands | M4 |
| **Admin (Didi headless)** (`04` §3, `07`) | RBAC 3 role + 2FA + IP allowlist + vault; agent chỉ REST + AGENT_ADMIN_TOKEN | D-series; xung đột A1 cũ (citations) nay đã hợp thức hóa thành thiết kế |
| **Telegram** (`04` §2) | default-deny, webhook 2 lớp, deep progress, /new, /deep | — |
| **Deploy/backup** (`05`, `03` §5) | AgentBase Custom Agent, S3 snapshot/restore, fail-fast prod | — |

**Nhất quán tài liệu:** đã rà — DDL/env/endpoint/section-ref khớp; persona giờ chốt ở `0002_seed.sql` (không qua migration); số step deep thống nhất 12/24. Không còn mâu thuẫn chặn.

---

## C. Hợp nhất với CODE-REVIEW repo `queo-solution-agent` (báo cáo trước)

Repo đang ở mức ~v1.0. Backlog để code tiếp, **đã hợp nhất** code-review cũ + thiết kế mới:

**Đợt 1 — vá an toàn (làm ngay, ~1 buổi):**
- P0-1: bỏ nhúng DB+KB vào Docker image → seed bằng S3/upload; `data/` vào `.dockerignore`; xóa image cũ trên vCR. *(liên quan A1)*
- P0-2: flip auth về default-deny khi thiếu `APP_ENV=production`.
- P0-3: `git init` + private repo + `.gitignore` chuẩn.

**Đợt 2 — đồng bộ quyết định mới vào code (~1 ngày):**
- A1✅ (đã chốt): ẩn nguồn — code đã làm đúng hướng; chỉ cần giữ `citations` machine-readable ở `/invocations` + audit.
- A2: persona chuyển từ 7 migrations (0003-0009) về `0002_seed.sql`; mọi thay đổi sau qua instructions API.
- Guardrail tiền-LLM + `config/guardrail.yaml` + câu từ chối chuẩn (`02` §2.2).
- Role-persistence: đảm bảo extraction lưu `role`, nạp L5 đầu, persona không hỏi lại (`02` §8.2).
- P1: AGENT_ADMIN_TOKEN + X-Acting-Role; bù admin API còn thiếu (`GET kb/{id}` poll trạng thái); bug `admin_restore` dùng sai `services.settings`; exclude server-side thêm secret patterns; xác minh `.svg` không index.

**Đợt 3 — tính năng mới theo milestone (~4-5 ngày):**
- M4 (workflow + slash động + hot-reload) → M4b (Model Router) → M4c (conversation context) → M4d (retrieval v2 + deep mode, **mở đầu bằng giao thức chẩn đoán 10 câu**).
- D-series (Didi platform) song song sau M2.

**Thứ tự đề xuất:** Đợt 1 → Đợt 2 → M4d (vì tác động chất lượng lớn nhất, đúng nỗi đau hiện tại) → M4b → M4c → M4 → D-series. *(M4d ưu tiên trước M4 vì chất lượng trả lời là vấn đề Duy quan tâm nhất; workflow/slash có thể sau.)*

---

## D. Việc cần Duy / quyết định mở
1. Điền `config/guardrail.yaml` mẫu chặn thực tế (mình để khung; Duy bổ sung case nội bộ Zalopay).
2. TODO trong eval-questions (mã ticket/feature thật) + thêm 2 ca role-persistence + 3 ca guardrail (true/false positive).
3. Chốt [PDF/XLSX-GAP] (PRE-DEV #7) — ảnh hưởng câu hỏi strategy/KPI.
4. Xác nhận: chấp nhận trần chất lượng synthesis = model MaaS (không bằng Cowork ở câu khó nhất), bù bằng deep mode + Model Router.
