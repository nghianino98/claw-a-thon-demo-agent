# Code review vs thiết kế — 2026-06-11

> Đối chiếu 2 codebase hiện có với bộ thiết kế v1.3. Kết luận tổng: **không có gì chặn việc bắt đầu M0/D0**; có **1 sự cố bảo mật phải xử lý NGAY** ở Didi (trước cả khi code) và 1 quick-win nên làm trong 5 phút.

## A. Sự cố & việc phải làm ngay (trước khi dev)

| # | Mức | Phát hiện | Hành động |
|---|---|---|---|
| A1 | 🔴 **NGHIÊM TRỌNG** | `data/tasks.json` chứa **53 task với 53 `apiKey` plaintext** (Confluence/Jira/GitLab công ty) **đang được git track và đã push lên GitHub** (`github.com/duynq0211/Didi-Ai-Tool`, từ "Initial commit") cùng `data/history.json`, `data/workflows.json`, `data/data`. Repo hiện **private** (xác minh 404 không auth) nên chưa lộ công khai — nhưng secret đã rời máy và nằm vĩnh viễn trong git history | (1) **Revoke/rotate toàn bộ token** đang nằm trong tasks.json (Confluence API key, Jira API key, GitLab PAT — tạo lại trên từng hệ thống); (2) `git rm --cached data/*.json data/data` + thêm `data/` vào `.gitignore` (giữ `!data/.gitkeep` nếu muốn); (3) purge history bằng `git filter-repo --path data --invert-paths` rồi force-push (repo private ít người clone nên chi phí thấp); (4) kiểm tra GitHub repo Settings → không có fork/watcher lạ. Việc này độc lập với mọi milestone — làm hôm nay |
| A2 | 🟠 CAO | Didi đang chạy `next start --port 3001` **không có `-H`** → Next bind `0.0.0.0`: **ai cùng mạng LAN/VPN truy cập được tool không cần auth**, gọi được API crawl và đọc task (kèm apiKey) | Quick-win 1 dòng, không phá zero-regression: sửa `Start App.command` thêm `--hostname 127.0.0.1` vào lệnh `next start` (và `npm run dev -- --port ... --hostname 127.0.0.1`). Localhost dùng y như cũ |
| A3 | 🟡 TB | Docker image demo agent cũ đã push lên vCR **chứa `.knowledge_base.sqlite3`** (tri thức Wealth Solution nội bộ — cố ý theo thiết kế demo) | Khi Quéo go-live và demo ngừng dùng: xóa image/tag cũ trên vCR (`/agentbase-deploy` Part 4 có lệnh delete image) |

## B. Didi AI Tool vs thiết kế `07`

**Khớp thiết kế (xác nhận lại bằng code):** cấu trúc module đúng như `07` §1 mô tả; task shape đúng spec; daemon có mutex + atomic write + semaphore 3 process (nền tốt để thêm nhánh credentialRef); `.env` KHÔNG bị track (gitignore `.env*` đúng); 52/53 task đang bật auto-sync → hợp đồng zero-regression R4 (daemon chạy đúng lịch) là tiêu chí quan trọng nhất, đã có trong `07` §5.

**Lệch/bổ sung so với những gì `07` đã ghi (đã cập nhật vào `07`):**

| # | Phát hiện | Ảnh hưởng thiết kế |
|---|---|---|
| B1 | API thực tế nhiều route hơn: `knowledge-base/{crawl, tasks, test-connection, logs, open-folder, generate-diagram, generate-doc-prompt, generate-image}`, `workflows/{execute, tasks, email}` | `open-folder` (mở Finder) **vô nghĩa trên server** → AUTH_MODE=required ẩn/disable; `workflows/email` dùng nodemailer → server mode cần SMTP env (thêm vào D4); `generate-*` dùng Gemini → key phải là env server-side, không nhận từ client |
| B2 | `crawl/route.ts` nhận `apiKey` **từ request body** (browser gửi lên mỗi lần crawl) và truyền vào **process args** của Python (lộ qua `ps`) | Đúng bài toán vault D2 đã thiết kế (credentialRef + spawn bằng env) — không đổi thiết kế, xác nhận điểm sửa: `crawl/route.ts` + `syncDaemon.js` `runTask()` |
| B3 | Port range mặc định 3001–3001, có cơ chế tự build khi source mới hơn BUILD_ID, launchd autostart | D4 Dockerfile dùng `next start` chuẩn — không ảnh hưởng; giữ nguyên script local |

## C. Demo agent (`Claw-a-thon-demo-agent`) vs thiết kế

**Trạng thái:** 9/9 unittest pass; git sạch (`.env`, `.greennode.json`, `*.sqlite3` không track); `.env` đang có đủ LLM MaaS + Telegram config (bot token này sẽ **revoke** theo PRE-DEV #1 khi Quéo go-live).

**Vai trò theo thiết kế: reference-only** (`00` §3, `01` §7) — KHÔNG build tiếp trên codebase này. Các lệch chính (đều đã là lý do tồn tại của thiết kế mới, liệt kê để vibe agent không "tiện tay" copy nhầm):

| Demo đang làm | Thiết kế yêu cầu | Khi port code chú ý |
|---|---|---|
| RAG 1 lượt, không tool | Agentic loop 9 tool, native+JSON mode (`02`) | Không port `agent.py` |
| FTS5 chunk không lưu số dòng, không metadata | chunks content-addressed (path, file_sha) + start/end_line + product/area (`03` §2) | Port được **thuật toán chunking + rerank** trong `knowledge.py`, nhưng schema viết lại |
| Allowlist rỗng = **mở cho mọi người** | Default-deny tuyệt đối (`04` §2.1) | Port luồng approve/nút duyệt được, nhưng đảo default |
| KB bake vào Docker image | Upload/delta-sync + version (`03`) | Bỏ hẳn pattern index-lúc-build |
| stdlib http.server, threading | FastAPI + asyncio, 1 worker | Port `telegram.py` client + parse update (sạch, dùng được); header AgentBase convention giữ nguyên |
| Fact extraction regex (lưu lowercase) | LLM lite extraction (`02` §8) | Không port `extract_facts` |
| `temperature=0.8` hardcode | Bảng temperature theo mode trong `prompts.py` | — |

## D. Kết luận

1. **Thiết kế không cần đổi gì từ kết quả review code** — 2 phát hiện mới (A1, A2) là việc vận hành/sự cố, đã thêm vào PRE-DEV-CHECKLIST (mục 0) và `07`.
2. Thứ tự việc: **A1 (revoke + purge) → A2 (bind localhost) → M0/D0 như kế hoạch.**
3. Tổng trạng thái sẵn sàng: docs v1.3 final ✔; demo agent làm reference ✔; Didi đủ điều kiện làm nền platform sau khi xử lý A1/A2 ✔.
