---
name: mmf-data-analysis
description: >
  Fetch and analyze MMF (Tài Khoản Tích Lũy) data from Tableau for monthly reports at ZaloPay/VNG Investment team. 
  Use this skill whenever someone asks about MMF data, muốn lấy data MMF từ Tableau, phân tích MMF, 
  xem metrics tài khoản tích lũy, hoặc chuẩn bị số liệu MMF cho báo cáo tháng. 
  Also trigger when someone mentions "main metrics MMF", "AUM MMF", "deposit MMF", "redemption MMF", 
  "activation rate MMF", "retention MMF", "entrance traffic", "toggle prioritize", or any request to 
  pull MMF numbers from Tableau. This skill covers which views to fetch, what each metric means, 
  and how to structure the analysis for a monthly report.
---

# MMF Monthly Data Analysis Skill

Bạn đang fetch data MMF từ Tableau để phân tích cho báo cáo tháng. MMF = "Tài Khoản Tích Lũy" (savings account product of ZaloPay). 

**Prerequisite:** Tableau MCP server phải đang chạy (port 3927). Nếu tools `mcp__tableau-local__*` không available, nhắc user chạy `start-tableau-mcp.bat`. Nếu gặp lỗi **403**, session Tableau đã hết hạn — nhắc user reconnect rồi thử lại.

---

## Step 1: Known IDs (dùng trực tiếp, không cần search lại)

### Workbook IDs
| Workbook | ID |
|----------|----|
| Tài Khoản Tích Lũy (Business Performance) | `4c6ca05e-97b7-46e9-a15d-8936686eea03` |
| Tài Khoản Tích Lũy (Product) | `6dc7061d-a555-4927-827c-4b3cb26d5cca` |
| MMF Toggle Prioritize | `fe195943-b0d8-4e00-9958-a85db73cfeb8` |

### View IDs
| View | Workbook | ID |
|------|----------|----|
| Main Metrics | Business Performance | `158a6541-bef4-49ae-b128-b31c7cb6f62b` |
| MMF - MTD - Retention | Business Performance | `bf8385c2-ce92-4162-ac43-3708f18e72ed` |
| Tài Khoản Tích Lũy (Amount.Fee) | Business Performance | `3f38b963-d5ad-41d6-9556-231c35aa32f2` |
| Tài Khoản Tích Lũy (Product dashboard) | Product | `b142eb0d-6328-451e-8c17-7677b47d806b` |
| Entrance Traffic | Product | `f09813ea-ae93-46bb-baa7-5e157d4962c0` |
| Toggle Tracking | MMF Toggle Prioritize | `fc3c424f-4524-4e51-bf70-d83e721d4429` |

Nếu ID bị outdated, dùng `list-workbooks` với filter `projectName:eq:1. MMF` để tìm lại.

---

## Step 2: Giới hạn kỹ thuật & cách xử lý — ĐỌC TRƯỚC KHI FETCH

### Parameters vs Filters — QUAN TRỌNG

`viewFilters` trong MCP **CHỈ hoạt động với dimension filters, KHÔNG hoạt động với parameters** như `manualStartDate`, `manualEndDate`, `timeframe`. Nếu truyền các tham số này vào `viewFilters`, data trả về vẫn theo date range mặc định — không có error, chỉ im lặng bỏ qua.

### Cách đổi date range: Custom Views

User cần làm 1 lần trên Tableau web:
1. Mở view tại atlas.vng.com.vn → đổi parameter date range theo ý muốn
2. Click **"View: Original"** → **"Save as Custom View"** → đặt tên
3. Claude dùng `list-custom-views(workbookId)` → lấy `customViewId` → `get-custom-view-data` hoặc `get-custom-view-image`

Custom view chỉ cần save 1 lần — lần sau fetch lại không cần user làm gì thêm.

### VizQL Data Service disabled

Trên atlas.vng.com.vn, VizQL bị tắt. Các tools **không hoạt động**:
- `query-datasource`
- `get-datasource-metadata`

Đừng thử dùng, sẽ báo lỗi ngay.

---

## Step 3: Quy tắc đọc số user — CRITICAL

### Sai lầm phổ biến: đọc TOTAL USER từ Main Metrics (timeframe=Daily) làm MAU

Khi timeframe=Daily, TOTAL USER = tổng cộng dồn daily active users — **bị double-count** users active nhiều ngày trong tháng → inflate, KHÔNG phải MAU.

### 2 cách lấy MAU chính xác

**Cách 1 — Retention MTD view (khuyên dùng):**
- Fetch CSV từ view `bf8385c2-ce92-4162-ac43-3708f18e72ed`
- Cột `mtd_users` tại **ngày cuối tháng** = MAU deduplicated của tháng đó
- Proven: MTD Day 2 (305,675) < Day1 + Day2 daily (410,800) → confirmed deduplicated

**Cách 2 — Main Metrics với timeframe=Monthly:**
- Cần custom view có timeframe=Monthly
- TOTAL USER khi đó mới là monthly unique users

### Quy tắc chung

| Metric | Cách lấy đúng |
|--------|--------------|
| **MAU** | Retention MTD view (CSV) hoặc Main Metrics timeframe=Monthly |
| **Deposit/Redemption amount** | Main Metrics / Amount.Fee, Daily, cộng tổng daily là đúng |
| **AUM** | Amount.Fee, lấy giá trị tại ngày cuối kỳ (không cộng dồn) |

---

## Step 4: Views nên fetch

### A. Business Performance workbook

| View | Lấy gì | Lưu ý |
|------|--------|-------|
| **MMF - MTD - Retention** ★★★ | MAU, NAU/FAU/RAU breakdown, daily users | CSV đầy đủ, không cần custom view cho date range |
| **Amount.Fee** ★★★ | AUM daily, net deposit, LP rate, earning | Custom view nếu cần date range ngoài default |
| **Main Metrics** ★★★ | Deposit/redemption amount & breakdown theo transaction type | Dùng cho volume — KHÔNG dùng TOTAL USER (Daily) làm MAU |

### B. Product workbook

| View | Lấy gì | Lưu ý |
|------|--------|-------|
| **Tài Khoản Tích Lũy** ★★★ | Registration, activation rate, merchant distribution | Custom view nếu cần date range khác |
| **Entrance Traffic** ★★★ | Signup sources (G1/G2), entry point breakdown | Custom view nếu cần date range khác |
| Nuôi heo chắt chill | — | Skip, outdated |

### C. MMF Toggle Prioritize workbook

| View | Lấy gì |
|------|--------|
| **Toggle Tracking** ★★ | Users bật toggle, funnel steps, entry point contribution |

---

## Step 5: Transaction type glossary

### Deposit
| Transaction Type | Ý nghĩa |
|-----------------|---------|
| `deposit` | Nạp tiền generic |
| `deposit_cashback` | Nhận promotion hoàn tiền vào MMF |
| `deposit_lixi` | Nhận tiền lì xì từ người khác vào MMF |
| `deposit_recurring` | Nạp tiền định kỳ |
| `deposit_toggle_priority` | Bật ưu tiên MMF → tiền tự chuyển 1 lần từ ví |
| `deposit_transfer_p2p` | Tự động nạp từ tiền P2P nhận được |
| `deposit_transfer_personal_qr` | Tự động nạp từ tiền nhận qua QR cá nhân |
| `deposit_vietqr_inapp` | Nạp tiền khi vào Home MMF |
| `deposit_vietqr_topup` | Nạp tiền khi vào trang nạp tiền ZaloPay |

### Redemption
| Transaction Type | Ý nghĩa |
|-----------------|---------|
| `redemption_cash_out` | Rút hẳn ra khỏi ZaloPay |
| `redemption_for_ibft` | Chuyển tiền tới ngân hàng (tổng hợp) |
| `redemption_for_ibft_account` | Chuyển tới ngân hàng bằng STK |
| `redemption_for_ibft_scanqr` | Chuyển tới ngân hàng bằng quét QR |
| `redemption_for_pay` | Thanh toán merchant |
| `redemption_for_paylater` | Trả nợ BNPL |
| `redemption_for_stock` | Nạp tiền vào chứng khoán |
| `redemption_for_transfer` | Chuyển tiền nói chung |
| `redemption_to_wallet` | Rút từ MMF về ví ZaloPay |
| `refund` | Hoàn tiền |

---

## Step 6: Key segments & dimensions

- **NAU / FAU / RAU M1-M6**: User mới / lần đầu active / quay lại sau 1-6 tháng
- **G1 / G2**: Existing ZaloPay users / New users đăng ký qua MMF
- **Merchant Distribution**: User dùng MMF `pay` cho merchant nào (IRIS MEDIA = nạp điện thoại)

---

## Step 7: Analysis framework

| # | Nội dung | Nguồn data |
|---|----------|-----------|
| 7.1 | MAU, NAU/FAU/RAU, daily avg | Retention MTD view |
| 7.2 | AUM cuối tháng, net flow, LP rate | Amount.Fee |
| 7.3 | Deposit/redemption volume & breakdown | Main Metrics (Daily) |
| 7.4 | Registration, activation rate | Product dashboard |
| 7.5 | Traffic sources, G1/G2 | Entrance Traffic |
| 7.6 | Toggle success, funnel | Toggle Tracking |

---

## Step 8: Output format

```
## MMF – [Tháng YYYY]

| Metric | Tháng trước | Tháng này | MoM |
|--------|------------|-----