# Quéo Solution — Bộ tài liệu thiết kế hệ thống

> Agent AI cho Zalopay Wealth Solution: hỏi đáp knowledge base theo skill, tự chạy workflow đa bước, có admin tool cấu hình, hoạt động trên Telegram với bảo mật default-deny, deploy trên GreenNode AgentBase.

**Phiên bản:** 1.7 — 2026-06-11 (+Model Router M4b; +Conversation Context M4c; +Retrieval v2 & deep mode M4d; +ẩn nguồn khỏi câu trả lời `02` §2.1/§2.3; +Guardrail bảo mật từ chối tuyệt đối `02` §2.2; +Role-persistence `02` §8.2)
**Người duyệt:** Duy (duynq5@vng.com.vn)
**Trạng thái:** Approved for implementation

---

## 1. Bộ tài liệu này gồm gì

| File | Nội dung | Đọc khi nào |
|---|---|---|
| `00-README.md` | Tổng quan, quyết định kiến trúc, nguyên tắc bất biến | Luôn đọc đầu tiên |
| `01-ARCHITECTURE.md` | Kiến trúc tổng thể, component, luồng chính, repo skeleton | Trước khi viết code bất kỳ |
| `02-AGENT-CORE.md` | Agent loop, tool specs, skill system, workflow engine, prompts | Khi làm M1, M4 |
| `03-DATA-AND-KB.md` | Data model (DDL đầy đủ), KB upload/versioning/indexing/retrieval | Khi làm M1, M3 |
| `04-INTERFACES.md` | HTTP API reference, Telegram UX, Admin dashboard, Security spec | Khi làm M2, M3 |
| `05-DEPLOYMENT-AND-PLAN.md` | Env vars, Docker, deploy GreenNode, vận hành, milestones M0→M5, test plan | Khi làm M0 và mỗi khi kết thúc milestone |
| `06-PRODUCT-CONCEPT.md` | One-pager giới thiệu cho BTC/stakeholder | Không phải spec dev — chỉ để present |
| `07-DIDI-INTEGRATION.md` | Tích hợp Didi AI Tool: platform auth/RBAC/vault, module Agent Admin, zero-regression, milestones D0→D4 | Khi làm M3 (agent headless) và toàn bộ D-series |
| `PRE-DEV-CHECKLIST.md` | Input đã chốt với Duy (bot, owner id, S3, persona…) + việc còn thiếu | Đọc ở M0, cập nhật khi có input mới |
| `eval-questions-draft.yaml` | 50 câu hỏi vàng (draft, Duy điền TODO): 20 nền tảng + 30 câu flow/progress/focus_quality | Dùng ở M5 |

## 2. Cách dùng cho vibe coding agent

1. Đọc `00` + `01` để nắm khung. **Không tự ý đổi quyết định kiến trúc** ở mục 4 dưới đây.
2. Làm theo milestones trong `05-DEPLOYMENT-AND-PLAN.md` mục 7, theo đúng thứ tự M0 → M5. Mỗi milestone có acceptance criteria — phải pass hết mới chuyển milestone tiếp.
3. Mỗi khi cần chi tiết (schema, API contract, prompt, env var) → tra đúng file theo bảng trên. Tên bảng, tên endpoint, tên env var trong các file này là **chuẩn bắt buộc** — code phải khớp từng ký tự.
4. Khi deploy: dùng bộ skill `greennode-agentbase-skills/.claude/skills/` đã có sẵn trong repo demo (copy sang repo mới). Quy trình ở `05`, mục 5–6.
5. Khi gặp điểm tài liệu chưa nói rõ: chọn phương án đơn giản nhất không phá vỡ nguyên tắc mục 5, ghi chú lại trong `IMPLEMENTATION_NOTES.md` ở root repo mới.

## 3. Bối cảnh

- **Demo hiện tại** (`Claw-a-thon-demo-agent`, agent "Mây"): RAG 1 lượt (FTS5 → nhồi context → 1 lần gọi LLM), KB bake vào Docker image, không có tool-use, không workflow, không admin, allowlist Telegram mặc định **mở**. Tài liệu: `docs/SYSTEM_INTEGRATION.md`.
- **Khuyết điểm phải giải quyết:** không chạy được tác vụ đa bước; skill chỉ là context tĩnh; cập nhật KB phải rebuild image; không có nơi cấu hình; bảo mật chưa default-deny.
- **Knowledge base nguồn** (trên máy Duy, Google Drive sync): **TOÀN BỘ** folder `.../ZLP Workspace/Wealth Solution/` — không phải riêng `05. Knowledge`. Quy mô thực đo 2026-06-10: ~53.000 file sau exclude (~20k svg, ~19k md, ~9.6k code go/tsx/ts, ~1.2k png), ~1,1GB text. Cấu trúc:
  - `01. Objective/` (Business KPI, Monthly Report, Product KPI, Product Strategy)
  - `02. Context/` (Confluence, Contract, Daily Task, Design, Jira, Others, Shared Chat, Shared Email)
  - `03. Fact/` (CS Ticket, Data, Issue Investigation, Source Code) — **nguồn sự thật cao nhất**
  - `04. Skill/` (CS Report, Data Expert, Design)
  - `05. Knowledge/` (CCQ, Crypto, FD, FI, FS Hub, Insurance, MMF, Stock + `_Index.md`)
  - `.agents/rules/wealth-solution-rule.md` — rule chung
  - `.agents/skills/` — 14 skill dạng SKILL.md (Audit, Data, Design, General, Investigation, Report, Research)
  - `.agents/workflows/` — 12 workflow dạng markdown (morning-briefing, product-audit, cs-ticket-report, issue-investigate, knowledge-sync, market-research, competitor-teardown, …)
- **Hạ tầng:** GreenNode AgentBase (VNG Cloud). Runtime contract: container nghe cổng **8080**, có `GET /health` trả 200. LLM qua GreenNode MaaS, OpenAI-compatible: `https://maas-llm-aiplatform-hcm.api.vngcloud.vn/v1`. Tài liệu thao tác đầy đủ nằm trong `greennode-agentbase-skills/`.

## 4. Quyết định kiến trúc đã chốt (ADR) — KHÔNG ĐƯỢC TỰ Ý THAY ĐỔI

| # | Quyết định | Lựa chọn | Lý do | Bị loại |
|---|---|---|---|---|
| ADR-1 | Agent engine | **Agentic loop tự build** — Python, tool-calling chuẩn OpenAI trên GreenNode MaaS, có fallback JSON-mode cho model không hỗ trợ native function calling | Chạy được workflow đa bước; chủ động 100%; đúng yêu cầu dùng hạ tầng GreenNode | Claude Agent SDK (cần Anthropic key ngoài GreenNode); RAG 1 lượt (không đạt yêu cầu) |
| ADR-2 *(v3, 2026-06-11)* | Admin tool | **Didi AI Tool là admin console duy nhất** (module "Agent Admin" mới trong Didi, BFF proxy tới agent) **+ Telegram admin commands**. Agent **headless**: giữ nguyên REST `/admin/api/**`, bỏ UI; auth Didi↔agent bằng `AGENT_ADMIN_TOKEN` + `X-Acting-User/Role`. Hệ **tài khoản + RBAC 3 role + 2FA TOTP + IP allowlist** (spec `04` §4.2) **triển khai tại Didi**, bảo vệ cả module collect-resource cũ lẫn module Agent Admin mới. **Per-user credential vault** cho token Jira/Confluence/GitLab. Chi tiết: `07` | Duy muốn tận dụng nền tảng Didi sẵn có, vá luôn lỗ hổng token chưa phân quyền của Didi, một nơi quản trị duy nhất rồi deploy GreenNode cho team | UI Jinja2 trong agent (v2 — bị thay để khỏi maintain 2 console); 1 key tĩnh dùng chung (v1); SSO/OIDC (phase 2); shared token công ty (loại — sai danh tính, lộ quyền của Duy) |
| ADR-3 *(v2, 2026-06-10)* | KB sync | **Sync Agent tự động trên máy Duy**: daemon watch folder Wealth Solution → debounce → push **delta** lên server qua API riêng (`SYNC_API_KEY`), server tạo version mới + index incremental + (mặc định) auto-activate + báo owner qua Telegram. **Upload .zip qua Admin UI giữ làm fallback** thủ công. Chi tiết: `03` §7 | Duy yêu cầu mọi thay đổi trên folder máy phải tự đồng bộ; máy Duy nằm sau NAT nên client-push là hướng duy nhất không cần hạ tầng thêm | Git pull; bake vào image; server pull Google Drive API (OAuth tài khoản cá nhân phức tạp, polling latency, thêm secret bề mặt rộng) |
| ADR-4 | Hình thái deploy | **1 container duy nhất** (modular monolith) trên AgentBase **Custom Agent** runtime | Đơn giản nhất thỏa runtime contract; OpenClaw template không cho custom logic | Multi-service; OpenClaw |
| ADR-5 | Web framework | **FastAPI + uvicorn** (Python ≥3.12) | Async tốt cho webhook + background jobs; vibe coding agent nào cũng thạo | stdlib thuần (quá thủ công cho admin UI + upload) |
| ADR-6 | Lưu trữ | **SQLite (WAL)** tại `STATE_DIR=/data` cho toàn bộ state + **backup/restore snapshot lên S3-compatible storage (tùy chọn)** để sống sót qua redeploy | AgentBase container là ephemeral; S3 snapshot là lưới an toàn rẻ nhất | Postgres ngoài (thêm 1 hạ tầng); AgentBase Memory Service (để phase sau, đã chừa interface) |
| ADR-7 | Telegram nhận update | **Webhook** ở production (secret path + header `X-Telegram-Bot-Api-Secret-Token`), **long-polling** ở local dev (`TELEGRAM_MODE=polling`) | Webhook cần endpoint public — có sau khi deploy; polling cho dev không cần tunnel | Chỉ một mode |
| ADR-8 | Bảo mật truy cập bot | **Default-deny**: allowlist rỗng ⇒ KHÔNG ai chat được (chỉ owner). Mọi user mới phải được owner approve | Yêu cầu "bảo mật tuyệt đối" của Duy; demo cũ default-open là lỗ hổng | Default-open như demo |
| ADR-9 *(v2, 2026-06-10)* | Retrieval KB | **Hybrid**: (a) SQLite **FTS5** index toàn bộ KB (unicode61, remove_diacritics 2) + rerank rule-based — đường tìm nhanh; (b) **agentic live-scan tools** `kb_grep` (ripgrep) + `kb_list` + `kb_read` để agent tự quét file trực tiếp trong lượt chat — đường chính xác; (c) embeddings/vector là **phase 2** (đã chừa bảng). Đánh giá đầy đủ: `03` §4.0 | KB thật = **toàn bộ folder Wealth Solution**: ~53k file / ~1,1GB text (~300M tokens) — không thể nhét context, bắt buộc retrieval; FTS5 chứng minh scale ở cỡ GB; ripgrep quét 1GB <1s cho lookup chính xác (mã ticket, tên hàm, transID) mà keyword index có thể trượt | Vector DB ngay từ đầu (phụ thuộc embedding model MaaS chưa chắc có, +hạ tầng); chỉ agentic scan không index (chậm + đốt token); chỉ FTS (yếu với lookup chính xác & semantic) |
| ADR-10 | Skill & workflow format | **Giữ nguyên format hiện có** của workspace: SKILL.md (frontmatter name/description) và workflow markdown trong `.agents/workflows/`. Server đọc trực tiếp từ KB đã upload; admin có thể override/bật tắt qua DB | Không bắt Duy đổi cách làm việc; KB là source of truth | Format DSL mới |
| ADR-11 *(2026-06-11)* | Model Router | **Tự chọn model MaaS theo task class** (lite/agent/code/deep/vision) — thế mạnh model **đo bằng profile probe** lưu `model_profiles`, mapping nằm trong settings `model_routing` admin đổi nóng, có fallback chain + budget cho model đắt. Chi tiết: `02` §7.1, `05` §4 | MaaS có 5 model ENABLED thế mạnh khác nhau (MiniMax M2.5, Qwen 3.5 27B, Gemma 4 31B-IT, Qwen 3.7 Plus, GPT-5); model BETA đổi thường xuyên → không được hardcode giả định vào code | Hardcode model theo cảm tính (không kiểm chứng, gãy khi MaaS đổi); LLM tự chọn model mỗi step (lệch hành vi tool-calling, khó debug) |

## 5. Nguyên tắc bất biến (mọi dòng code phải tuân thủ)

1. **Default-deny ở mọi lớp.** Thiếu config bảo mật (API key, allowlist, webhook secret) ⇒ từ chối phục vụ hoặc fail-fast lúc khởi động ở chế độ production (`APP_ENV=production`), không bao giờ "mở tạm".
2. **Secret không bao giờ** xuất hiện trong: log, response API, error message, tài liệu, git. `.env`, `.greennode.json`, `STATE_DIR` đều nằm trong `.gitignore` + `.dockerignore`.
3. **TRUTH-mode khi trả lời từ KB:** mọi khẳng định về sản phẩm phải kèm nguồn (đường dẫn file trong KB). Không tìm thấy trong KB ⇒ nói rõ là không chắc chắn, không bịa. Khi nguồn mâu thuẫn: ưu tiên `03. Fact` > `02. Context` (theo rule trong `.agents/rules/wealth-solution-rule.md` của KB).
4. **Tiếng Việt là ngôn ngữ mặc định** của agent với user; thuật ngữ kỹ thuật giữ tiếng Anh.
5. **Mọi hành động admin và mọi message đều có audit log** (ai, làm gì, lúc nào). Nội dung message lưu trong DB nhưng không in ra log console.
6. **Idempotent & versioned:** KB upload, config change đều tạo version mới, có rollback. Không sửa đè không dấu vết.
7. **Agent chỉ đọc KB, không ghi.** Output của workflow ⇒ ghi vào `artifacts/`, gửi cho user dưới dạng file/báo cáo. Việc cập nhật KB gốc là việc của Duy trên máy (rồi upload bản mới).
8. **Mọi giới hạn đều phải hữu hạn và cấu hình được:** max agent steps, timeout, message length, upload size, rate limit. Không có vòng lặp/queue không chặn trên.

## 6. Thuật ngữ

| Từ | Nghĩa trong tài liệu |
|---|---|
| **Quéo** | Tên agent (persona trả lời trên Telegram) |
| **KB** | Knowledge base = bản chụp folder `Wealth Solution` được upload lên server |
| **Skill** | Gói hướng dẫn chuyên môn dạng SKILL.md, nạp động vào context khi câu hỏi khớp trigger |
| **Workflow** | Tác vụ đa bước định nghĩa bằng markdown, chạy bởi Workflow Engine (chuỗi agent-loop steps) |
| **Instruction** | System prompt lớp persona/rule, admin sửa được |
| **Owner** | Telegram user có quyền admin (duyệt user, chạy lệnh admin) |
| **MaaS** | GreenNode Model-as-a-Service, endpoint OpenAI-compatible |
| **AgentBase** | Nền tảng runtime của GreenNode để host container agent |
| **STATE_DIR** | Thư mục dữ liệu bền của container (mặc định `/data`) |


