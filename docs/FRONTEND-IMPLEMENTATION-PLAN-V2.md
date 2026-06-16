# Frontend Implementation Plan V2 — Didi AI Tool & Agent Admin

> Bản này **review + điều chỉnh** `FRONTEND-IMPLEMENTATION-PLAN.md` (v1) sau khi đối chiếu với:
> - Thiết kế hệ thống Quéo Solution: `queo-solution/06-PRODUCT-CONCEPT.md`, `07-DIDI-INTEGRATION.md`, `04-INTERFACES.md §3/§4.2`, `Didi AI Tool Integration/PLAN-V3-OPUS.md`.
> - Hợp đồng backend: `docs/BACKEND-FRONTEND-HANDOFF.md`.
> - Source code Didi hiện tại (`src/app`, `src/components`, `src/lib`).
>
> Trọng tâm điều chỉnh theo yêu cầu: **(A) UI đúng chuẩn design system, (B) phân bố module hợp lý, (C) UX dễ dùng nhất.** Mọi thay đổi tuân thủ **hợp đồng zero-regression** (`07 §5`).

---

## 0. Mục tiêu hệ thống (để FE hiểu mình đang build cái gì)

**Quéo** là agent tri thức nội bộ cho team ZaloPay Wealth Solution (8 sản phẩm: MMF, FD, FI, CCQ, Insurance, Stock, FS Hub, FS Profile), chạy trên Telegram, trả lời có trích nguồn (TRUTH-mode) và chạy workflow/skill nghiệp vụ. Toàn bộ chạy trên GreenNode + MaaS LLM của VNG.

**Vai trò của Didi AI Tool (quyết định ADR-2 v3):** Didi là **admin console DUY NHẤT** của Quéo (agent bỏ UI, chỉ giữ `/admin/api/**`) **kiêm KB factory** (crawl Confluence/Jira/GitLab → đẩy vào KB agent). Để public cho team, Didi được "platform hóa" thêm 3 lớp nền: **Auth/RBAC**, **Credential Vault per-user**, **Server mode**.

Hai chế độ qua env `AUTH_MODE`:
- `off` — máy Duy, **không auth, hành vi 100% như hôm nay** (ràng buộc tối thượng).
- `required` — server GreenNode: bắt buộc login + 2FA, RBAC 3 role, vault, audit.

FE phải build sao cho: **server mode** mở khóa các module mới; **local mode** không hề thay đổi trải nghiệm cũ.

### Bản đồ module sau khi tích hợp

| Nhóm | Module | Mới/Cũ | Hiển thị |
|---|---|---|---|
| **Collector** (KB factory) | Tác vụ (crawl), Quy trình Didi, Nhật ký | Cũ — nâng cấp | Mọi mode |
| **Agent Admin** | Dashboard, Instructions, Skills, Workflows, Runs, Knowledge, Access, Audit, Settings | Mới | `required` + role ≥ viewer |
| **Quản trị hệ thống** | Accounts (quản lý user khác) | Mới | `required` + superadmin |
| **Tài khoản của tôi** | Hồ sơ & bảo mật, Credentials, Personal Tokens, Sessions | Mới | `required` + mọi role |
| **Auth** | Login, Change Password, Setup 2FA | Mới | Khi chưa đăng nhập / cần hành động |

---

## 1. Phát hiện chính từ review v1 (phải xử lý)

| # | Phát hiện | Tác động | Hướng xử lý |
|---|---|---|---|
| F1 | **Design system thực tế nằm inline trong page**, không nằm ở `components/ui` (button/card mặc định vẫn là shadcn `zinc-900`/đen). Các trang thật dùng token ZaloPay (`#0144DB`), `rounded-2xl`, page shell `bg-zalopay-bg`, tiêu đề `animate-slide-in-left`+`animate-heartbeat`. | 16 trang mới sẽ "trôi" khỏi look-and-feel nếu mỗi người tự style. `04 §3` yêu cầu rõ "đồng bộ look-and-feel với module Didi hiện có". | **Phase 0 bắt buộc**: chuẩn hóa token + dựng bộ UI kit dùng chung TRƯỚC khi làm trang (mục 2 & 3). |
| F2 | **Chưa có component dùng chung** cho Table / Tabs / Modal / Toast / Badge / EmptyState / Loading. Chỉ có button, card, input, textarea. | ≥8 trang cần bảng, ≥3 trang cần tab, có modal editor + toast "đã áp dụng". Thiếu kit → UI lệch nhau. | Dựng UI kit (mục 3). |
| F3 | **CSP server mode = `default-src 'self'`** (`04 §4.2.3`, asset tự host, không CDN). v1 đúng khi tự render QR, **nhưng** trang Settings hiện dùng `cdn.simpleicons.org` cho logo Confluence/Jira/GitLab → **sẽ vỡ ảnh ở server mode**. | Lỗi hiển thị + cảnh báo CSP console. | Tự host bộ icon brand (SVG nội bộ) + Field/icon dùng `lucide-react`. Xử lý trong Phase 0. |
| F4 | **`qrcode` KHÔNG có trong `package.json`** (v1 nói "đã khai báo"). | Trang setup-2FA build fail. | Thêm `qrcode` (hoặc tự encode QR bằng canvas, không CDN). Ghi rõ ở mục 6. |
| F5 | **Phân bố module sai chỗ ở phần "self-service".** RBAC (`04 §4.2.2`) cho **mọi role** tự quản: đổi pass, 2FA, **Personal Tokens**, **Credentials**. v1 nhét Personal Tokens vào trang `/accounts` (chỉ superadmin) và My Credentials vào Settings → viewer/operator không tới được token/cred của chính mình. | Operator/viewer **không thể** tạo token CI hay nhập credential của mình. Lỗi chức năng + IA khó hiểu. | Tách **"Tài khoản của tôi"** (mọi role) khỏi **"Accounts"** (superadmin quản user khác). Mục 4. |
| F6 | **Trùng tên "Workflows"** giữa Collector (Didi workflow, kéo–thả `@xyflow`) và Agent Admin (workflow của agent + cron). | User nhầm 2 khái niệm. | Đặt nhãn/scope rõ trong nav: "Quy trình" (Collector) vs "Agent · Workflows". Mục 4. |
| F7 | **Một số trang Agent Admin trong v1 lệch spec `04 §3`.** Dashboard v1 ghi "RAM/CPU" (API `/admin/api/status` không có); Settings v1 thiếu **khối Model Router** (`model_profiles` + `model_routing`); Knowledge v1 thiếu bảng versions (kind full/delta, chunks, change_summary) + ô **search-test** + khối **Auto-sync**. | Trang dựng thiếu/sai field thật. | Bám đúng `04 §3` cho từng trang. Mục 5. |
| F8 | **v1 chưa định nghĩa lớp xử lý lỗi/khởi tạo dùng chung** (loading / empty / 401→login / 403→read-only) dù `PLAN-V3-OPUS` yêu cầu "mỗi trang có loading/empty/401/403". | Mỗi trang tự xử lý → không nhất quán. | `apiFetch` wrapper + 4 state-component chuẩn (mục 3 & 7). |
| F9 | **State auth**: v1 dùng React Context riêng, trong khi dự án đã chuẩn hóa **zustand** (`i18n-store`, `settings-store`, `workflow-store`). | Lệch convention. | Dùng `auth-store.ts` (zustand) cho nhất quán; vẫn expose hook `useAuth()`. Mục 7. |

---

## 2. Chuẩn hóa Design Tokens (Phase 0 — làm trước)

Hiện `globals.css` mới có token màu thô (`--color-zalopay-*`). Bổ sung **lớp token ngữ nghĩa** để mọi component tham chiếu, tránh hardcode `#0144DB` rải rác.

#### [MODIFY] `src/app/globals.css`
Thêm vào `@theme inline` (giữ nguyên token cũ — additive):

```css
/* Semantic tokens */
--color-primary: #0144DB;          /* ZaloPay blue */
--color-primary-soft: #E8EEFE;     /* nền active (thay 'blue-50' tự chế) */
--color-surface: #FFFFFF;          /* card */
--color-surface-muted: #F4F5F7;    /* page bg = zalopay-bg */
--color-border: #E5E7EB;           /* zinc-200 */
--color-success: #16A34A;  --color-success-soft: #DCFCE7;
--color-danger:  #DC2626;  --color-danger-soft:  #FEE2E2;
--color-warning: #D97706;  --color-warning-soft: #FEF3C7;
/* Radii & elevation (chuẩn hóa: card 2xl, control xl) */
--radius-card: 1rem;       /* rounded-2xl */
--radius-control: 0.75rem; /* rounded-xl */
--shadow-card: 0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06);
```

**Quy ước (đưa vào doc cho cả team FE):**
- Page background = `bg-zalopay-bg` (đồng bộ với Settings; **sửa `layout.tsx` từ `bg-zinc-50` → `bg-zalopay-bg`** để toàn app nhất quán — đây là thay đổi thuần CSS, không ảnh hưởng logic).
- Card = `rounded-2xl border border-gray-200 bg-white shadow-sm`.
- Control (input/select/button) = `rounded-xl`.
- Màu nhấn/ô active = `--color-primary` + `--color-primary-soft` (bỏ thói quen `bg-blue-50` tùy biến).
- Trạng thái = success/danger/warning + biến `-soft` tương ứng.
- **Dark mode**: hiện app chạy light-only trên thực tế (page bg trắng/zalopay-bg). Quyết định: **khóa light mode cho các trang mới** (bỏ class `dark:` lạc lõng trong primitives) để tránh "nửa sáng nửa tối". Nếu sau này làm dark mode thì làm một lượt toàn app.

---

## 3. Bộ UI Kit dùng chung (Phase 0 — chặn F1, F2, F8)

Đây là phần **v1 thiếu** và là điều kiện tiên quyết để 16 trang mới đồng nhất. Dựng trong `src/components/ui/` (mở rộng thư mục có sẵn). Mỗi component bám token mục 2.

#### [MODIFY] `src/components/ui/button.tsx`
Thêm variant ZaloPay (giữ nguyên variant cũ để không phá vỡ chỗ đang dùng):
- `primary`: `bg-[--color-primary] text-white shadow-sm hover:opacity-90 active:scale-[0.98] rounded-xl`
- `soft`: nền `--color-primary-soft`, chữ primary (dùng cho action phụ — giống nút Test Connection hiện tại).
- Giữ `default/outline/ghost/destructive`; chuẩn hóa `rounded-xl`.

#### [NEW] Các primitive (single-file mỗi component)
| File | Mục đích | Dùng ở |
|---|---|---|
| `ui/page-shell.tsx` | `<PageShell>` + `<PageHeader title subtitle actions>` — gói sẵn shell `p-6 bg-zalopay-bg`, tiêu đề `animate-slide-in-left`/`animate-heartbeat`, slot nút bên phải. | **Tất cả** trang (kể cả refactor nhẹ trang cũ là tùy chọn). |
| `ui/field.tsx` | `<Field label icon hint error>` bao input/select — đúng style Settings (`rounded-xl bg-gray-50/30 focus:border-primary`). | Mọi form. |
| `ui/select.tsx` | Select đồng bộ Field. | Credential picker, filters. |
| `ui/data-table.tsx` | Bảng chuẩn: header sticky, zebra nhẹ, empty/loading slot, cột actions, responsive (scroll-x mobile, ẩn cột phụ). | Accounts, Sessions, Tokens, Runs, Audit, KB versions, Access, Skills, Workflows. |
| `ui/tabs.tsx` | Tab pill style primary-soft. | Accounts (3 tab), Access (3 tab), Tài khoản của tôi, Settings. |
| `ui/modal.tsx` + `ui/confirm-dialog.tsx` | Dialog (focus-trap, Esc, overlay) + confirm thao tác nguy hiểm (revoke, disable, rollback, delete). | Skill content editor, mọi action phá hủy. |
| `ui/drawer.tsx` | Panel trượt phải cho chi tiết Run (log realtime) mà không rời danh sách. | Runs. |
| `ui/toast.tsx` (+ `toast-store.ts` zustand) | Thông báo nổi; **bắt buộc** cho thông điệp hot-reload "✅ Đã áp dụng cho agent — có hiệu lực từ lượt chat kế tiếp". | Toàn bộ mutation. |
| `ui/badge.tsx` | Badge role (superadmin/operator/viewer) + status (run: running/done/error/cancelled; access: allowed/pending/rejected). Map sang token success/danger/warning. | Nhiều trang. |
| `ui/empty-state.tsx`, `ui/loading-state.tsx`, `ui/error-state.tsx` | 3 trạng thái chuẩn (empty/loading/403-read-only & 502-agent_unreachable). | Mọi trang (F8). |
| `ui/markdown-editor.tsx` | Wrapper quanh `@uiw/react-md-editor` (đã có trong deps) — editor + preview cho Instructions & Skill content_override. **Không thêm lib mới.** | Instructions, Skills. |
| `ui/role-gate.tsx` | `<Can role="operator">…</Can>` ẩn control theo role (tiện dụng, **không thay** enforcement ở API). | Mọi nút mutation. |
| `ui/copy-field.tsx` | Ô hiển thị-once + nút copy (temp password, plaintext token). | Accounts, Tokens. |

> Nguyên tắc: trang mới **chỉ ráp primitive**, không tự viết bảng/tab/modal. Reviewer reject PR nào hardcode màu `#0144DB`/`blue-50` ngoài token, hoặc tự dựng table/modal riêng.

---

## 4. Information Architecture & Điều hướng (chặn F5, F6)

### 4.1. Sidebar theo mode + role
#### [MODIFY] `src/components/layout/sidebar.tsx`
- Đọc `authMode`, `user.role` từ `useAuth()`.
- **Local mode (`off`)**: sidebar **y nguyên hôm nay** (Tác vụ / Quy trình / Nhật ký / Cài đặt), **không** hiện nhóm mới, **không** hiện account menu. (Bảo vệ zero-regression R2.)
- **Server mode (`required`)**: render theo nhóm có tiêu đề (section label), item lọc theo role:

```
COLLECTOR
  • Tác vụ            /knowledge-base      viewer+
  • Quy trình         /workflows           viewer+
  • Nhật ký           /history             viewer+

AGENT ADMIN                                (chỉ hiện server mode)
  • Dashboard         /agent-admin/dashboard      viewer+
  • Instructions      /agent-admin/instructions   viewer+ (sửa: operator+)
  • Skills            /agent-admin/skills         viewer+ (sửa: operator+)
  • Workflows         /agent-admin/workflows      viewer+ (sửa/run: operator+)
  • Runs              /agent-admin/runs           viewer+
  • Knowledge         /agent-admin/knowledge      viewer+ (mutate: operator+)
  • Access            /agent-admin/access         viewer+ (duyệt: operator+)
  • Audit             /agent-admin/audit          viewer+
  • Settings          /agent-admin/settings       superadmin (mutate)

HỆ THỐNG                                    (chỉ superadmin)
  • Accounts          /accounts
  • Cài đặt           /settings
```

- **Footer sidebar = Account menu** (thay block cứng "Didi / ZaloPay AI"): avatar (chữ cái đầu username) + username + **badge role**; click mở menu: *Tài khoản của tôi* (`/account`) · *Đăng xuất*. Local mode giữ nguyên block tĩnh cũ.
- Khử trùng tên (F6): nhóm "AGENT ADMIN" có section-label rõ; item "Workflows" của agent đặt trong nhóm này (khác "Quy trình" Collector). Cân nhắc icon riêng (agent: `Bot`; collector workflow: `Route`).

### 4.2. "Tài khoản của tôi" vs "Accounts" (sửa F5)
- **`/account`** — **mọi role** (self-service), gom 4 tab, đúng cột RBAC "Tự quản" (`me/*`, `tokens`, `credentials`):
  1. **Hồ sơ & Bảo mật**: đổi mật khẩu, trạng thái 2FA (+ nút bật/đặt lại 2FA → đi `/setup-2fa`).
  2. **Sessions**: phiên đang mở của **chính mình** (`GET /api/sessions`) + revoke từng phiên (`DELETE /api/sessions/:tokenHash`).
  3. **Credentials** (vault): Confluence/Jira/GitLab của mình — thêm/đổi/xóa; chỉ hiện nhãn "Đã cấu hình", không xem lại plaintext (`/api/credentials`). *(Đây là nơi v1 định để trong Settings — chuyển về đây để mọi role tới được.)*
  4. **Personal Tokens**: tạo/thu hồi PAT cho CI (`/api/tokens`), token plaintext hiện **một lần** qua `CopyField`. *(v1 để nhầm trong /accounts.)*
- **`/accounts`** — **superadmin** quản **user khác**: bảng users (username, role, status, 2FA, last login/IP), tạo user (temp password 1 lần), đổi role, disable/enable, reset password, reset 2FA; tab **All sessions** (`?all=1`) để thu hồi phiên người khác. **Bỏ** tab Personal Tokens khỏi đây (PAT là của cá nhân, nằm ở `/account`).

> Kết quả: viewer/operator có chỗ chuẩn để nhập credential & tạo token; superadmin có trang quản trị user gọn, không lẫn dữ liệu cá nhân.

---

## 5. Trang Agent Admin — bám đúng `04 §3` (sửa F7)

BFF: mọi trang gọi `GET/POST/PATCH/DELETE /api/agent-admin/<path>` (proxy sang `/admin/api/<path>`). Non-GET kèm `X-CSRF-Token` (do `apiFetch` tự gắn). RBAC ẩn control bằng `<Can>`, nhưng **luôn kỳ vọng 403 từ backend**. Mỗi trang dùng `loading/empty/error-state` chuẩn; `502 agent_unreachable` và `503 agent_admin_not_configured` hiển thị error-state riêng ("Agent chưa cấu hình / không kết nối được").

| Trang | Route | Nội dung đúng spec (điều chỉnh so với v1) | API |
|---|---|---|---|
| **Dashboard** | `/agent-admin/dashboard` | KPI cards: **model active, KB version active, số user Telegram allowed, run đang chạy, last backup, cảnh báo cấu hình**; bảng **10 audit mới nhất**; **usage LLM 7 ngày** (bảng/biểu đồ nhỏ từ `llm_calls`). **Bỏ "uptime/RAM/CPU"** (không có trong API). | `GET /status`, `GET /audit?limit=10` |
| **Instructions** | `/agent-admin/instructions` | `MarkdownEditor` (editor + preview) sửa persona; danh sách version + nút **Activate** (rollback). Hiện version đang active. Lưu → toast hot-reload. | `GET/POST /instructions`, `POST /instructions/{id}/activate` |
| **Skills** | `/agent-admin/skills` | `DataTable`: id, name, source (built-in/admin), **enabled toggle**, triggers (sửa inline), badge `show_in_menu`; nút **"Xem/Sửa nội dung"** → Modal `MarkdownEditor` cho `content_override` (nút xóa override = gửi `content_override:null`); field **`command_alias`** có **live-preview "user sẽ gõ: /alias"** + validate charset + bắt lỗi **409 alias trùng**. Nút **+ Skill mới**. Lưu → toast hot-reload. | `GET /skills`, `PATCH /skills/{id}`, `POST /skills` |
| **Workflows (agent)** | `/agent-admin/workflows` | Như Skills + cột **schedule (cron)** có helper mô tả ("mỗi ngày 07:00") + validate cron; nút **Run now** → tạo run rồi **mở Drawer/ό trang Runs** theo dõi; link sang Runs. | `GET/POST /workflows`, `PATCH /workflows/{id}`, `POST /workflows/{id}/run` |
| **Runs** | `/agent-admin/runs` | `DataTable` (run_id, workflow/skill, status badge, thời gian) + filter status; click → **Drawer chi tiết**: step log + tool calls (cuộn, **polling** cập nhật khi running — xem F-realtime), artifacts (nút tải), nút **Cancel** (confirm). | `GET /runs`, `GET /runs/{id}`, `POST /runs/{id}/cancel`, `GET /runs/{id}/artifacts/{file}` |
| **Knowledge** | `/agent-admin/knowledge` | (1) **Upload zip drag-drop** qua **chunked upload** (`kb/chunked/**`) + progress bar; (2) `DataTable` **versions**: status, **kind full/delta**, files, chunks, skills, workflows, change_summary, ngày + **Activate/Rollback** (confirm); (3) ô **search-test** chạy `kb_search` (query + product/area) hiện kết quả; (4) **khối Auto-sync**: trạng thái sync gần nhất (giờ/host/kết quả), toggle `auto`/`review`, hướng dẫn cài Sync Agent. *(v1 chỉ có upload + list — bổ sung 2,3,4.)* | `POST /kb/upload` (chunked), `GET /kb`, `POST /kb/{id}/activate`, `POST /kb/search-test`, `GET /kb/sync-status` |
| **Access** | `/agent-admin/access` | `Tabs` Allowed / Pending / Rejected-Revoked; mỗi dòng telegram user + nút **Approve/Reject/Revoke** (confirm) + ghi chú. | `GET /access?status=`, `POST /access/{tg_user_id}` |
| **Audit** | `/agent-admin/audit` | `DataTable` actor/action/target/IP/time; filter actor + action + khoảng thời gian; **phân trang** (`before=` cursor). | `GET /audit?action=&actor=&limit=&before=` |
| **Settings (agent)** | `/agent-admin/settings` | Form settings runtime **whitelist** (model, temperature, budgets, rate limit, backup) + nút **Backup now**; **khối Model Router** *(v1 thiếu)*: bảng `model_profiles` (kết quả probe) cạnh editor `model_routing` (class→model, fallback chain, deep budget) + nút **Re-run profile**; validate **409** khi gán model không pass tool-calling cho class `agent`/`code`. Mutate = **superadmin**. | `GET/PATCH /settings`, `POST /backup` |

**F-realtime (Runs):** handoff không nêu SSE/WebSocket. Mặc định **polling** `GET /runs/{id}` mỗi 2–3s khi status=running, dừng khi kết thúc. Ghi chú để backend xác nhận nếu sau này có stream.

---

## 6. Trang Auth & Platform

#### [NEW] `src/app/login/page.tsx`
- Layout 2 cột center, **không sidebar**; phong cách premium nhưng **CSP-safe** (font tự host Geist đã có; **không** ảnh/GIF từ CDN).
- Form: username + password; submit `POST /api/auth/login`. Nếu `{requiresOtp:true}` → hiện ô **OTP 6 số** (autofocus, chỉ digit, paste-split). 
- Xử lý mã lỗi theo handoff: `invalid_credentials` → "Sai thông tin đăng nhập" (không lộ user tồn tại); **423** → "Tài khoản tạm khóa" + đếm ngược tới `lockedUntil`; **429** → "Thử lại sau ít phút".
- Thành công → lưu `csrfToken` vào auth-store → điều hướng theo `nextStep`: `change_password` → `/change-password`; `setup_2fa` → `/setup-2fa`; `app` → `/knowledge-base`.

#### [NEW] `src/app/change-password/page.tsx`
- Mật khẩu hiện tại + mật khẩu mới + nhập lại; **thanh đo độ mạnh** + checklist policy (≥12 ký tự) validate client trước submit; map lỗi `password_policy`. `POST /api/auth/change-password`.

#### [NEW] `src/app/setup-2fa/page.tsx`
- `POST /api/auth/setup-2fa/start` → nhận `otpauthUrl` + `secret`.
- **Render QR client-side, không CDN**: thêm **`qrcode`** vào `package.json` (F4) và vẽ ra `<canvas>`/dataURL; hoặc tự encode. Kèm **secret dạng text + nút copy** để nhập tay (phòng khi không quét được).
- Ô nhập OTP xác nhận → `POST /api/auth/setup-2fa/verify` → vào app.

#### [NEW] `src/app/accounts/page.tsx`
- Superadmin-only (mục 4.2). 2 tab: **Users** (+ All sessions). Dùng `DataTable`, `CopyField` (temp password/reset), `ConfirmDialog` (disable/reset). API: `/api/accounts`, `/api/accounts/:id`, `/api/sessions?all=1`, `/api/sessions/:tokenHash`.

#### [NEW] `src/app/account/page.tsx`
- 4 tab self-service (mục 4.2): Hồ sơ & Bảo mật / Sessions / Credentials / Personal Tokens. API: `/api/credentials*`, `/api/tokens*`, `/api/sessions`, đổi-pass/2FA.

---

## 7. Lớp Auth state + Data fetching (chặn F8, F9)

#### [NEW] `src/lib/store/auth-store.ts` (zustand — đồng bộ convention dự án, thay Context thuần ở v1)
- State: `authMode`, `authenticated`, `user{id,username,role,mustChangePassword,hasTotp}`, `csrfToken`, `status: 'loading'|'ready'`.
- `bootstrap()` gọi `GET /api/me` 1 lần khi app load.
- Hook tiện dụng `useAuth()`, `useRole()`.

#### [NEW] `src/components/layout/auth-wrapper.tsx`
- Bọc trong `layout.tsx` (body). Gọi `bootstrap()`.
- **Local mode (`off`)**: passthrough **ngay lập tức**, không màn loading, không gating — giữ R2/R6.
- **Server mode**: trong lúc `loading` hiện loading-state cao cấp (glassmorphism, pulse); xong → gating: chưa auth → `/login`; `mustChangePassword` → `/change-password`; `nextStep=setup_2fa` → `/setup-2fa`. Các route `/login|/change-password|/setup-2fa` → **ẩn sidebar**.

#### [NEW] `src/lib/api/client.ts` — `apiFetch()`
- Tự gắn `Content-Type` + **`X-CSRF-Token`** (từ store) cho POST/PATCH/DELETE khi `authMode=required`.
- Trung tâm hóa lỗi: **401** → clear store + đẩy `/login`; **403** → ném lỗi `Forbidden` để trang hiện read-only/error-state; **423/429** → thông điệp chuẩn; **502/503** → error-state agent. Trả về data đã parse.
- Mọi trang/Component gọi qua `apiFetch`, không `fetch` trần.

#### [MODIFY] `src/app/layout.tsx`
- Bọc `<AuthWrapper>`; sidebar render bên trong (đã tự ẩn theo route/mode). Đổi page bg → `bg-zalopay-bg` (mục 2). **Không** đổi cấu trúc cũ khác.

---

## 8. Nâng cấp trang Collector hiện có (giữ zero-regression)

#### [MODIFY] `src/app/knowledge-base/page.tsx` (hiện 2308 dòng, **chưa hề biết authMode**)
- Bọc nhánh theo `authMode`:
  - **`off`**: **không đổi gì** (apiKey + outputDir + Open Folder như cũ) — R3/R4/R6.
  - **`required`**: ẩn input **`apiKey`** (plaintext) + **`outputDir`**, ẩn nút **Open Folder** (`open-folder` trả 404 ở server); thay bằng **Credential Vault picker** (`<Select>` đọc `/api/credentials` lọc theo `source`, hiện nhãn label/username; rỗng → CTA "Thêm credential" dẫn sang `/account`). Form gửi `credentialRef:{source,label}` thay `apiKey` (đúng task shape server `credentialRef`).
  - Với **viewer**: disable nút tạo/sửa/xóa task, Run, sửa schedule (dùng `<Can>`), backend vẫn enforce.
- **Push to Agent KB**: sau crawl xong hiện nút → `POST /api/knowledge-base/push-to-agent` ({taskId, source, pathPrefix}); hiển thị readiness trả về (`status`, `fileCount`, `pathPrefix`). Lưu ý backend đánh dấu **D5** cho bước đóng gói delta cuối → UI làm **2 bước**: (1) "Kiểm tra delta" (hiện fileCount) → (2) "Đẩy" (bật khi backend sẵn sàng); nếu chưa có endpoint cuối thì nút (2) ở trạng thái "Sắp có" + tooltip. Tránh hứa UX chưa chạy được.

#### [MODIFY] `src/app/settings/page.tsx`
- **Sửa F3**: thay 3 `<img src="cdn.simpleicons.org/...">` bằng **icon brand tự host** (SVG nội bộ) để hợp CSP server mode.
- **Bỏ** kế hoạch v1 nhồi tab "My Credentials" vào đây — credentials đã chuyển sang `/account` (mục 4.2). Trang Settings giữ vai trò: ngôn ngữ + crawler defaults (local). Ở server mode, các default chứa apiKey nên ẩn ô apiKey (giống knowledge-base) hoặc chỉ hiện cho local.

---

## 9. i18n (giữ hướng v1 — đúng)
#### [MODIFY] `src/lib/store/i18n-store.ts`
- Mở rộng `TRANSLATIONS` (object phẳng vi/en hiện có) thêm nhóm keys: nav groups, auth forms, lỗi bảo mật (unauthorized/forbidden/locked/rate-limited), nhãn Agent Admin, badge role/status, toast hot-reload. Giữ cơ chế `useTranslation()` + `useI18nStore`. Đặt tên key có tiền tố module (`aa_` cho agent-admin, `auth_`, `acc_`) cho dễ quản.

---

## 10. Phân pha thi công (map D-series `07 §7`)

| Pha | Nội dung | Phụ thuộc |
|---|---|---|
| **Phase 0 — Foundation** | Tokens (mục 2) + UI Kit (mục 3) + `auth-store` + `apiFetch` + `AuthWrapper` (passthrough ở `off`). **Chưa đụng trang nghiệp vụ.** Chốt: local mode R1–R7 pass. | — |
| **Phase 1 — Auth & Accounts (D1)** | `/login`, `/change-password`, `/setup-2fa` (+ `qrcode`), `/accounts`, `/account` (tab Hồ sơ/Sessions), sidebar account-menu + gating. | Phase 0 |
| **Phase 2 — Vault & Collector server-mode (D2)** | `/account` tab Credentials + Tokens; nâng cấp `knowledge-base` (vault picker, ẩn apiKey/outputDir/open-folder, Push-to-Agent bước 1); sửa icon Settings (F3). | Phase 1 |
| **Phase 3 — Agent Admin (D3)** | 9 trang `/agent-admin/**` theo mục 5; sidebar nhóm Agent Admin. | Phase 0 (UI kit), Phase 1 (auth) |
| **Phase 4 — Polish/Deploy (D4)** | Hoàn thiện Push-to-Agent (khi backend D5 sẵn sàng), kiểm CSP toàn app (không CDN), responsive, a11y pass, dọn localStorage secret. | Phase 2,3 |

---

## 11. Kế hoạch kiểm thử (bổ sung so với v1)

Giữ toàn bộ phần Manual của v1 (Auth flow, RBAC, Zero-regression `off`, BFF). **Bổ sung bắt buộc:**

1. **Zero-regression (`AUTH_MODE=off`) — R1–R7 (`07 §5`)**: Start App.command boot OK; mở 5 trang cũ không lỗi console; **sidebar KHÔNG hiện nhóm mới / account-menu**; crawl Confluence ra đúng outputDir; auto-sync hourly chạy; workflow 2 task OK; settings localStorage OK; `git diff` không đụng crawler/`*.command`.
2. **Design-system QA**: chạy quét — không còn hardcode `#0144DB`/`blue-50` ngoài token; mọi trang dùng `PageShell`/`DataTable`/`Field`; card `rounded-2xl`, control `rounded-xl`.
3. **CSP (server mode)**: bật `Content-Security-Policy: default-src 'self'`, mở mọi trang → **0 lỗi CSP console** (QR tự render, icon brand tự host).
4. **RBAC UI × API**: viewer thấy read-only (nút mutate ẩn) **và** API trả 403 khi ép gọi; operator không vào `/accounts`/`/agent-admin/settings` mutate; superadmin đủ quyền.
5. **Self-service**: operator/viewer **tạo được Personal Token** và **nhập được Credential** của mình (xác nhận F5 đã sửa).
6. **State/UX**: mỗi trang có đủ loading/empty/error; 401 ở bất kỳ call nào → về `/login`; 502 agent → error-state; toast hot-reload hiện sau khi sửa skill.
7. **Responsive & a11y**: DataTable scroll-x mobile; Modal focus-trap + Esc; focus-visible ring; tab order auth form.

> **Verification nâng cao (khuyến nghị):** sau Phase 3, dùng một subagent rà toàn bộ tham chiếu route/API trong code FE so với `BACKEND-FRONTEND-HANDOFF.md` để bắt endpoint lệch tên, và build thử (`npm run build`) ở cả 2 mode.

---

## 12. Tóm tắt thay đổi so với v1

| Hạng mục | v1 | V2 |
|---|---|---|
| Design tokens | màu thô, style inline rải rác | thêm token ngữ nghĩa + quy ước, sửa page bg đồng bộ |
| UI Kit dùng chung | **không có** | **Phase 0**: table/tabs/modal/drawer/toast/badge/states/role-gate… |
| CSP | chỉ lo QR | + tự host icon brand (sửa lỗi CDN ở Settings), quét CSP toàn app |
| `qrcode` | nói "đã có" (sai) | thêm dep / tự render canvas |
| Self-service (token/cred) | nhét trong `/accounts`+Settings → role thấp không tới được | tách trang **`/account`** cho mọi role; `/accounts` chỉ quản user khác |
| Trùng tên Workflows | không xử lý | section-label + icon phân biệt Collector vs Agent |
| Dashboard | có RAM/CPU (không có API) | đúng field `/status` + audit + LLM usage |
| Settings agent | thiếu Model Router | thêm Model Router (`model_profiles`/`model_routing`, 409) |
| Knowledge | chỉ upload + list | + versions table (kind/chunks/summary) + search-test + Auto-sync |
| Lỗi/khởi tạo | rời rạc | `apiFetch` + 4 state-component chuẩn |
| Auth state | React Context | zustand `auth-store` (đồng bộ dự án) |
| Phân pha | theo trang | **Phase 0 nền** trước, rồi D1/D2/D3/D4 |

