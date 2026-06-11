# Quéo Solution — Product Concept (one-pager)

*Dùng để giới thiệu với BTC claw-a-thon / team / stakeholder. Không phải spec kỹ thuật — spec nằm ở `00`–`05`.*

## Vấn đề

Tri thức vận hành của Zalopay Wealth Solution (8 sản phẩm: MMF, FD, FI, CCQ, Insurance, Stock, FS Hub, FS Profile) đang nằm rải trong ~53.000 file: tài liệu sản phẩm, Confluence, Jira, CS ticket, source code, data, email, chat. Hôm nay chỉ một người (PO) nắm bản đồ tri thức đó. Mỗi câu hỏi của CEO/Business/Dev/QE — "FD rút trước hạn xử lý sao?", "MMF tuần này lỗi gì?", "logic redemption nằm ở đâu?" — đều phải chờ đúng người, lục đúng file. Tri thức có, nhưng không truy cập được ở tốc độ làm việc.

## Giải pháp

**Quéo** — agent tri thức nội bộ chạy trên Telegram, trả lời mọi câu hỏi về Wealth Solution **kèm trích nguồn tới đúng file**, và tự thực hiện các tác vụ nghiệp vụ đa bước theo quy trình đã định nghĩa.

| Khả năng | Ví dụ thực tế |
|---|---|
| **Hỏi đáp có nguồn** trên toàn bộ kho tri thức | "So sánh thanh khoản MMF và FD" → trả lời + 📚 nguồn: 2 file knowledge base |
| **Skill chuyên môn** tự kích hoạt (14 skill: audit, điều tra lỗi, market research, CS report…) | "Vì sao user X lỗi rút tiền?" → tự vào chế độ Issue Investigator, truy CS ticket + source code |
| **Workflow tự động** đa bước | `/run product-audit MMF quick` → agent chạy chuỗi bước, báo tiến độ, trả file báo cáo |
| **Tri thức luôn mới** | Sửa file trên máy PO → tự đồng bộ lên agent trong vài phút, có version & rollback |
| **Admin tool** | Web dashboard: chỉnh persona/skill/workflow, quản lý KB, duyệt người dùng, audit log |

## Vì sao đáng tin để dùng nội bộ

1. **Bảo mật default-deny:** chỉ người được duyệt mới chat được; webhook xác thực 2 lớp; mọi tương tác có audit log; agent chỉ đọc tri thức — không có quyền ghi/đụng hệ thống thật.
2. **Không bịa:** TRUTH-mode — khẳng định nào cũng phải có nguồn từ kho tri thức; không tìm thấy thì nói không tìm thấy. Nguồn mâu thuẫn → ưu tiên Fact (code, ticket, data) hơn tài liệu.
3. **Hạ tầng trong nhà:** chạy 100% trên GreenNode (AgentBase runtime + MaaS LLM của VNG) — dữ liệu nội bộ không rời hệ sinh thái VNG Cloud.

## Đối tượng & giá trị

| Ai | Được gì |
|---|---|
| CEO / Business | hỏi số liệu, chiến lược, trạng thái sản phẩm — câu trả lời kết luận-trước, không chờ họp |
| Product | tra cứu hành vi sản phẩm, lịch sử quyết định, chạy audit/report tự động |
| Developer / QE | truy logic source code, root cause theo ticket/transID, đối chiếu spec vs thực tế |
| PO (Duy) | thoát vai "bộ nhớ sống"; kiểm soát tri thức agent qua admin + version hóa |

## Hiện trạng & lộ trình

Demo RAG 1-lượt đã chạy trên GreenNode (agent "Mây") — chứng minh hạ tầng. Bản Quéo nâng cấp lên agentic loop (tool-use, multi-step), thiết kế hoàn chỉnh tại `docs/queo-solution/`, kế hoạch 6 milestone ≈ 6-7 ngày dev: M0 nền móng → M1 agent core + KB → M2 Telegram + security → M3 admin → M3b auto-sync → M4 workflow → M5 hardening & go-live.

**Thước đo thành công v1:** eval set 50 câu hỏi vàng đạt ≥80% (đúng + có nguồn + không bịa); 100% câu prompt-injection bị chặn; thời gian trả lời câu hỏi thường <30s; team ≥5 người dùng hằng tuần.
