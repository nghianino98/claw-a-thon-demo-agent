# Pre-dev checklist — input cần có trước khi vibe code Quéo Solution

> Trạng thái chốt với Duy ngày 2026-06-10. Vibe coding agent: đọc file này ở M0 để biết input nào đã sẵn, input nào phải hỏi.

| # | Input | Trạng thái | Ghi chú |
|---|---|---|---|
| **0** | **🔴 KHẨN: token công ty trong git Didi** | ⬜ **LÀM NGAY, trước mọi việc khác** | `data/tasks.json` (53 apiKey Confluence/Jira/GitLab plaintext) đã push lên GitHub private repo `duynq0211/Didi-Ai-Tool`. Việc: revoke/tạo lại toàn bộ token → `git rm --cached data/*.json data/data` + ignore `data/` → purge history (`git filter-repo`) → force push. Kèm quick-win: thêm `--hostname 127.0.0.1` vào `next start`/`next dev` trong `Start App.command` (app đang bind 0.0.0.0 ra LAN). Chi tiết: `CODE-REVIEW-2026-06-11.md` §A |
| 1 | Telegram bot | ✅ Dùng bot **hiện có** (bot của demo Mây) | KHÔNG cần tạo bot mới. **BẮT BUỘC trước go-live: regenerate token** qua BotFather (`/mybots` → bot → API Token → Revoke) vì token hiện tại đã từng được chia sẻ qua chat/cấu hình demo → coi như đã lộ. Token mới chỉ điền trực tiếp vào env trên AgentBase console — không ghi vào file/git/chat. Lưu ý: regenerate xong webhook cũ của demo Mây sẽ chết (chấp nhận — demo ngừng dùng). |
| 2 | Owner Telegram ID | ✅ `TELEGRAM_OWNER_USER_IDS=<telegram-user-id>` | Thêm owner khác sau qua env hoặc Admin UI |
| 3 | Backup S3 | ✅ Quyết định: **CÓ — dùng VNG vStorage (S3-compatible)** | Việc cần làm ở M5: tạo bucket trên VNG Cloud console (project HCM), lấy endpoint + access/secret key → điền `S3_ENDPOINT/S3_BUCKET/S3_ACCESS_KEY/S3_SECRET_KEY` vào env runtime |
| 4 | Persona Quéo | ✅ Đã chốt, ghi tại `02-AGENT-CORE.md` §2.1 | Trợ lý tri thức nội bộ toàn diện cho CEO, Business, Product, Developer, QE |
| 5 | Model MaaS | ⬜ CHƯA chốt | Làm đầu M1: `aip.sh models list` (model BTC đã bật) → chạy `scripts/probe_model.py` → ghi kết quả vào `IMPLEMENTATION_NOTES.md`. API key AI Portal do BTC cấp đã có (trong tài liệu BTC / `.env` demo — không chép vào docs) |
| 6 | Eval set 50 câu | 🟡 Draft sẵn tại `docs/queo-solution/eval-questions-draft.yaml` (20 nền tảng + 11 flow + 10 progress + 9 focus/quality) | Duy review + điền TODO (mã ticket/feature thật, đáp án chuẩn) trước M5; đặc biệt kiểm tra q09/q10 (CCQ, Stock — folder 05. Knowledge đang ít file) |
| 7 | Quyết định [PDF/XLSX-GAP] | ⬜ CHỜ DUY CHỐT | Product Strategy (.pdf/.docx), KPI & Audit Checklist (.xlsx) chưa index được ở v1 → chọn: (a) export thêm bản .md vào cùng folder (nhanh, 0 effort dev), hoặc (b) kéo parse pdf/docx/xlsx từ phase 2 lên v1 (+0,5-1 ngày dev). Ảnh hưởng q41, q42, q46 |
| 8 | KB lần đầu | ⬜ | M3: chạy `pack_kb.sh` trên máy Duy → upload qua Admin UI. Nếu ingress chặn body lớn → dùng `--no-media` (xem `05` §9) |
| 9 | Sync Agent trên máy Duy | ⬜ | M3b: cài `queo_sync.py` + launchd; cần `SYNC_API_KEY` sinh lúc deploy |
| 10 | Secrets sinh mới khi deploy | ⬜ | Agent: `AGENT_API_KEY`, `AGENT_ADMIN_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (≥32 hex), `SYNC_API_KEY`. Didi (D4): `DIDI_APP_SECRET`, `DIDI_BOOTSTRAP_PASSWORD` — sinh bằng `openssl rand -hex 32`, chỉ điền vào env runtime console; cặp bootstrap xóa khỏi env sau lần đăng nhập đầu |
| 11 | Danh sách user được allow ban đầu | ⬜ | Duy gom Telegram ID của team Wealth (CEO/Business/Product/Dev/QE) → seed `TELEGRAM_ALLOWED_USER_IDS` hoặc duyệt dần qua nút approve |
| 12 | Danh sách tài khoản admin + role (trên Didi) | ⬜ | Duy = superadmin (duy nhất, cài app TOTP như Google Authenticator). Ai được operator (vận hành KB/workflow + crawl)? Ai viewer? Cấp tài khoản qua trang Accounts của Didi sau D1. Kèm: CIDR VPN/văn phòng cho `DIDI_IP_ALLOWLIST` nếu có |
| 13 | Verify mạng: GreenNode → hệ thống nội bộ | ⬜ LÀM SỚM (đầu D4, có thể test trước bằng runtime demo) | 1 lệnh curl từ runtime tới `<internal-confluence-host>`. Không thông → crawl giữ local mode (kiến trúc đã chống sẵn — `07` §8), không blocker nhưng đổi kỳ vọng demo |

## Quy tắc secret (nhắc lại từ `00` §5)

- Không paste token/key vào chat, docs, git, log. Đã lỡ paste ở đâu → revoke/regenerate.
- Nơi duy nhất chứa secret production: phần env vars của runtime trên AgentBase console (+ `.env` local cho dev, gitignored).
