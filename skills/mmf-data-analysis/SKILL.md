---
name: mmf-data-analysis
description: >
  Fetch and analyze MMF (Tài Khoản Tích Lũy) data from Tableau for monthly reports at ZaloPay/VNG Investment team. 
  Use this skill whenever someone asks about MMF data, muốn lấy data MMF từ Tableau, phân tích MMF, 
  xem metrics tài khoản tích lũy, hoặc chuẩn bị số liệu MMF cho báo cáo tháng. 
  Also trigger when someone mentions "main metrics MMF", "AUM MMF", "deposit MMF", "redemption MMF", 
  "activation rate MMF", "retention MMF", "entrance traffic", "toggle prioritize", "NAU FAU RAU MMF",
  "net flow MMF", "Amount.Fee", "G2 traffic", or any request to pull MMF numbers from Tableau.
  This skill covers which views to fetch, what each metric means, and how to structure the analysis for a monthly report.
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

### View IDs
| View | Workbook | ID |
|------|----------|----|
| Main Metrics | Business Performance | `158a6541-bef4-49ae-b128-b31c7cb6f62b` |
| MMF - MTD - Retention | Business Performance | `bf8385c2-ce92-4162-ac43-3708f18e72ed` |
| Tài Khoản Tích Lũy (Amount.Fee) | Business Performance | `3f38b963-d5ad-41d6-9556-231c35aa32f2` |
| Tài Khoản Tích Lũy (Product dashboard) | Product | `b142eb0d-6328-451e-8c17-7677b47d806b` |
| Entrance Traffic | Product | `f09813ea-ae93-46bb-baa7-5e157d4962c0` |

### Known Custom View IDs
| Custom View | Workbook | Period | ID |
|-------------|----------|--------|----|
| 052026 (Amount.Fee) | Business Performance | 4/1–6/11/2026 | `a17e90bd-ac10-4834-8cb8-cc620c975784` |
| 052026 (Product dashboard) | Product | 4/1–6/11/2026 | `74deffdd-f24b-47eb-9cde-c566b2d41120` |
| 052026-G2trafffic | Product / Entrance Traffic | 4/1–6/11/2026 | `4788fbcc-91df-416b-b689-1a4954a954c9` |
| 052026-G1trafffic | Product / Entrance Traffic | 4/1–6/11/2026 | `20fc0bb6-9f56-4e9d-919b-d0bbe259c9d8` |

Nếu ID bị outdated, dùng `list-custom-views(workbookId)` để tìm lại.

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

### `get-custom-view-data` trả về 404

**Amount.Fee view KHÔNG support CSV export** — luôn dùng `get-custom-view-image` với `width=1400, height=900`. Đây là confirmed behavior, không cần thử lại CSV. Các view khác (Entrance Traffic, Retention MTD) vẫn support CSV bình thường.

### VizQL Data Service disabled

Trên atlas.vng.com.vn, VizQL bị tắt. Các tools **không hoạt động**:
- `query-datasource`
- `get-datasource-metadata`

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

### Cách lấy NAU / FAU / RAU breakdown per month

Retention MTD view hỗ trợ filter `User Type` (dimension filter — hoạt động với `viewFilters`). Chạy 3 fetches riêng:

```
get-view-data(viewId="bf8385c2-ce92-4162-ac43-3708f18e72ed", viewFilters={"User Type": "NAU"})
get-view-data(viewId="bf8385c2-ce92-4162-ac43-3708f18e72ed", viewFilters={"User Type": "FAU"})
get-view-data(viewId="bf8385c2-ce92-4162-ac43-3708f18e72ed", viewFilters={"User Type": "RAU"})
```

Đọc `mtd_users` tại ngày cuối tháng của từng CSV (Apr=Day 30, May=Day 31, MTD=ngày cuối cùng có data).

**Lưu ý:** Tổng NAU+FAU+RAU có thể lớn hơn MAU tổng ~5-7% — bình thường. Dùng MAU tổng (no filter) làm official; N/F/R dùng để phân tích cơ cấu.

---

## Step 4: Nguồn data cho từng metric

| Metric | Nguồn chính | Ghi chú |
|--------|-------------|---------|
| **AUM** (cuối tháng) | **Amount.Fee** — image, đọc bar cuối tháng | Stock metric — KHÔNG extrapolate |
| **Deposit amount** (tháng) | **Amount.Fee** — image, đọc bar `#deposit.amount` | Cross-check với KPI period total |
| **Redemption amount** (tháng) | **Amount.Fee** — image, đọc bar `#redemption.amount` | Cross-check với KPI period total |
| **Net flow** (tháng) | **Amount.Fee** — image, đọc bar `Net Amount` | Trực tiếp nhất, label rõ trên chart |
| **Transaction type breakdown** | **Main Metrics** | Tách theo loại giao dịch |
| **Total Volume gross** (Deposit+Withdraw) | **Main Metrics** | Khác với Amount.Fee deposit/redemption |
| **MAU** (tổng) | Retention MTD view, không filter | |
| **NAU / FAU / RAU** (per month) | Retention MTD view, filter `User Type` | |
| **NFAU** | Main Metrics (TOTAL NFAU field) | |
| **G2 traffic source breakdown** | Custom view `052026-G2trafffic` | FAU drill-down; NAU không trace được qua view này |

### Tại sao Amount.Fee và Main Metrics cho số deposit khác nhau?

- **Amount.Fee deposit** = tiền thực sự vào quỹ MMF, đối chiếu với AUM balance
- **Main Metrics DEPOSIT AMOUNT** = tổng gross volume tất cả deposit transaction types

Để phân tích AUM và net flow → dùng Amount.Fee. Để phân tích loại giao dịch nào phổ biến → dùng Main Metrics.

### Đọc Amount.Fee image — Hướng dẫn

Fetch bằng `get-custom-view-image(customViewId, width=1400, height=900)`. View có Monthly timeframe với các sections:

**AUM chart** — giá trị cuối tháng (stock metric). Labels dạng "3,405.8" tỷ VND.

**`#deposit.amount` chart** (unit: tỷ VND) — tổng deposit tháng.

**`#redemption.amount` chart** (unit: tỷ VND) — tổng redemption tháng.

**`Net Amount` chart** (unit: tỷ VND) — **DỄ ĐỌC NHẤT.** Formula hiển thị: `net amount = deposit - withdraw`. Màu xanh = dương, đỏ = âm.

**`#earning.amount` chart** (unit: triệu VND) — lãi suất trả cho user.

**Cross-check:** Deposit - Redemption ≈ Net Amount. AUM delta = Net flow + Earning amount.

**Confirmed values (custom view 052026, 4/1–6/11/2026):**
- T4 (Apr 30): AUM **3,405.8B** | deposit 4,402.7B | redemption 4,366.4B | net **+36.3B**
- T5 (May 31): AUM **3,396.6B** | deposit 4,499.2B | redemption 4,520.1B | net **-21.0B**
- T6 MTD (Jun 11): AUM **3,542.0B** | net **+141.2B**

> ⚠️ AUM T4 = **3,405.8B** — visual estimate cũ ~3,480B là sai (chênh 74B, MoM thực = -0.27% không phải -2.4%)

---

## Step 5: Quy tắc xử lý dữ liệu không đầy đủ

### Tháng đã kết thúc — KHÔNG ước tính

Nếu default view không cover đủ tháng, **không** extrapolate hay estimate. Thay vào đó:
1. Fetch custom view nếu user đã save
2. Nếu không có custom view → báo rõ: "Data cho [tháng X] chỉ có từ [ngày Y], không đủ để report. Cần save custom view trên Tableau với date range [tháng X đầy đủ]."
3. Hiện thực chỉ những số confirmed, đánh dấu rõ khoảng thời gian có data.

### Tháng chưa kết thúc (MTD) — thêm cột Estimated Full Month

```
Run-rate estimate = (MTD actual / số ngày đã qua) × tổng số ngày trong tháng
```

Điều chỉnh nếu có MoM trend rõ ràng từ các tháng trước. Luôn ghi chú công thức và số ngày đã dùng.

---

## Step 6: Views nên fetch

### A. Business Performance workbook

| View | Lấy gì | Lưu ý |
|------|--------|-------|
| **MMF - MTD - Retention** ★★★ | MAU tổng + NAU/FAU/RAU | No filter = MAU tổng; filter `User Type` = N/F/R |
| **Amount.Fee** ★★★ | AUM, deposit, redemption, net flow, earning | **Image only** (CSV 404); width=1400, height=900; dùng custom view nếu cần date range khác |
| **Main Metrics** ★★ | NFAU, transaction type breakdown | Dùng khi cần breakdown by transaction type |

### B. Product workbook

| View | Lấy gì | Lưu ý |
|------|--------|-------|
| **Tài Khoản Tích Lũy** ★★★ | Registration, activation rate | Custom view nếu cần date range khác |
| **Entrance Traffic** ★★★ | G2 traffic source breakdown | Dùng custom view `052026-G2trafffic` để có data đủ kỳ |
| Nuôi heo chắt chill | — | Skip, outdated |

---

## Step 7: Transaction type glossary

### Deposit
| Transaction Type | Ý nghĩa |
|-----------------|---------|
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
| `redemption_for_pay` | Thanh toán merchant |
| `redemption_for_paylater` | Trả nợ BNPL |
| `redemption_for_stock` | Nạp tiền vào chứng khoán |
| `redemption_for_transfer` | Chuyển tiền nói chung |
| `redemption_to_wallet` | Rút từ MMF về ví ZaloPay |
| `refund` | Hoàn tiền |

---

## Step 8: Key segments & dimensions

| Segment | Định nghĩa |
|---------|-----------|
| **NAU** (New App User) | User mới của ZaloPay mà **dịch vụ đầu tiên** họ dùng là MMF |
| **FAU** (First-time Active User) | User **không mới** với ZaloPay nhưng lần đầu tiên dùng MMF |
| **RAU** (Returning Active User) | User cũ của MMF (đã từng dùng MMF trước đó, quay lại) |
| **G1** | User cũ của MMF |
| **G2** | User mới của MMF (= NAU + FAU) |

- **Merchant Distribution**: User dùng MMF `pay` cho merchant nào (IRIS MEDIA = nạp điện thoại)

---

## Step 9: Analysis framework

| # | Nội dung | Nguồn data |
|---|----------|-----------|
| 9.1 | MAU, daily avg | Retention MTD view |
| 9.2 | AUM cuối tháng | Amount.Fee image |
| 9.3 | Deposit, redemption, net flow per month | Amount.Fee image (Net Amount chart) |
| 9.4 | Transaction type breakdown | Main Metrics |
| 9.5 | NFAU | Main Metrics (TOTAL NFAU field) |
| 9.6 | Registration, activation rate | Product dashboard |
| 9.7 | G2 traffic source breakdown | Custom view `052026-G2trafffic` |

### Khi FAU tăng — drill down G2 traffic source qua custom view

FAU = user ZaloPay cũ lần đầu dùng MMF → driver của FAU nằm ở **traffic source nào đang đưa user ZaloPay vào MMF**. Khi FAU tăng MoM, luôn xác định source nào tăng.

**Cách fetch:**

```
get-custom-view-data(customViewId="4788fbcc-91df-416b-b689-1a4954a954c9")
```

CSV trả về các cột: `Break by` (entry point/source), `Period Type`, `Min. trans_date`, `total_signup_fe` (số signup vào MMF). So sánh `total_signup_fe` theo source giữa các period để xác định MoM delta.

**Cách đọc kết quả:**
- Group theo `Break by` → cộng tổng `total_signup_fe` cho từng period
- Source nào tăng nhiều nhất → driver của FAU tăng
- Chú ý **deposit conversion rate** (nếu có trong view) — source có conversion cao là source chất lượng, đáng ưu tiên

**Confirmed benchmark từ kỳ 4/1–6/11/2026:**
- `home` (~35K signup/tuần) — source lớn nhất nhưng đang giảm nhẹ (-7.1% MoM)
- `crmnoti_remindcollectcashback` (~14K/tuần) — giảm -8.3% MoM
- `fs_hub` (~14K/tuần) — **source duy nhất tăng (+6.1%)**, deposit conversion cao nhất (16.9%) → source chất lượng nhất
- `unlink_tt40` (606→774/tuần) — source mới nổi liên quan TT40 compliance
- `notification_nba_x2_coin` — xuất hiện đột biến từ campaign ngắn hạn (1,784 signups trong 4 ngày T6)

**Lưu ý quan trọng về NAU:**
NAU = user **mới ZaloPay** (chưa có tài khoản ZaloPay trước đó). Entrance Traffic/G2 traffic view chỉ track user ZaloPay có sẵn vào MMF lần đầu (= FAU). NAU tăng không trace được qua view này — cần xác nhận với growth/acquisition team ở ZaloPay level.

**Khi cần kỳ báo cáo khác:** Yêu cầu user save custom view mới trên Entrance Traffic view với date range phù hợp, sau đó dùng `list-custom-views(workbookId="6dc7061d-a555-4927-827c-4b3cb26d5cca")` để lấy ID mới.

---

## Step 10: Output format

```
| Metric | T(n-2) | T(n-1) | T(n) MTD Dxx | T(n) Est. |
|--------|--------|--------|:------------:|:---------:|
| MAU | | | | |
| Daily avg users | | | | |
| AUM cuối kỳ (tỷ VND) [Amount.Fee] | | | | — |
| Deposit amount (tỷ VND) [Amount.Fee] | | | | |
| Redemption amount (tỷ VND) [Amount.Fee] | | | | |
| Net flow (tỷ VND) [Amount.Fee] | | | | |
| NFAU [Main Metrics] | | | | |
| Activation rate | | | | |
```

- AUM không có cột estimate (stock metric — không extrapolate)
- MAU estimate: dùng MoM trend, không dùng run-rate
- Net flow dương = net inflow; âm = net outflow

---

## Troubleshooting

| Vấn đề | Cách xử lý |
|--------|-----------|
| 403 error | Tableau session hết hạn → nhắc user reconnect |
| Timeout | Fetch image trước, sau đó fetch CSV với filters hẹp hơn |
| Date range bị lock | Dùng custom view workflow (Step 2) |
| `get-custom-view-data` 404 trên Amount.Fee | Expected — dùng `get-custom-view-image` width=1400 height=900 |
| query-datasource lỗi | VizQL disabled trên server này — không dùng được |
| TOTAL USER bị inflate | Kiểm tra timeframe — nếu Daily thì không phải MAU, dùng Retention MTD view |
| Thiếu data tháng đã kết thúc | Không estimate — báo user cần save custom view với đúng date range |
| Net flow từ Amount.Fee ≠ AUM delta | Bình thường — AUM delta = net flow + earning amount (lãi suất) |
| N/F/R sum ≠ total MAU | Bình thường — dùng total MAU (no filter) làm official |
| Hidden sheets trong workbook | Tableau API không expose hidden sheets — nhờ owner publish sheet thành view riêng |
| G2 traffic custom view hết hạn | Dùng `list-custom-views` để tìm ID mới hoặc nhờ user save custom view mới |
