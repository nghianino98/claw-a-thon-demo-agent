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

### View IDs
| View | Workbook | ID |
|------|----------|----|
| Main Metrics | Business Performance | `158a6541-bef4-49ae-b128-b31c7cb6f62b` |
| MMF - MTD - Retention | Business Performance | `bf8385c2-ce92-4162-ac43-3708f18e72ed` |
| Tài Khoản Tích Lũy (Amount.Fee) | Business Performance | `3f38b963-d5ad-41d6-9556-231c35aa32f2` |
| Tài Khoản Tích Lũy (Product dashboard) | Product | `b142eb0d-6328-451e-8c17-7677b47d806b` |
| Entrance Traffic | Product | `f09813ea-ae93-46bb-baa7-5e157d4962c0` |

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

### `get-custom-view-data` trả về 404

Một số custom view không support CSV export — dùng `get-custom-view-image` thay thế để đọc số từ chart.

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

---

## Step 4: Nguồn data cho từng metric — QUY TẮC BẮT BUỘC

### Phân tách rõ ràng: Amount.Fee vs Main Metrics

| Metric | Lấy từ đâu | KHÔNG lấy từ đâu |
|--------|-----------|-----------------|
| **AUM** (cuối tháng) | **Amount.Fee** — đọc giá trị tại ngày cuối kỳ | ~~Main Metrics~~ |
| **Deposit volume** (tổng tháng) | **Main Metrics** | ~~Amount.Fee~~ |
| **Redemption volume** (tổng tháng) | **Main Metrics** | ~~Amount.Fee~~ |
| **MAU** | Retention MTD view | ~~Main Metrics Daily~~ |
| **NFAU** | Main Metrics (TOTAL NFAU field) | — |
| **Transaction type breakdown** | Main Metrics | — |

**Lý do phân tách:** Amount.Fee và Main Metrics đo deposit/redemption theo cách khác nhau (different transaction scope), dẫn đến số không nhất quán nếu trộn lẫn. Dùng Main Metrics cho tất cả volume metrics đảm bảo consistency. Amount.Fee chỉ dùng để đọc AUM vì đây là view chuyên về fund balance.

### Đọc AUM từ Amount.Fee

AUM là **stock metric** (số dư tại 1 thời điểm), không phải flow. Lấy giá trị tại ngày cuối kỳ:
- Tháng hoàn chỉnh: đọc AUM ngày cuối tháng (e.g., Apr 30, May 31)
- Tháng MTD: đọc AUM tại ngày cut-off mới nhất

### Đọc Deposit/Redemption từ Main Metrics

Main Metrics DEPOSIT AMOUNT và WITHDRAW AMOUNT bao gồm tất cả transaction types liên quan. Cộng tổng daily values cho cả tháng để ra monthly total.

---

## Step 5: Quy tắc xử lý dữ liệu không đầy đủ

### Tháng đã kết thúc — KHÔNG ước tính

Nếu default view không cover đủ tháng (e.g., Amount.Fee default bắt đầu từ 13/5), **không** extrapolate hay estimate. Thay vào đó:
1. Fetch custom view nếu user đã save (e.g., "052026" cho 4/1–6/11)
2. Nếu không có custom view → báo rõ: "Data cho [tháng X] chỉ có từ [ngày Y], không đủ để report. Cần save custom view trên Tableau với date range [tháng X đầy đủ]."
3. Hiện thực chỉ những số confirmed, đánh dấu rõ khoảng thời gian có data.

### Tháng chưa kết thúc (MTD) — thêm cột Estimated Full Month

Với tháng đang chạy, ngoài cột MTD actual, thêm cột **"Ước tính cuối tháng"** dựa trên run-rate:

```
Run-rate estimate = (MTD actual / số ngày đã qua) × tổng số ngày trong tháng
```

Điều chỉnh nếu có trend rõ ràng từ các tháng trước (e.g., nếu MAU thường tăng 1–2% MoM, áp dụng vào estimate thay vì chỉ dùng thuần run-rate). Luôn ghi chú công thức và số ngày đã dùng.

**Ví dụ:**

| Metric | T4 | T5 | T6 MTD D11 | T6 Est. cuối tháng |
|--------|:--:|:--:|:----------:|:-----------------:|
| MAU | 1,030,940 | 1,048,128 | 719,279 | ~1,095,000 ¹ |
| Deposit (tỷ) | 4,327 | 4,xxx | 1,959 | ~5,343 ² |

¹ Dựa MoM growth +1.67% T4→T5: ước tính T6 ~1,048,128 × 1.017 ≈ 1,066,000. Run-rate thuần: 719,279/11×30 ≈ 1,962,579 — chọn conservative estimate.
² 1,959 / 11 × 30 = 5,343B

---

## Step 6: Views nên fetch

### A. Business Performance workbook

| View | Lấy gì | Lưu ý |
|------|--------|-------|
| **MMF - MTD - Retention** ★★★ | MAU, daily users | CSV đầy đủ, không cần custom view cho date range |
| **Amount.Fee** ★★★ | **AUM cuối tháng** (chỉ metric này) | Custom view nếu cần date range ngoài default |
| **Main Metrics** ★★★ | **Deposit/redemption volume**, NFAU, transaction breakdown | Custom view nếu cần full month data |

### B. Product workbook

| View | Lấy gì | Lưu ý |
|------|--------|-------|
| **Tài Khoản Tích Lũy** ★★★ | Registration, activation rate, merchant distribution | Custom view nếu cần date range khác |
| **Entrance Traffic** ★★★ | Signup sources (G1/G2), entry point breakdown | Custom view G1traffic/G2traffic nếu cần full period |
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

### User segments (MMF)
| Segment | Định nghĩa |
|---------|-----------|
| **NAU** (New App User) | User mới của ZaloPay mà **dịch vụ đầu tiên** họ dùng là MMF |
| **FAU** (First-time Active User) | User **không mới** với ZaloPay nhưng lần đầu tiên dùng MMF |
| **RAU** (Returning Active User) | User cũ của MMF (đã từng dùng MMF trước đó, quay lại) |
| **G1** | User cũ của MMF |
| **G2** | User mới của MMF |

- **Merchant Distribution**: User dùng MMF `pay` cho merchant nào (IRIS MEDIA = nạp điện thoại)

---

## Step 9: Analysis framework

| # | Nội dung | Nguồn data |
|---|----------|-----------|
| 9.1 | MAU, daily avg | Retention MTD view |
| 9.2 | **AUM cuối tháng** | **Amount.Fee** (đọc giá trị ngày cuối kỳ) |
| 9.3 | **Deposit/redemption volume & breakdown** | **Main Metrics** |
| 9.4 | NFAU | Main Metrics (TOTAL NFAU field) |
| 9.5 | Registration, activation rate | Product dashboard |
| 9.6 | Traffic sources, G1/G2 | Entrance Traffic |

---

## Step 10: Output format

Luôn có cột "Ước tính cuối tháng" cho tháng chưa kết thúc. Đánh dấu nguồn data trong header:

```
## MMF – So sánh tháng

| Metric | T(n-2) | T(n-1) | T(n) MTD Dxx | T(n) Est. |
|--------|--------|--------|:------------:|:---------:|
| MAU | | | | |
| Daily avg users | | | | |
| AUM cuối kỳ (tỷ VND) [Amount.Fee] | | | | — |
| Deposit volume (tỷ VND) [Main Metrics] | | | | |
| Redemption volume (tỷ VND) [Main Metrics] | | | | |
| Net flow (tỷ VND) | | | | |
| NFAU [Main Metrics] | | | | |
| Activation rate | | | | |

Ghi chú ước tính: run-rate = MTD / Dxx × tổng ngày tháng [± MoM trend adjustment]
```

AUM không có cột estimate vì là stock metric — không extrapolate AUM.

---

## Troubleshooting

| Vấn đề | Cách xử lý |
|--------|-----------|
| 403 error | Tableau session hết hạn → nhắc user reconnect |
| Timeout | Fetch image trước, sau đó fetch CSV với filters hẹp hơn |
| Date range bị lock | Dùng custom view workflow (Step 2) |
| `get-custom-view-data` 404 | Dùng `get-custom-view-image` thay thế |
| query-datasource lỗi | VizQL disabled trên server này — không dùng được |
| TOTAL USER bị inflate | Kiểm tra timeframe — nếu Daily thì không phải MAU, dùng Retention MTD view |
| Thiếu data tháng đã kết thúc | Không estimate — báo user cần save custom view với đúng date range |
