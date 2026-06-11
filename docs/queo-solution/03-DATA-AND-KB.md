# 03 — Data model & Knowledge Base

## 1. Bố cục STATE_DIR (`/data`)

```
/data
├── queo.sqlite3              # toàn bộ state quan hệ + FTS (WAL mode)
├── kb/
│   ├── versions/
│   │   ├── 1/                # bản giải nén KB version 1
│   │   └── 2/
│   └── current -> versions/2 # symlink atomic (os.replace trên symlink tạm)
├── artifacts/<run_id>/…      # output workflow
├── uploads/tmp/              # zip đang xử lý (xóa sau khi xong)
└── backups/                  # snapshot tar.zst trước khi đẩy S3
```

Boot sequence (lifespan): tạo cây thư mục → nếu DB không tồn tại và `S3_ENDPOINT` set → thử restore snapshot mới nhất (xem §5) → chạy migrations → load config → reload Skill/Workflow registry từ `kb/current` (nếu có) → start scheduler + (dev) polling.

## 2. Schema SQLite — DDL chuẩn (migration `0001_init.sql`)

```sql
PRAGMA journal_mode=WAL;

-- ====== cấu hình & instruction ======
CREATE TABLE settings (            -- key-value, ConfigService cache trong RAM, reload khi đổi
  key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE TABLE instructions (        -- system prompt lớp persona (và các block tương lai)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,              -- 'persona'
  content TEXT NOT NULL,
  version INTEGER NOT NULL,        -- tăng dần theo name
  active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, created_by TEXT,
  UNIQUE(name, version)
);                                  -- "sửa" = insert version mới + chuyển active; rollback = active bản cũ

-- ====== skill & workflow ======
CREATE TABLE skills (
  skill_id TEXT PRIMARY KEY,       -- 'audit/product-audit'
  name TEXT NOT NULL, description TEXT NOT NULL,
  triggers TEXT NOT NULL DEFAULT '',       -- 'audit|rà soát chất lượng|checklist v6'
  command_alias TEXT UNIQUE,       -- slash command động: 'product-audit' → user gõ /product-audit (02 §6.1)
  show_in_menu INTEGER NOT NULL DEFAULT 1, -- có đăng ký vào menu lệnh Telegram (setMyCommands) không
  source TEXT NOT NULL CHECK(source IN ('kb','admin')),
  kb_path TEXT,                    -- đường dẫn SKILL.md trong KB (source='kb')
  content_override TEXT,           -- NULL = đọc từ file
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, updated_by TEXT
);
CREATE TABLE workflows (
  workflow_id TEXT PRIMARY KEY,    -- 'product-audit'
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
  command_alias TEXT UNIQUE,       -- 'monthly-report-generate' → user gõ /monthly-report-generate
  show_in_menu INTEGER NOT NULL DEFAULT 1,
  source TEXT NOT NULL CHECK(source IN ('kb','admin')),
  kb_path TEXT, content_override TEXT,
  schedule TEXT,                   -- cron expr hoặc NULL
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL, updated_by TEXT
);
-- command_alias: tự sinh khi sync/tạo = slug đoạn cuối của id (lowercase, [a-z0-9_-], ≤32 ký tự,
-- đụng độ → thêm hậu tố -2); admin sửa được. Alias nằm trong CÙNG một không gian tên cho cả
-- skills lẫn workflows — UNIQUE liên bảng enforce ở tầng service khi ghi.
CREATE TABLE workflow_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  workflow_id TEXT NOT NULL,
  trigger TEXT NOT NULL CHECK(trigger IN ('telegram','admin','schedule','api')),
  triggered_by TEXT,               -- user_id
  params TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
  log TEXT NOT NULL DEFAULT '[]',  -- JSON array step records {step, started, ended, summary, tool_calls}
  artifacts TEXT NOT NULL DEFAULT '[]',
  started_at TEXT, finished_at TEXT, created_at TEXT NOT NULL
);
CREATE INDEX idx_runs_status ON workflow_runs(status, created_at);

-- ====== hội thoại & memory ======
CREATE TABLE messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL, session_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL, created_at TEXT NOT NULL,
  tg_message_id INTEGER,             -- id tin Telegram tương ứng (user: của tin đến; assistant: khúc đầu sendMessage trả về)
  reply_to_tg_message_id INTEGER     -- user reply vào tin nào (NULL nếu không reply)
);
CREATE INDEX idx_messages_session ON messages(user_id, session_id, id);
CREATE INDEX idx_messages_tg ON messages(tg_message_id);

-- Conversation context (02 §8.1) — migration đánh số kế tiếp của repo:
CREATE TABLE session_state (
  user_id TEXT NOT NULL, session_id TEXT NOT NULL,
  segment_no INTEGER NOT NULL DEFAULT 1,
  segment_started_message_id INTEGER NOT NULL DEFAULT 0,
  summary TEXT NOT NULL DEFAULT '',           -- tóm tắt cuốn chiếu của segment (≤ SUMMARY_MAX_CHARS)
  summary_upto_message_id INTEGER NOT NULL DEFAULT 0,
  active_skill TEXT, active_skill_expires_at TEXT,
  last_run_id INTEGER,
  pending_question TEXT,                      -- câu bot đang chờ user trả lời
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, session_id)
);
CREATE TABLE tg_anchors (                     -- neo tin Telegram đặc biệt → ngữ cảnh giàu khi user reply
  tg_message_id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('artifact','run_progress')),
  ref_id INTEGER NOT NULL,                    -- run_id
  created_at TEXT NOT NULL
);
CREATE TABLE facts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(user_id, key, value)
);

-- ====== Telegram access (default-deny) ======
CREATE TABLE telegram_access (
  user_id INTEGER PRIMARY KEY,     -- Telegram numeric id
  chat_id INTEGER, display_name TEXT, username TEXT,
  status TEXT NOT NULL CHECK(status IN ('pending','allowed','rejected','revoked')),
  approved_by TEXT, note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);

-- ====== KB ======
CREATE TABLE kb_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,   -- = tên thư mục versions/<id>
  status TEXT NOT NULL CHECK(status IN ('processing','ready','active','failed','archived')),
  uploaded_by TEXT, original_filename TEXT,
  file_count INTEGER, chunk_count INTEGER, total_bytes INTEGER,
  skill_count INTEGER, workflow_count INTEGER,
  error TEXT, notes TEXT,
  created_at TEXT NOT NULL, activated_at TEXT
);
CREATE VIRTUAL TABLE chunks_fts USING fts5(
  path, title, product, area, content,
  tokenize="unicode61 remove_diacritics 2"
);
-- Chunk store là CONTENT-ADDRESSED theo (path, file_sha) — KHÔNG theo kb_version.
-- Lý do (quy mô thật ~1,1GB text ≈ 800-900k chunks): nếu chunk gắn version thì mỗi
-- version mới phải re-insert toàn bộ FTS (re-tokenize cả GB, mất nhiều phút mỗi lần
-- auto-sync). Content-addressed ⇒ version mới chỉ index đúng phần file thay đổi;
-- version nào dùng chunk nào suy ra từ kb_files (path → sha256).
CREATE TABLE chunks_meta (
  rowid_fts INTEGER PRIMARY KEY,    -- rowid của chunks_fts
  path TEXT NOT NULL,
  file_sha TEXT NOT NULL,
  start_line INTEGER, end_line INTEGER, mtime TEXT
);
CREATE INDEX idx_chunks_file ON chunks_meta(path, file_sha);
-- phase 2 (đã chừa sẵn, chưa dùng):
CREATE TABLE chunk_embeddings (rowid_fts INTEGER PRIMARY KEY, model TEXT, vector BLOB);

-- Model Router (02 §7.1) — ghi bởi scripts/profile_models.py, migration đánh số kế tiếp của repo:
CREATE TABLE model_profiles (
  model TEXT PRIMARY KEY,
  tool_native INTEGER, tool_json INTEGER,
  vn_score REAL, long_ctx_score REAL, code_score REAL,
  latency_p50_ms INTEGER, ctx_window INTEGER,
  probed_at TEXT, notes TEXT
);

-- ====== vận hành ======
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,             -- 'tg-123', 'admin', 'system'
  action TEXT NOT NULL,            -- 'message_in','message_out','kb_upload','kb_activate','kb_rollback',
                                   -- 'skill_update','workflow_run','access_approve','access_revoke',
                                   -- 'instruction_update','settings_update','login_fail','denied_access'
  target TEXT, detail TEXT,        -- detail = JSON, KHÔNG chứa secret
  created_at TEXT NOT NULL
);
CREATE INDEX idx_audit ON audit_log(action, created_at);
CREATE TABLE llm_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model TEXT, purpose TEXT,        -- 'agent','router','facts'
  prompt_tokens INTEGER, completion_tokens INTEGER, latency_ms INTEGER,
  run_id INTEGER, user_id TEXT, created_at TEXT NOT NULL
);
CREATE TABLE rate_limits (         -- sliding window đơn giản
  user_id TEXT NOT NULL, window_start TEXT NOT NULL, count INTEGER NOT NULL,
  PRIMARY KEY(user_id, window_start)
);
```

Migration `0002_seed.sql`: insert persona mặc định (xem `02` §2.1), settings mặc định.

### 2.1. DDL tài khoản admin + RBAC — **TRIỂN KHAI TẠI DIDI** (`data/didi.sqlite3`, milestone D0 — xem `07` §3.1)

> ADR-2 v3: agent headless, KHÔNG chạy migration này. DDL dưới đây là spec chuẩn cho DB của Didi (đặc tả hành vi: `04` §4.2; mã hóa at-rest dùng `DIDI_APP_SECRET`).

```sql
CREATE TABLE admin_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,           -- ^[a-z0-9._-]{3,32}$
  password_hash TEXT NOT NULL,             -- scrypt (hashlib stdlib): "scrypt$<n>$<r>$<p>$<salt_b64>$<hash_b64>"
  role TEXT NOT NULL CHECK(role IN ('superadmin','operator','viewer')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  totp_secret TEXT,                        -- NULL = chưa bật 2FA (mã hóa at-rest bằng key dẫn xuất từ DIDI_APP_SECRET)
  must_change_password INTEGER NOT NULL DEFAULT 1,
  failed_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,                       -- khóa tạm sau 5 lần sai
  last_login_at TEXT, last_login_ip TEXT,
  created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE admin_sessions (
  token_hash TEXT PRIMARY KEY,             -- sha256(session token); token gốc CHỈ nằm trong cookie
  user_id INTEGER NOT NULL REFERENCES admin_users(id),
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_seen_at TEXT,
  ip TEXT, user_agent TEXT
);
CREATE INDEX idx_admin_sessions_user ON admin_sessions(user_id, expires_at);
CREATE TABLE admin_tokens (                -- personal access token cho script/CI (tùy chọn)
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES admin_users(id),
  name TEXT NOT NULL,
  token_hash TEXT UNIQUE NOT NULL,         -- sha256; plaintext chỉ hiển thị 1 lần lúc tạo
  expires_at TEXT NOT NULL,                -- bắt buộc, tối đa 90 ngày
  last_used_at TEXT, revoked INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
```

Ghi chú: (a) **không có bảng permissions** — quyền là map cố định role→action trong code (`04` §4.2.2), đơn giản và không thể bị sửa runtime; (b) khóa mã hóa/ký dẫn xuất từ `DIDI_APP_SECRET` (≥32 random); (c) bootstrap tài khoản đầu tiên: xem `04` §4.2.4 (áp dụng cho Didi); (d) Didi có thêm bảng `credentials` (per-user vault) — DDL tại `07` §3.2.

## 3. KB upload pipeline (KBService)

### 3.1. Đóng gói phía máy Duy — `scripts/pack_kb.sh`

```bash
#!/usr/bin/env bash
# usage: ./pack_kb.sh "/path/to/Wealth Solution" [output.zip]
# zip -r với exclude chuẩn — danh sách này là CHUẨN DUY NHẤT, server cũng dùng đúng danh sách này
EXCLUDES=(".git/*" ".next/*" ".obsidian/*" ".vscode/*" ".sixth/*" "*/venv/*" "*/node_modules/*"
          "*/__pycache__/*" ".DS_Store" "*/.DS_Store" "*.sqlite3" "*.pyc"
          "*.env" "*/.env*" "*credentials*" ".greennode.json" "*/.greennode.json")
# Danh sách này dùng chung cho: pack_kb.sh, queo_sync.py (§7.4) và server-side filter (§3.2 bước 2)
# Option --no-media: thêm "*.svg" "*.png" "*.jpg" vào EXCLUDES (zip nhỏ hơn nhiều, dùng khi
# ingress giới hạn body — media sẽ được auto-sync delta đẩy bù dần sau)
cd "$1" && zip -r "${2:-wealth-kb.zip}" . -x "${EXCLUDES[@]}"
```

### 3.2. Xử lý phía server — `POST /admin/api/kb/upload` (multipart)

1. **Validate zip:** size ≤ `KB_UPLOAD_MAX_MB` (default 2000 — KB thật nén còn ~0,5-1GB); là zip hợp lệ; chống zip-bomb (tổng uncompressed ≤ 5× limit, ≤ 80.000 entries); chống path traversal (`..`, đường dẫn tuyệt đối → reject). Upload stream xuống đĩa (không giữ trong RAM).
2. **Extract** vào `kb/versions/<n+1>/`, áp lại exclude list (phòng zip đóng không chuẩn) + bỏ file > `KB_FILE_MAX_MB` (default 20).
3. **Index từng file** theo đuôi:
   - Text indexable: `.md .markdown .txt .csv .json .yaml .yml .html .py .js .ts .tsx .go .sql .gs .sh` → chunk & ghi FTS. **Chỉ index file có (path, sha256) chưa có trong chunk store** (content-addressed — xem chú thích DDL §2): upload full lần sau và delta sync chỉ tốn công index phần thay đổi.
   - **`.svg` (≈20k file design export): KHÔNG index nội dung** (XML path data là nhiễu) — chỉ xuất hiện qua `kb_list`/`kb_grep` theo tên file.
   - Giữ nguyên không index (chỉ phục vụ `kb_read`/`kb_list` ở dạng thông báo "file nhị phân"): `.png .jpg .pdf .xlsx .docx .pptx` (v1 không OCR/parse — ghi vào notes của version để biết; phase 2 có thể parse pdf/docx).
   - Khác → bỏ qua, đếm vào `skipped`.
   - Sau khi ghi `kb_files`: **GC chunk mồ côi** — xóa `chunks_fts`/`chunks_meta` có (path, file_sha) không còn được version nào đang giữ tham chiếu.
4. **Chunking (kế thừa demo, đã chứng minh ổn):** tách theo đoạn văn; chunk ≤ 1400 chars; đoạn dài → cửa sổ trượt overlap 180; `title` = heading `#` đầu tiên trong 40 dòng đầu hoặc đường dẫn; **ghi thêm `start_line`/`end_line`** vào `chunks_meta` (mới so với demo — phục vụ citation + `kb_read` theo dòng).
5. **Gắn metadata từ đường dẫn:** `area` = objective|context|fact|skill|knowledge|agents (theo thư mục gốc `01.`–`05.`/`.agents`); `product` = match tên thư mục con với enum sản phẩm (`05. Knowledge/MMF/**` → `MMF`; `03. Fact/CS Ticket/FD/**` → `FD`; không match → '').
6. **Reload registries:** quét `.agents/skills/**/SKILL.md` + `.agents/workflows/*.md` của version mới → upsert bảng `skills`/`workflows` (source='kb'; giữ nguyên các override + enabled flags hiện có theo `skill_id`).
7. Ghi `kb_versions` → `status='ready'`. Upload không tự activate.
   7b. Tính sha256 từng file giữ lại → ghi manifest vào `kb_files` (phục vụ auto-sync §7).
8. **Activate** (`POST /admin/api/kb/{id}/activate`): swap symlink `kb/current` (atomic), set version cũ `archived`, version mới `active`; dọn version ngoài `KB_KEEP_VERSIONS=3` (xóa thư mục + `kb_files` của version đó, rồi GC chunk mồ côi); trigger backup S3.
9. **Rollback** = activate version `archived` còn trên đĩa.

Upload xử lý trong background task; UI poll `GET /admin/api/kb/{id}` đến khi `ready|failed`. Mọi bước ghi audit.

## 4. Retrieval — đánh giá công nghệ & pipeline

### 4.0. Đánh giá lựa chọn công nghệ (trên số liệu thật của KB)

**Yêu cầu:** mỗi lượt chat, agent phải "quét được" toàn bộ folder Wealth Solution để trả lời. **Quy mô thật (đo 2026-06-10):** ~53.000 file sau exclude; ~1,1GB text ≈ **~300 triệu tokens** — gấp ~2.000 lần context window 128k. ⇒ Không tồn tại phương án "đọc cả folder mỗi câu hỏi"; bài toán bắt buộc là **retrieval**: chọn đúng vài chục KB nội dung liên quan đưa vào context. Các phương án:

| Phương án | Cách hoạt động | Ưu | Nhược (với KB này) | Kết luận |
|---|---|---|---|---|
| **A. FTS5 keyword index** (SQLite, BM25) | index trước ~850k chunks; query → top-k ms | nhanh (ms), zero hạ tầng thêm, scale GB tốt, tiếng Việt ổn với `remove_diacritics 2` | trượt khi từ khóa không trùng (hỏi "rút tiền chậm" vs tài liệu viết "redemption delay"); index phải sync với file | ✅ **chọn — đường recall chính** |
| **B. Agentic live-scan** (agent tự `kb_list`/`kb_grep`/`kb_read` như Claude Code) | không index; agent điều hướng cây thư mục + grep trực tiếp mỗi câu | luôn fresh 100%; chính xác tuyệt đối cho lookup định danh (ISSUE-1234, transID, tên hàm, chuỗi lỗi); tận dụng cấu trúc thư mục 01→05 rất chuẩn của workspace | một mình nó thì chậm & đốt token (mỗi câu 5-10 vòng tool); 53k file khiến `kb_list` mò mẫm nếu không có gợi ý | ✅ **chọn — đường chính xác, bổ trợ A** (ripgrep quét 1,1GB <1s) |
| **C. Vector embeddings / semantic search** | embed 850k chunks + embed query → cosine top-k | bắt được ngữ nghĩa khác từ khóa; tốt cho hỏi đáp tự nhiên | cần embedding model trên MaaS (chưa xác nhận có); embed 850k chunks = chi phí + thời gian đáng kể mỗi lần sync; cần sqlite-vec/FAISS; chất lượng embedding tiếng Việt phải eval riêng | ⏩ **phase 2** — bảng `chunk_embeddings` đã chừa; chỉ làm khi eval M5 cho thấy A+B trượt nhiều câu semantic |
| **D. RAG framework ngoài** (LlamaIndex/LangChain + vector DB) | framework lo pipeline | nhanh lúc đầu | thêm dependency nặng, khó kiểm soát từng bước, vẫn cần giải quyết C; ngược nguyên tắc phụ thuộc mỏng | ❌ loại |

**Quyết định (ADR-9 v2): A + B hybrid ngay từ v1, C ở phase 2.** Cách phối hợp trong agent loop: `kb_search` (FTS) là phát súng đầu để khoanh vùng → model tự quyết định `kb_grep` khi cần khớp chính xác chuỗi/mã, `kb_list` khi cần khám phá cấu trúc, `kb_read` để đọc sâu trước khi trả lời. System prompt mô tả rõ "vũ khí nào cho việc gì" (L3) — đây chính là cơ chế "agent scan folder mỗi lần hỏi đáp", nhưng có index dẫn đường để mỗi câu chỉ tốn 2-5 tool call thay vì hàng chục.

**Hệ quả vận hành đã xử lý trong thiết kế:** (1) index lần đầu ~1,1GB mất vài-chục phút → chạy nền, có progress (§3.2); (2) chunk store content-addressed để sync delta không phải re-index cả KB (§2); (3) svg/binary không index nội dung (§3.2); (4) `02. Context` chiếm ~50k file — metadata `area`/`product` + path prefix giúp thu hẹp phạm vi cả search lẫn grep.

### 4.0b. Chẩn đoán quality gap so với Cowork/Antigravity (review thực chiến 2026-06-11)

Duy ghi nhận: cùng câu hỏi, Quéo (bản code hiện tại) trả lời kém hơn Claude Cowork / Antigravity trỏ thẳng vào folder. Nguyên nhân tách thành 3 tầng — **phải chẩn đoán trước khi sửa** (xem giao thức ở cuối):

| Tầng | Nguyên nhân | Sửa được đến đâu |
|---|---|---|
| **T1. Model** | Cowork = Claude frontier, Antigravity = Gemini frontier; Quéo = open model MaaS — kém hơn rõ ở agentic search nhiều bước, suy luận tổng hợp, tiếng Việt nuance | Thu hẹp bằng Model Router (M4b): route `agent`/`deep` sang model mạnh nhất theo probe (GPT-5 là ứng viên gần frontier nhất trên MaaS, có budget/ngày). Không kỳ vọng ngang bằng 100% ở câu synthesis khó |
| **T2. Context architecture** | (a) `CONTEXT_BUDGET_CHARS=48000` ≈ ~13k token — quá nhỏ so với window 128k+ của model (Cowork dùng 200k); (b) agent **không có bản đồ KB** trong prompt — Cowork thấy cây thư mục + rules + index ngay từ đầu nên đi thẳng đến đúng file, Quéo phải mò bằng kb_list tốn step; (c) budget tool result/read quá chặt làm agent đọc được ít | **Sửa được hoàn toàn — tác động lớn nhất/chi phí rẻ nhất:** (a) đặt budget theo `model_profiles.ctx_window` (≈60% window × 4 chars/token; 128k window → ~300k chars), nâng `TOOL_RESULT_MAX_CHARS`→24000, `KB_READ_MAX_CHARS`→40000 cho model window lớn; (b) thêm layer **KB MAP** vào system prompt (02 §2 L3b); (c) deep mode 2 mức bước/timeout (02 §1.2: standard 12 / deep 24) cho câu cần nhiều nguồn |
| **T3. Retrieval primitive** | FTS5 query dạng `OR` mọi token → nhiễu nặng trên 850k chunks (token phổ thông match khắp nơi); không khử stopword tiếng Việt; chunk cắt phẳng 1400 chars mất ngữ cảnh heading; không bắc cầu Việt↔Anh ("rút tiền"↔"redemption") | Pipeline v2 (§4.1) — sửa được phần lớn |

**Giao thức chẩn đoán (bắt buộc làm TRƯỚC khi code M4d):** chạy 10 câu eval subset trên hệ thật, xem trace tool-call từng câu (qua `/admin/api/answers` + audit), gắn nhãn lỗi từng câu: `RETRIEVAL_MISS` (search không ra nguồn đúng) / `READ_MISS` (ra nguồn nhưng không đọc/đọc thiếu) / `SYNTHESIS_WEAK` (đọc đủ nhưng tổng hợp kém) / `MODEL_WEAK` (loop lạc hướng, tool-call sai). Tỷ lệ nhãn quyết định ưu tiên: RETRIEVAL_MISS → T3; READ_MISS → T2(b,c); SYNTHESIS_WEAK/MODEL_WEAK → T1+T2(a). Ghi kết quả vào `IMPLEMENTATION_NOTES.md`.

### 4.1. Pipeline `kb_search` v2 (nâng cấp 2026-06-11 — thay bản OR-only cũ)

```
chuẩn hóa: lower, strip; BỎ STOPWORDS tiếng Việt (là, của, có, không, được, cho, và, các, những,
           thì, mà, này, đó, như, từ, với, về, theo, trong, khi…) + tiếng Anh (the, a, of, in…);
           giữ tối đa 12 token có nghĩa
mở rộng truy vấn (model lite, 1 call, cache theo query): sinh ≤3 biến thể — dịch thuật ngữ
           Việt↔Anh ("rút tiền trước hạn"→"early redemption", "kỳ hạn"→"tenor"), viết lại
           theo từ vựng tài liệu; lỗi/timeout → bỏ qua, dùng query gốc
chiến lược match theo bậc (dừng ở bậc đầu tiên có ≥3 hit, chạy cho TỪNG biến thể):
  B1. PHRASE: "cụm nguyên văn" (FTS5 phrase query) — chính xác nhất
  B2. AND:    token1 AND token2 AND token3 (các token còn lại sau stopword)
  B3. OR:     như cũ — lưới vét cuối
hợp kết quả các biến thể bằng RRF (reciprocal rank fusion, k=60)
        (FTS5 MATCH trên chunks_fts,
        JOIN chunks_meta → JOIN kb_files kf ON (meta.path=kf.path AND meta.file_sha=kf.sha256)
        WHERE kf.kb_version = <active>)
nếu args.product → thêm điều kiện cột product = X (soft: không có kết quả → bỏ filter, thử lại)
nếu args.area    → tương tự với cột area
lấy top (top_k × 5) theo bm25 → rerank:
    -10 điểm  nếu product alias xuất hiện trong cả query và path/title
              (alias map: fd|fixed deposit, mmf|money market, fi|fixed income, ccq|chứng chỉ quỹ|fund,
               insurance|bảo hiểm, stock|chứng khoán, crypto, fs hub, fs profile)
    -5 điểm   nếu area='fact' và query chứa từ nhóm sự-cố: lỗi|bug|issue|ticket|sự cố|error|fail
    -3 điểm   chunk thuộc file có mtime mới hơn (decay theo tháng, tối đa -3)
sort tăng dần, cắt top_k, trả {path, breadcrumb, snippet(400), score, lines:"Lstart-Lend"}
        — NHÓM THEO FILE khi nhiều chunk cùng file (1 entry/file + các dải dòng), đỡ tốn context
```

**Chunking v2** (sửa §3.2 bước 4): cắt theo **heading markdown** thay vì cắt phẳng — mỗi chunk mang `breadcrumb` = `tên file > H1 > H2` ghép vào đầu nội dung chunk khi index (vd `"FD - Product Knowledge Base > Rút tiền > Rút trước hạn\n…"`); section dài hơn 1400 chars mới cắt cửa sổ trượt như cũ. Chunk tự mang ngữ cảnh → BM25 match tốt hơn và model đọc snippet hiểu ngay nó nằm ở đâu. (File không phải markdown: giữ cách cũ.)

Trả kèm hướng dẫn cho model (chuỗi cố định cuối kết quả): `"Dùng kb_read(path, start_line, end_line) để đọc đầy đủ trước khi khẳng định."`

## 5. Backup & restore (BackupService — bật khi có `S3_ENDPOINT`)

- **Snapshot:** nén `queo.sqlite3` (qua `VACUUM INTO` ra file tạm để nhất quán) + `kb/versions/<active>` + `artifacts/` (tùy `BACKUP_INCLUDE_ARTIFACTS=0/1`) thành `backups/queo-<utc-ts>.tar.zst` → upload `s3://{S3_BUCKET}/queo-backups/`. Trigger: sau kb_activate, sau mỗi `BACKUP_INTERVAL_HOURS=24`, và nút "Backup now" trong admin. Giữ `BACKUP_KEEP=7` bản trên S3 (xóa bản cũ).
- **Restore:** boot thấy DB trống + S3 cấu hình → tải bản mới nhất, giải nén vào STATE_DIR, log rõ ràng. Restore thủ công: `POST /admin/api/backup/restore {key}` (chỉ khi không có run đang chạy).
- S3 client: `boto3` với `endpoint_url=S3_ENDPOINT` — tương thích VNG vStorage hoặc bất kỳ S3 service nào. Không có S3 → tính năng tắt, cảnh báo vàng trên dashboard "state sẽ mất khi redeploy".

## 6. Quy ước citation

- **KHÔNG hiển thị nguồn trong câu trả lời cho user** (Duy chốt 2026-06-11 — xem `02` §2.1 RULES #5, §2.3). Telegram không render footer nguồn; câu trả lời là văn bản tự nhiên.
- `AgentReply.citations` = danh sách path duy nhất đã `kb_read`/`kb_search`-hit, vẫn được thu thập machine-readable: trả trong `/invocations`, ghi `audit_log` của `message_out`, dùng chấm eval. Chỉ là không đưa ra text user.

## 7. KB Auto-sync (ADR-3 v2) — Sync Agent trên máy Duy + delta API

> Yêu cầu: folder `Wealth Solution` trên máy Duy thay đổi bất kỳ ⇒ KB trên server tự cập nhật, không cần thao tác tay. Máy Duy sau NAT nên server không pull được — **client push** là kiến trúc bắt buộc. Upload .zip thủ công (§3) giữ nguyên làm đường fallback và cho lần khởi tạo.

### 7.1. Schema bổ sung — migration `0003_kb_sync.sql` (làm ở M3b; agent chỉ có 3 migration: 0001 init, 0002 seed, 0003 kb_sync)

```sql
ALTER TABLE kb_versions ADD COLUMN kind TEXT NOT NULL DEFAULT 'full'
  CHECK(kind IN ('full','delta'));
ALTER TABLE kb_versions ADD COLUMN base_version INTEGER;     -- delta áp lên version nào
ALTER TABLE kb_versions ADD COLUMN change_summary TEXT;      -- JSON {"added":n,"modified":n,"deleted":n}

CREATE TABLE kb_files (                  -- manifest từng version (nguồn so sánh delta)
  kb_version INTEGER NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime TEXT NOT NULL,
  PRIMARY KEY (kb_version, path)
);

CREATE TABLE sync_state (                -- 1 dòng, trạng thái sync gần nhất (hiển thị dashboard)
  id INTEGER PRIMARY KEY CHECK(id = 1),
  last_sync_at TEXT, last_client_host TEXT, last_result TEXT, last_error TEXT
);
```

`kb_files` được ghi cho **mọi** version (kể cả upload full ở §3 — bổ sung bước 7b vào pipeline §3.2: tính sha256 từng file đã index/giữ lại, ghi `kb_files`).

### 7.2. API sync (auth bằng `SYNC_API_KEY` — header `X-Sync-Api-Key`)

Key riêng, **chỉ** mở được 3 endpoint dưới đây (least privilege — không đụng được admin). `SYNC_API_KEY` rỗng ⇒ cả 3 endpoint trả 404 (tính năng tắt).

| Method/Path | Body | Trả về |
|---|---|---|
| `GET /admin/api/kb/manifest` | — | `{kb_version, files: {path: {sha256, size}}}` của version **active** |
| `POST /admin/api/kb/delta` | multipart: `meta` (JSON, xem dưới) + `archive` (zip chứa file added/modified, đường dẫn tương đối) | `201 {kb_version_id}` xử lý nền; `409` nếu `base_version` ≠ active hoặc đang có version `processing`; `413` nếu vượt ngưỡng → client chuyển full upload |
| `GET /admin/api/kb/sync-status` | — | `sync_state` + version active + cảnh báo |

`meta` JSON:

```json
{
  "base_version": 13,
  "client_host": "Duy-MacBook",
  "deleted": ["02. Context/Jira/MMF/OLD-123.md"],
  "added_modified": ["05. Knowledge/MMF/MMF.md", "..."],
  "client_manifest_sha": "<sha256 của manifest client sau thay đổi — server verify sau khi áp>"
}
```

### 7.3. Server áp delta (KBService.apply_delta — chạy nền như upload)

```
1. Khóa sync (chỉ 1 delta/lúc). Validate: base_version == active; zip qua các bước validate §3.2-1
   (size ≤ KB_DELTA_MAX_MB=100, chống zip-bomb/traversal/symlink); mọi path trong meta đi qua sanitize + exclude list.
2. Tạo kb/versions/<n+1>/ bằng HARDLINK toàn bộ cây từ version active (os.link từng file — rẻ, copy-on-write thủ công).
3. Áp thay đổi: ghi đè/thêm file từ archive (ghi file MỚI rồi os.replace — không sửa inode cũ
   để không phá version trước); xóa file trong `deleted`.
4. Index incremental (content-addressed — §2): chỉ re-chunk + index các file added/modified
   có (path, sha256) chưa có trong chunk store. File không đổi KHÔNG đụng tới (kb_files trỏ
   tới chunk cũ). File deleted: không index, GC mồ côi xử lý sau khi version cũ bị dọn.
5. Ghi kb_files cho version mới (sha256: tính mới cho added/modified, copy từ version cũ cho phần còn lại);
   đối chiếu tổng manifest với client_manifest_sha → lệch ⇒ status='failed', báo lỗi để client tự fallback full upload.
6. Reload Skill/Workflow registry nếu delta đụng `.agents/skills/**` hoặc `.agents/workflows/**`.
7. Activate theo policy `kb_sync_activate` (settings):
   - 'auto' (mặc định): activate ngay (swap symlink) + Telegram cho owner:
     "🔄 KB sync: +a ~m −d file → v<n+1> (active). Nguồn: <client_host>."
   - 'review': dừng ở status='ready' + Telegram: "KB v<n+1> chờ duyệt — /kb_activate <n+1> hoặc vào Admin."
     (thêm lệnh owner /kb_activate <id> vào 04 §2.2)
8. Cleanup version cũ theo KB_KEEP_VERSIONS (hardlink nên dung lượng thực tế chỉ tăng theo phần thay đổi).
   Backup S3 sau activate (nếu bật) — debounce 1 lần/giờ để tránh bão snapshot.
```

### 7.4. Sync Agent phía máy Duy — `scripts/queo_sync.py`

Self-contained (Python ≥3.10, dependency duy nhất: `watchdog`; cài: `pip3 install watchdog`). Config tại `~/.queo-sync.env` (chmod 600): `QUEO_SERVER_URL`, `SYNC_API_KEY`, `KB_DIR`, `QUIET_SECONDS=300`, `FULL_THRESHOLD=2000`.

```
Vòng đời:
  startup → load local manifest cache (~/.queo-sync.manifest.json)
  watch KB_DIR (FSEvents qua watchdog), áp EXCLUDE list giống hệt pack_kb.sh
  có event → đánh dấu dirty, reset đồng hồ quiet period
  yên lặng đủ QUIET_SECONDS →
      scan: với mỗi file, nếu (size, mtime) đổi so cache → tính lại sha256 (fast-path, không hash cả KB)
      GET /kb/manifest → diff với manifest local:
          added/modified = sha khác hoặc server thiếu; deleted = server có mà local không
      không lệch → ngủ tiếp
      lệch ≤ FULL_THRESHOLD file → zip phần added/modified → POST /kb/delta → poll sync-status đến khi xong
      lệch >  FULL_THRESHOLD hoặc server trả 409/413/manifest-mismatch 2 lần → log "cần full upload"
          + (nếu chạy interactive) gọi pack_kb.sh và in hướng dẫn upload
      cập nhật manifest cache khi server báo thành công
  modes: `--watch` (mặc định, daemon), `--once` (scan-diff-push 1 lần, dùng cho cron), `--dry-run` (chỉ in diff)
Retry: mạng lỗi → backoff 30s/2m/10m, không bỏ event (dirty flag còn đó). Log: ~/.queo-sync.log (rotate 5MB).
```

Chạy nền bằng launchd: `scripts/com.queo.sync.plist` (KeepAlive=true, RunAtLoad=true) → `launchctl load ~/Library/LaunchAgents/com.queo.sync.plist`. Không muốn daemon → cron/Cowork scheduled task gọi `--once` mỗi 15 phút.

### 7.5. Edge cases & quyết định

| Tình huống | Xử lý |
|---|---|
| Google Drive "online-only" placeholder (file chưa tải về máy) | scan đọc qua FS bình thường — macOS File Provider tự tải khi đọc; file lỗi đọc → skip + log warning, không fail cả batch |
| Drive đang sync dở / file đổi liên tục (save nhiều lần) | quiet period 300s gom thay đổi; file đổi giữa lúc scan → sha tính lại lần sync sau (dirty flag) |
| Đổi tên file/thư mục | = deleted + added (đúng ngữ nghĩa version, không cần xử lý riêng) |
| 2 máy cùng chạy Sync Agent | server khóa 1 delta/lúc + check base_version ⇒ máy sau bị 409, tự refetch manifest rồi diff lại (thường còn rất ít delta) |
| Delta đụng file đang được `kb_read` | không sao — version cũ còn nguyên trên đĩa (hardlink), agent loop đang chạy giữ path theo `kb/current` đã resolve lúc bắt đầu lượt |
| Xóa nhầm hàng loạt trên máy (vd Drive trục trặc) | ngưỡng an toàn: `deleted > 30%` tổng file ⇒ server từ chối (400, "quá nhiều file bị xóa — xác nhận bằng full upload"), tránh tự phá KB |
| Secret lọt vào KB (file .env trong Source Code…) | exclude list đã chặn pattern phổ biến (`.env*`, `*.sqlite3`, `credentials*`, `.greennode.json` — bổ sung vào EXCLUDES của pack_kb.sh & queo_sync); reminder trong RULES: agent không trích credentials (kế thừa nguyên tắc workflow knowledge-sync) |

