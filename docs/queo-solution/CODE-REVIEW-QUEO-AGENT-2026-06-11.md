# Code review: `queo-solution-agent` vs thiết kế v1.3 — 2026-06-11

> Phạm vi: toàn bộ repo `/Users/lap16947/Lab/queo-solution-agent` (5.344 LOC Python, 32/32 pytest pass) đối chiếu bộ docs final v1.3. **Nguyên nhân gốc của đa số lệch: repo được code theo docs v1.0** (thiếu các bản cập nhật v1.1–v1.3 và `07-DIDI-INTEGRATION`). Docs trong repo đã được đồng bộ lên v1.3 trong đợt review này.

## Kết luận nhanh

Lõi hệ thống **làm đúng và khá tốt** (tương đương M0–M3 + một phần M3b/M4): agent loop native+JSON (kèm auto-fallback native→json — tốt hơn design), đủ 9 tool đúng tên, DDL content-addressed chuẩn `03` §2 (chunks_meta path/file_sha + kb_files + sync_state, search JOIN đúng version active), Telegram default-deny + duyệt owner + webhook 2 lớp secret + xử lý nền, workflow engine có semaphore/cancel/runs, delta-sync server-side, Dockerfile/env/requirements khớp. Sáng tạo hợp lệ: **chunked upload** (giải đúng rủi ro ingress đã dự báo ở `05` §9) và `/admin/api/answers`.

Nhưng có **3 vi phạm nguyên tắc phải sửa trước khi deploy tiếp (P0)**, **1 xung đột sản phẩm cần Duy chốt (A1)**, và **1 cụm tính năng v1.1–v1.3 chưa có (P2)**.

## P0 — Sửa trước lần deploy kế tiếp

| # | Phát hiện | Bằng chứng | Việc cần làm |
|---|---|---|---|
| P0-1 | 🔴 **DB thật + KB zip bị nhúng vào Docker image**: boot copy `/app/data/queo.sqlite3` + `/app/data/wealth_kb.zip` vào STATE_DIR; `.dockerignore` cố tình giữ 2 file này | `main.py` lifespan (`boot_copy_bundled_db_*`); `.dockerignore` chỉ loại `data/kb,uploads,backups,artifacts` | Vi phạm ADR-3 + nguyên tắc `00` §5 (#2,#7) và lặp lại đúng cái demo bị chê. Nghiêm trọng hơn: `queo.sqlite3` là DB runtime local (messages/facts/audit thật của Duy) nằm trong image trên vCR. Sửa: bỏ cơ chế bundled; seed bằng S3 restore (đã có) hoặc upload sau deploy; thêm `data/` (toàn bộ) vào `.dockerignore`; **xóa các image/tag cũ trên vCR** |
| P0-2 | 🟠 **Auth mở khi `APP_ENV` ≠ production**: agent/admin auth trả về "cho qua" nếu key rỗng và env không phải production | `app/web/auth.py` (`return settings.app_env != "production"`) | Quên set `APP_ENV=production` trên runtime ⇒ toàn bộ API + admin mở toang. Flip mặc định: chỉ bypass khi `APP_ENV=development` **tường minh**, mặc định từ chối + log cảnh báo |
| P0-3 | 🟠 **Repo không có git** | không có `.git/` | Mất version control/rollback code. `git init` + push private repo; `.gitignore` phải cover `.env*`, `.env.production` (đang chứa secrets thật trên đĩa), `data/`, `.greennode.json`, `.venv` |

## A — Xung đột sản phẩm cần Duy chốt (code đã cố ý làm khác docs)

**A1. Citation bị TẮT hoàn toàn ở câu trả lời:** persona hiện hành (migration 0009) + `TRUTH_RULES` trong `prompts.py` (điều 6 tự thêm) **cấm hiển thị mọi trích dẫn nguồn/tên file** cho user. Xung đột trực tiếp: `00` §5 nguyên tắc #3 (TRUTH-mode), `02` §2.1 (RULES là phần hardcode "không cho sửa"), `03` §6 (format citation), `04` §2.3 (footer 📚 Nguồn), và **tiêu chí chấm eval 50 câu** ("có citation đúng file").
→ Đề xuất hợp thức hóa (giữ trải nghiệm Duy muốn, giữ kiểm chứng được): citations **luôn thu thập machine-readable** (`AgentReply.citations` — code vẫn đang trả về ở `/invocations` ✓) + setting `show_citations` (default `off` cho Telegram, `on` cho API) + eval chấm trên `AgentReply.citations` thay vì text. Nếu Duy đồng ý: cập nhật 4 chỗ docs trên + bỏ điều 6 khỏi phần "bắt buộc", chuyển thành hành vi theo setting.

**A2. Persona được quản lý bằng 7 migrations (0003→0009) UPDATE đè version 1:** sai cơ chế — migrations chỉ dành cho schema; instructions có versioning + rollback qua admin API (`04` §1.2) nhưng không được dùng. Hệ quả: không rollback persona, không audit, lịch sử giả. Sửa: gộp nội dung 0009 thành seed mới trong `0002_seed.sql`, xóa 0003–0009, mọi thay đổi sau này đi qua `POST /admin/api/instructions`. (Nội dung persona mới — thêm CEO/CFO/FA/OP, visualization Telegram, brand Zalopay — là tiến hóa TỐT, cần chép ngược vào `02` §2.1.)

## P1 — Lệch docs final, sửa trong sprint hiện tại

| # | Thiếu/lệch | Theo docs |
|---|---|---|
| P1-1 | Auth admin vẫn `ADMIN_API_KEY` (header X-Admin-Api-Key); audit actor cứng `'admin-api'` | ADR-2 v3: `AGENT_ADMIN_TOKEN` (Bearer) + `X-Acting-User/Role` + check role defense-in-depth + actor `didi:<username>` (`04` §1.0) |
| P1-2 | Admin API mới phủ ~50%: thiếu `GET kb` + `GET kb/{id}` (poll trạng thái upload nền — gap thực dụng nhất), `PATCH/POST skills|workflows`, `POST workflows/{id}/run`, `GET runs*`/cancel/artifacts, `GET/PATCH settings` (model `SettingPatch` đã khai báo nhưng không có route), `POST access/{tg_id}`, `GET instructions` + activate (rollback) | `04` §1.2 |
| P1-3 | Bug runtime: `admin_restore` dùng `services.settings` — dataclass `Services` không có field này → AttributeError khi restore qua API | sửa thành `request.app.state.settings` |
| P1-4 | Server-side exclude thiếu pattern secrets: `EXCLUDED_NAMES` chỉ có `.DS_Store`, `.greennode.json` — thiếu `.env*`, `*credentials*`, `*.sqlite3` trong khi KB chứa `03. Fact/Source Code` | `03` §3.1 (danh sách EXCLUDES là "chuẩn duy nhất" dùng cả server-side) |
| P1-5 | Không thấy danh sách INDEXABLE extensions trong `kb.py` → khả năng index cả `.svg` (~20k file design) gây nhiễu + phình DB. Cần xác minh: `grep -n "suffix\|ext" app/services/kb.py` quanh hàm index | `03` §3.2 (svg không index nội dung) |
| P1-6 | `GET /admin/api/kb/manifest` chỉ nhận sync auth — docs cho phép cả admin | `04` §1.2 |

## P2 — Tính năng v1.1–v1.3 chưa có (làm theo milestone còn lại)

1. **Slash command động + hot-reload** (`02` §6.1–6.2): chưa có `command_alias`, `show_in_menu` (DDL skills/workflows thiếu 2 cột), `registry_version`, `setMyCommands`. → Đây chính là yêu cầu "/monthly-report-generate" Duy đã chốt.
2. **Scheduler cron cho workflow** (M4): `croniter` có trong requirements nhưng không được dùng.
3. **Sync Agent client** (`03` §7.4 — M3b phía máy Duy): thiếu `scripts/queo_sync.py` + launchd plist (server-side delta đã sẵn sàng).
4. Lệnh Telegram đối chiếu `04` §2.2 khi làm mục 1 (bổ sung `/skills /workflows /runs /kb_activate`… nếu thiếu).

## Thứ tự đề xuất

`P0-1 → P0-2 → P0-3` (1 buổi) → Duy chốt **A1** → `A2 + P1-*` (1 ngày) → `P2-1 → P2-2 → P2-3` (theo M4/M3b, ~2 ngày). Docs v1.3 đã được copy vào repo — vibe agent làm tiếp phải đọc từ `docs/queo-solution/` bản này.
