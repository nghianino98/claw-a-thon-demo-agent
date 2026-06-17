# Queo Solution Tool & Agent: Nền tảng Tri thức Hợp nhất 360°

## 1. Vấn đề giải quyết
- Tri thức doanh nghiệp bị cô lập tại các "ốc đảo dữ liệu" phân mảnh (Jira, Confluence, Source Code, Design, OneDrive, Teams). Dù ứng dụng GenAI, các mô hình LLM thông thường vẫn "mù ngữ cảnh" nội bộ, khiến đầu ra thiếu chính xác và nhân viên vẫn phải tra cứu, tổng hợp chéo thủ công.

## 2. Đối tượng người dùng
- Toàn bộ đội ngũ liên phòng ban Wealth Solution (Business, Product, Developer, QE, Ops) và bất kỳ nhân viên Zalopay nào có nhu cầu bứt phá hiệu suất làm việc.

## 3. Cách Agent giải quyết
- **Queo Solution Tool** đóng vai trò Hub kết nối đa nhiệm, tự động thu thập và đồng bộ hóa mọi nguồn dữ liệu rời rạc để kiến tạo một Kho tri thức động (Dynamic Knowledge Base) toàn diện.
- **Cơ chế quản trị Agent linh hoạt**: Cho phép người dùng tự tay thiết kế Agent chuyên biệt qua việc tùy biến system prompt, bổ sung skill và nạp tri thức đích ngắm. Từ đó, dễ dàng đóng gói thành các Chatbot hoặc tích hợp sâu vào các ứng dụng nội bộ khác.

## 4. Giá trị mang lại
- **Góc nhìn Tri thức 360°**: Kết nối chéo và tra cứu liền mạch từ mục tiêu Business, đặc tả Product, đến từng dòng code thực tế của Dev và luồng tiền vận hành của Ops.
- **Tự động hóa thông minh**: Khép kín chu trình từ tự động thu thập, xử lý tri thức bằng AI đến xuất đầu ra (báo cáo, PRD) chuẩn xác theo yêu cầu.
- **Nền tảng tự phục vụ (Self-serve)**: Một công cụ hợp nhất giúp tháo gỡ rào cản thông tin, tối đa hóa cộng tác và tự do tùy biến đầu ra (ví dụ: tự cấu hình báo cáo chuyên biệt cho CEO, cho Manager hay cho chính cá nhân).

---

## 5. Hướng dẫn kỹ thuật & Cài đặt (Technical Setup)

### 5.1. Didi AI Tool (NextJS Frontend)

Didi AI Tool is a Next.js application for crawling knowledge sources, managing workflow automation, and administering agent/bot connections.

#### Requirements & Setup
- Node.js 22+
- Python 3 with `venv`
- macOS (for click-to-run `.command` helpers)

Install dependencies:
```bash
npm install
python3 -m venv .venv
.venv/bin/pip install -r src/scripts/confluence_docs_tools/requirements.txt
```

#### Running the Frontend
Development mode:
```bash
npm run dev
```

Production build:
```bash
npm run build
npm run start
```

On macOS, `Cài đặt Tool.command`, `Start App.command`, and `Stop App.command` provide click-to-run capabilities.

---

### 5.2. Quéo Solution Agent (FastAPI Backend)

Runtime-first implementation of the Quéo bot, featuring SQLite storage, hybrid KB tools (FTS5 search + ripgrep live scan), and Telegram polling/webhook mode.

#### Requirements & Setup
- Python 3.10+

Install dependencies:
```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
python -m app.cli migrate
```

#### Running the Backend
Start the server:
```bash
uvicorn app.main:app --reload --host 127.0.0.1 --port 8080
```

Index a Knowledge Base (KB) folder:
```bash
python -m app.cli index-kb --source "/path/to/Wealth Solution" --activate
```

Chat locally through the core CLI loop:
```bash
python -m app.cli chat
```
