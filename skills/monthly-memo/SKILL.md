---
name: monthly-memo
description: >
  Write a monthly MMF (Money Market Fund) report memo in the Investment team's format at ZaloPay/VNG. Use this skill whenever someone wants to write, draft, or prepare a monthly report for MMF, monthly update, monthly memo, tháng memo, báo cáo tháng MMF, or monthly business review for the Investment team. Also trigger when someone mentions "viết report tháng", "làm monthly", "cập nhật tháng", "monthly priorities", or shares raw notes about MMF performance (MAU, AUM, activation rate, roadmap status). The output is a structured MMF report with Executive Summary, Performance table + insights, Key Priorities table, and Roadmap sections — matching the Investment team's Confluence format.
---

# MMF Monthly Memo Skill

You are helping write a **monthly report for the MMF (Money Market Fund) product** in the format used by the Investment team at ZaloPay/VNG. This is a structured, table-driven document — not prose paragraphs. It follows the spirit of the leadership memo guideline (honest reflection, causal reasoning, specific numbers, options over symptoms) but in the team's actual working format.

---

## Document Structure

```
YYYY.MM-Investment

Executive Summary
  → One bolded callout line for MMF: key result or key priority this month

I. MMF (Money Market Fund)
  1. Performance Overview
     - Metrics table (MAU/AUM/Deposit/Redemption/Activation Rate vs KPI + MoM)
     - Performance Insights: bullet points explaining WHY numbers moved
  2. Key Priorities
     - Table: Category | What Went Well | What Needs to Be Improved | Next Step
  3. Roadmap & Risk
     - (Optional) Roadmap Highlights table (quarterly view by theme)
     - Detailed roadmap table grouped by Vietnamese thematic headers
```

---

## Step 1: Collect Inputs

Ask the user for (or extract from their notes if pasted):

1. **Month and year** (e.g., "May 2026")
2. **Performance data**:
   - MAU total + N (new), F (FAU/first-time depositors), R (RAU/returning users)
   - AUM in billion VND (tỷ VND)
   - Deposit and Redemption volume or transaction count
   - Activation Rate (% of registered users who have ever deposited)
   - KPI targets and previous month actuals for comparison
3. **What went well** — per initiative or focus area, with specific outcomes and data where possible
4. **What needs improvement** — root causes, not just surface results
5. **Next steps** — with sprint references (e.g., Sprint 5A) or dates
6. **Roadmap updates** — status changes, new items, blockers, dependencies

If the user pastes raw notes or a brain dump, extract these fields and ask only for what's genuinely missing. Don't gatekeep every field — leave cells as `—` if data isn't available.

---

## Step 2: Executive Summary

One bold line summarizing the MMF headline for this month:

```
**MMF — [Key Priority Name]:** [1–2 sentences on the most important result or challenge this month, and why it matters]
```

Choose what matters most to leadership this month: if MAU is recovering after a drop, say that. If a critical initiative (like Snapshot Balance) is delayed, flag it here. If AUM exceeded KPI, lead with that momentum.

---

## Step 3: Performance Overview

### 3.1 Metrics Table

| Metric | [Prev Month] Actual | % vs KPI | [This Month] Actual | MoM Growth | % vs KPI |
|--------|---------------------|----------|---------------------|------------|----------|
| MAU | | | | | |
| — New (N) | | | | | |
| — First-time/FAU (F) | | | | | |
| — Returning/RAU (R) | | | | | |
| AUM (tỷ VND) | | | | | |
| Deposit | | | | | |
| Redemption | | | | | |
| Activation Rate | | | | | |

Formatting conventions:
- MAU sub-rows (N/F/R) are indented with a dash prefix
- MoM Growth: `+X%` or `-X%`
- % vs KPI: X% where 100% = on target, >100% = exceeded
- AUM in tỷ VND; omit decimal if user didn't provide it
- Use `—` for any metric the user didn't track

### 3.2 Performance Insights

Write 3–5 bullet points **explaining why the numbers moved** — the analyst's read on the table, not a restatement of it.

Each insight should name:
- **Causal factors**: seasonality (e.g., post-Tết dip), feature-driven effects (e.g., cashier flow suspension, idempotency going live), market conditions (e.g., interest rate competitiveness vs MBBank/TCB)
- **Structural vs temporary**: distinguish patterns that need a product response from one-off fluctuations
- **Activation Rate signal**: this metric tracks the structural gap between registered and depositing users (historically ~80% of registered users have never deposited). Call out movement and its cause
- **What drove growth**: specific features live, campaigns, partner contribution (e.g., Infina), seasonality tailwinds

Bad insight: "MAU decreased 4%." Good insight: "MAU giảm 4% MoM do tháng 2 là peak (Tết) nên tháng 3 có xu hướng seasonal giảm lại, cộng thêm lãi suất hiện tại chưa đủ cạnh tranh so với MBBank và TCB đang offer 5.2%."

---

## Step 4: Key Priorities

| Category | What Went Well | What Needs to Be Improved | Next Step |
|----------|---------------|--------------------------|-----------|

Recurring categories to consider (use what's relevant; omit empty rows):
- **Tech Improvements** — system stability, idempotency, Snapshot Balance, operational reliability
- **Improving MAU** — new user acquisition, FAU conversion, activation rate improvement
- **Sustaining AUM / Retention** — returning users (RAU), redemption flow, interest rate strategy
- **Fund-loss Prevention** — SDSL (Số Dư Sinh Lời), Infina reconciliation, fund-loss risk controls
- **Cross-sell / Growth** — MMF-to-other-products, partner onboarding (Infina)

Column guidelines:
- **What Went Well**: specific deliverables or data. If nothing truly went well in a category, use `—` — don't invent positives.
- **What Needs to Be Improved**: the most important column. Go to root cause. "FAU giảm 60% do luồng Cashier bị tạm dừng" is right. "FAU decreased" is not.
- **Next Step**: concrete action with sprint name or date. Flag cross-team dependencies here.

**Decision/blocker framing**: When a cell has a significant unresolved issue — a delay, a strategic choice, a dependency at risk — expand the cell to present the options (at minimum 2), their trade-offs, and a recommended path. This is the leadership communication style that matters. Don't just name the problem; frame the decision.

---

## Step 5: Roadmap & Risk

### 5.1 Roadmap Highlights (Optional)

Include when there's a quarter-view worth showing. A compact 2–3 month forward table by theme:

| Theme | MM.YYYY | MM.YYYY | (MM.YYYY) |
|-------|---------|---------|-----------|

Use the same thematic groups (Vietnamese) as row labels.

### 5.2 Detailed Roadmap Table

One single merged table — no sub-headers. Add a **Theme** column so readers can scan by category without the table splitting into separate blocks.

```
|| Theme || Initiative || Description || Status || Note ||
| Hệ thống ổn định | Snapshot Balance | Chụp số dư định kỳ... | {status:colour=Red|title=DELAY} | Delay do: ... |
| Hệ thống ổn định | Idempotency v2 | Ngăn duplicate tx... | {status:colour=Green|title=LIVE 10/5} | No incident post-launch |
| Hạn chế fund-loss | SDSL (Infina) | Kiểm tra SDSL... | {status:colour=Grey|title=PENDING} | Dependency: CXM API spec |
```

Group rows by theme (all rows of the same theme together), but do not add sub-headers — the Theme column carries that information.

**Theme labels** (Vietnamese, abbreviated to fit the column):

| Full label | Short form for table |
|---|---|
| Hạn chế fund-loss | Hạn chế fund-loss |
| Hệ thống hoạt động ổn định | Hệ thống ổn định |
| Vận hành tinh gọn và chính xác | Vận hành tinh gọn |
| Hỗ trợ khách hàng hiệu quả | Hỗ trợ KH |
| Đảm bảo pháp lý | Đảm bảo pháp lý |
| UX improvement | UX improvement |

**Status** — use Confluence `{status}` macro (colored badge with white text):

| Status | Macro |
|---|---|
| LIVE [date] | `{status:colour=Green\|title=LIVE DD/MM}` |
| RELEASE [date] | `{status:colour=Green\|title=RELEASE DD/MM}` |
| IN PROGRESS | `{status:colour=Blue\|title=IN PROGRESS}` |
| IN PLAN | `{status:colour=Yellow\|title=IN PLAN}` |
| PENDING | `{status:colour=Grey\|title=PENDING}` |
| DELAY | `{status:colour=Red\|title=DELAY}` |

**Note column** — never leave empty for PENDING, DELAY, or IN PROGRESS:
- `DELAY`: name root causes specifically + expected sprint/date
- `PENDING`: state what's blocking (e.g., "Dependency: CXM API spec chưa có")
- `IN PROGRESS`: current progress + target sprint
- `LIVE`: early metrics post-launch or what "done" means if non-obvious

---

## Color Coding Rules (Confluence markup)

The output is **Confluence wiki markup**, not Markdown. This is required so colors render correctly when pasted via "Insert → Markup" in Confluence.

### Percentage values — use `{color}` macro on the text

Apply to: **MoM Growth** and **% vs KPI** columns in the performance table, and any % figures cited inline.

| Value type | Rule | Syntax |
|---|---|---|
| MoM Growth positive | Green text | `{color:green}+X%{color}` |
| MoM Growth negative | Red text | `{color:red}-X%{color}` |
| % vs KPI ≥ 100% | Green text | `{color:green}X%{color}` |
| % vs KPI < 90% | Red text | `{color:red}X%{color}` |
| % vs KPI 90–99% | No color | plain `X%` |

Thresholds are guidelines — use judgment. A 95% KPI attainment trending upward doesn't need red. The goal is quick visual scanning, not false alarms.

### Status labels — use `{status}` macro (colored background, white text)

Use the exact macros from the table in Section 5.2. Do not write plain text like "LIVE" — always use the macro so the badge renders.

---

## Writing Standards

**Explain why, not just what.** Numbers without explanation are noise. Every metric movement should have a named cause — seasonality, a specific feature event, market conditions, a dependency problem.

**Be honest.** If a priority slipped, say so and name the real reason. "Delayed due to bandwidth" is vague. "Delayed because Tech team was pulled onto a P0 Cashier bug" is honest.

**Options over sympt