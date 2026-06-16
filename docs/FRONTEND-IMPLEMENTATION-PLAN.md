# Frontend Implementation Plan - Didi AI Tool & Agent Admin

Tài liệu này chi tiết hóa kế hoạch xây dựng giao diện người dùng (Frontend) cho các tính năng nền tảng Bảo mật (Auth, 2FA, Accounts, Credentials) và module quản trị Agent (Agent Admin) của Didi AI Tool, tích hợp trực tiếp với hệ thống API của Backend đã viết theo đặc tả tại `<repo>/docs/BACKEND-FRONTEND-HANDOFF.md`.

---

## User Review Required

> [!IMPORTANT]
> **1. Quản lý Trạng thái Auth (Auth Context)**
> - Xây dựng một Client-side wrapper/provider `AuthWrapper` trong `layout.tsx` để thực hiện gọi `GET /api/me` khi ứng dụng load lần đầu.
> - `AuthWrapper` sẽ kiểm soát việc chuyển hướng người dùng (chưa đăng nhập -> `/login`, đăng nhập nhưng chưa đổi pass -> `/change-password`, hoặc cần kích hoạt 2FA -> `/setup-2fa`).
> - Khi ở các trang Auth (`/login`, `/change-password`, `/setup-2fa`), Sidebar sẽ được ẩn hoàn toàn để tối ưu trải nghiệm.

> [!WARNING]
> **2. Tích hợp thư viện QR Code**
> - API `/api/auth/setup-2fa/start` trả về chuỗi `otpauthUrl`. Chúng ta sẽ cài đặt thêm thư viện `qrcode` (đã khai báo trong package.json) hoặc sử dụng một client-side canvas renderer để vẽ QR Code trực tiếp mà không phụ thuộc vào CDN ngoài, đảm bảo tuân thủ Content Security Policy (CSP).

---

## Open Questions

> [!NOTE]
> **Câu hỏi 1 (Đã tự giải quyết theo Best Practice):** Việc dịch thuật các trang mới (Auth, Agent Admin) có nên đưa vào `i18n-store.ts` không?
> - **Giải pháp đề xuất:** Chúng ta sẽ mở rộng `src/lib/store/i18n-store.ts` để thêm toàn bộ translation keys bằng cả tiếng Việt và tiếng Anh cho các module mới, duy trì cơ chế chọn ngôn ngữ hiện có của Didi.

---

## Proposed Changes

Chúng ta sẽ phân nhóm các thay đổi theo từng cấu phần giao diện:

### 1. Cấu trúc Routing & Auth Layout

#### [MODIFY] [layout.tsx](src/app/layout.tsx)
- Bọc nội dung body của layout bằng `AuthProvider` (sẽ tạo mới).
- Ẩn hiển thị `<Sidebar />` nếu người dùng chưa đăng nhập hoặc đang ở các tuyến đường Auth (`/login`, `/change-password`, `/setup-2fa`).

#### [NEW] [auth-wrapper.tsx](src/components/layout/auth-wrapper.tsx)
- Định nghĩa `AuthContext` và hook `useAuth()` để các page/component truy cập thông tin User (id, username, role, mustChangePassword, hasTotp) và `csrfToken`.
- Tự động đính kèm header `X-CSRF-Token` vào mọi yêu cầu thay đổi dữ liệu (POST, PATCH, DELETE) khi `authMode === "required"`.
- Hiển thị màn hình Loading Spinner cao cấp (Premium glassmorphism, pulse animation) khi đang kiểm tra trạng thái session lần đầu.

#### [MODIFY] [sidebar.tsx](src/components/layout/sidebar.tsx)
- Nhận diện `authMode` và thông tin User hiện tại từ `useAuth()`.
- Nếu `authMode === "required"`, hiển thị thêm một nhóm điều hướng **"Quản trị Agent" (Agent Admin)** trong Sidebar cho người dùng có vai trò phù hợp (viewer, operator, superadmin).
- Bổ sung liên kết quản trị tài khoản `/accounts` hiển thị riêng cho vai trò `superadmin`.
- Cập nhật hiển thị tên người dùng và vai trò đăng nhập thực tế ở footer của Sidebar (thay vì cứng "Didi / ZaloPay AI").

---

### 2. Các trang Auth & Platform

#### [NEW] [page.tsx](src/app/login/page.tsx)
- Màn hình đăng nhập ZaloPay AI phong cách Premium Glassmorphism.
- Form đăng nhập với Username, Password.
- Trạng thái động: Nếu API trả về `{ requiresOtp: true }`, hiển thị thêm ô nhập mã xác thực OTP 6 số (TOTP).
- Hỗ trợ lưu trữ `csrfToken` vào Context sau khi đăng nhập thành công, và chuyển hướng đến trang tương ứng (`change_password`, `setup_2fa` hoặc `/knowledge-base`).

#### [NEW] [page.tsx](src/app/change-password/page.tsx)
- Giao diện yêu cầu đổi mật khẩu lần đầu (hoặc đổi chủ động).
- Ràng buộc nhập Mật khẩu hiện tại, Mật khẩu mới (yêu cầu tối thiểu 12 ký tự, kiểm tra chính sách bảo mật trước khi submit).

#### [NEW] [page.tsx](src/app/setup-2fa/page.tsx)
- Trang kích hoạt xác thực 2 bước (TOTP).
- Tự động gọi `/api/auth/setup-2fa/start` để lấy `otpauthUrl` và `secret`.
- Render mã QR Code bằng thư viện `qrcode` dạng canvas vẽ trên Client.
- Form kiểm tra mã OTP để xác nhận kích hoạt thành công qua `/api/auth/setup-2fa/verify`.

#### [NEW] [page.tsx](src/app/accounts/page.tsx)
- Giao diện quản lý tài khoản dành riêng cho `superadmin`. Chia làm 3 tab chính:
  1. **Danh sách User**: Hiển thị bảng User (Username, Role, Status, 2FA status). Hỗ trợ nút Thêm User mới (tự sinh mật khẩu tạm thời), Vô hiệu hóa/Kích hoạt tài khoản, Reset mật khẩu, Reset 2FA.
  2. **Quản lý Session**: Hiển thị các session hoạt động (IP, User Agent, Last Seen, Created At). Hỗ trợ nút Revoke (xóa session) riêng lẻ hoặc hàng loạt.
  3. **Personal Tokens**: Quản trị mã Personal Access Token cho tích hợp API/CI. Hỗ trợ tạo mới (hiển thị token plaintext duy nhất một lần) và xóa/thu hồi (Revoke).

---

### 3. Nâng cấp các trang Crawler hiện tại

#### [MODIFY] [page.tsx](src/app/settings/page.tsx)
- Khi `authMode === "required"`, thêm tab **"Thông tin xác thực của tôi" (My Credentials)**.
- Người dùng có thể xem danh sách token (Confluence, Jira, GitLab) và điền mới/cập nhật thông tin token cá nhân. Token được mã hóa ở server nên client chỉ hiển thị nhãn "Đã cấu hình" và không cho phép xem lại plaintext.

#### [MODIFY] [page.tsx](src/app/knowledge-base/page.tsx)
- Điều chỉnh giao diện Form cấu hình Tác vụ dựa trên `authMode`:
  - **Nếu `authMode === "required"`**: Ẩn trường nhập `apiKey` dạng plaintext và trường nhập `outputDir` (tự động lưu vào thư mục staging của server), đồng thời ẩn nút "Mở thư mục" (Open Folder). Thay thế bằng danh sách chọn **Credential Vault** (người dùng chọn credential tương ứng từ danh sách đã cấu hình của họ).
- Nút **"Đẩy vào Agent KB" (Push to Agent KB)**: Khi crawl hoàn tất, hiển thị nút này cho phép operator gửi yêu cầu sync delta lên Agent qua `/api/knowledge-base/push-to-agent`. Hiển thị bảng so sánh delta, số lượng file thay đổi, và xác nhận đẩy dữ liệu.

---

### 4. Các trang Quản trị Agent (BFF `/api/agent-admin/*`)

Xây dựng các trang quản lý cấu hình Agent thông qua BFF Proxy (tự động chuyển tiếp yêu cầu đến Agent Backend kèm token xác thực):

#### [NEW] [page.tsx](src/app/agent-admin/dashboard/page.tsx)
- Dashboard theo dõi trạng thái Agent: uptime, RAM/CPU (nếu có), số lượng lượt chạy đang hoạt động, thống kê tổng quát số lượng tri thức (Knowledge Base documents), skill hoạt động.

#### [NEW] [page.tsx](src/app/agent-admin/instructions/page.tsx)
- Giao diện quản lý Chỉ thị hệ thống (Instructions). Cho phép chỉnh sửa nội dung Markdown cấu hình cách Agent ứng xử và tư duy, có chức năng kích hoạt phiên bản chỉ thị cụ thể.

#### [NEW] [page.tsx](src/app/agent-admin/skills/page.tsx)
- Trang quản trị Kỹ năng của Agent (Skills).
- Danh sách các skill kèm bí danh câu lệnh (`command_alias`), cờ bật/tắt (enabled), trạng thái hiển thị trong Menu Chat.
- Hỗ trợ trình soạn thảo Markdown viết hướng dẫn hoạt động của từng skill và áp dụng thay đổi tức thì (hot-reload).

#### [NEW] [page.tsx](src/app/agent-admin/workflows/page.tsx)
- Quản lý các Quy trình xử lý tự động của Agent (khác với quy trình kéo thả của Didi).
- Thiết lập lịch trình chạy tự động (cron expression), biến cấu hình, và nút "Chạy thử" để kích hoạt tức thì.

#### [NEW] [page.tsx](src/app/agent-admin/runs/page.tsx)
- Xem danh sách lịch sử lượt chạy (Runs) của Agent.
- Bảng lịch sử gồm ID lượt chạy, Tác vụ/Quy trình kích hoạt, Trạng thái (đang chạy, hoàn tất, lỗi, đã hủy), Thời gian chạy.
- Hỗ trợ nhấp xem chi tiết: Xem log thực thi realtime, tải về các file kết quả (Artifacts) do Agent tạo ra, hoặc gửi tín hiệu Hủy lượt chạy (`POST /api/agent-admin/runs/:id/cancel`).

#### [NEW] [page.tsx](src/app/agent-admin/knowledge/page.tsx)
- Quản lý Kho tri thức đã nạp vào Agent.
- Hiển thị danh sách các file tri thức hiện có, lịch sử đồng bộ.
- Cho phép upload tay tài liệu nạp trực tiếp qua cơ chế tải lên phân đoạn (Chunked Upload API `/api/agent-admin/kb/chunked/**`) tránh quá tải RAM.

#### [NEW] [page.tsx](src/app/agent-admin/access/page.tsx)
- Quản lý danh sách tài khoản Telegram yêu cầu phê duyệt để chat với Agent.
- Hiển thị danh sách yêu cầu chờ duyệt, danh sách đã được cấp quyền. Các chức năng Phê duyệt (Approve), Từ chối (Reject), Thu hồi quyền (Revoke).

#### [NEW] [page.tsx](src/app/agent-admin/audit/page.tsx)
- Giao diện xem Nhật ký hệ thống (Audit Log).
- Bảng chi tiết: Người thực hiện (Actor), Hành động (Action), Đối tượng tác động (Target), IP/Thiết bị, Thời gian.
- Hỗ trợ bộ lọc theo Actor, Action, và khoảng thời gian.

#### [NEW] [page.tsx](src/app/agent-admin/settings/page.tsx)
- Quản lý cấu hình cấp hệ thống của Agent (chỉ `superadmin` được lưu).
- Cấu hình các tham số vận hành, model LLM mặc định, cấu hình kênh kết nối (Telegram webhook, tokens).

---

### 5. Cập nhật các bản dịch Tiếng Việt & Tiếng Anh

#### [MODIFY] [i18n-store.ts](src/lib/store/i18n-store.ts)
- Bổ sung translation keys cho toàn bộ các màn hình mới gồm: nhóm tiêu đề trong Sidebar, thông tin hiển thị trên form Auth, thông báo lỗi bảo mật (unauthorized, forbidden, locked account), các nhãn biểu đồ quản trị Agent.

---

## Verification Plan

### Kiểm thử Thủ công (Manual Verification)
1. **Kiểm thử Auth Flow (`AUTH_MODE=required`)**:
   - Truy cập trang chủ `/` khi chưa đăng nhập -> Xác nhận ứng dụng tự động redirect về `/login`.
   - Đăng nhập với mật khẩu bootstrap -> Xác nhận redirect về `/change-password` và yêu cầu đổi mật khẩu.
   - Hoàn thành đổi mật khẩu -> Xác nhận chuyển hướng tiếp đến `/setup-2fa` và vẽ thành công QR Code bằng canvas. Nhập OTP từ app xác thực để kích hoạt.
   - Thử đăng nhập sai 5 lần liên tiếp -> Xác nhận tài khoản bị khóa trong 15 phút.

2. **Kiểm thử Role-based Access (RBAC)**:
   - Đăng nhập tài khoản vai trò `viewer` -> Kiểm tra xem các tab cấu hình và nút "Lưu/Chạy" có bị ẩn đi không. Thử gọi API thay đổi qua Postman/cURL -> Xác nhận API trả về lỗi `403 Forbidden`.
   - Đăng nhập tài khoản `operator` -> Xác nhận thực hiện được toàn bộ tính năng thu thập tài liệu (crawl), cập nhật chỉ thị, skill của Agent. Xác nhận không truy cập được trang `/accounts`.
   - Đăng nhập tài khoản `superadmin` -> Xác nhận truy cập được trang quản lý tài khoản `/accounts` và điều chỉnh phân quyền hệ thống.

3. **Kiểm thử Zero-Regression (`AUTH_MODE=off`)**:
   - Đặt biến môi trường `AUTH_MODE=off`.
   - Chạy ứng dụng -> Xác nhận hệ thống bypass toàn bộ màn hình Auth, hiển thị Sidebar cũ, không bắt nhập OTP/Login, và các tác vụ crawl vẫn sử dụng `apiKey` lưu cục bộ.

4. **Kiểm thử Agent Admin BFF**:
   - Bật Agent base URL và cấu hình token.
   - Thử load trang `/agent-admin/dashboard` và `/agent-admin/skills` -> Xác nhận proxy API hoạt động mượt mà, hiển thị đúng danh sách skill thực tế từ Agent.
   - Thử cập nhật nội dung một skill -> Xác nhận sau khi lưu hiển thị thông báo thành công và Agent cập nhật hành vi ngay lập tức.
