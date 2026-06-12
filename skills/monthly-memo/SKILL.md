---
name: monthly-memo
description: >
  Write a monthly MMF (Money Market Fund) report memo in the Investment team's format at ZaloPay/VNG. Use this skill whenever someone wants to write, draft, or prepare a monthly report for MMF, monthly update, monthly memo, tháng memo, báo cáo tháng MMF, or monthly business review for the Investment team. Also trigger when someone mentions "viết report tháng", "làm monthly", "cập nhật tháng", "monthly priorities", or shares raw notes about MMF performance (MAU, AUM, activation rate, roadmap status). The output is a structured MMF report with Executive Summary, Performance table + insights, Key Priorities table, and Roadmap sections — matching the Investment team's Confluence format.
---

# MMF Monthly Memo Skill

You are helping write a **monthly report for the MMF (Money Market Fund) product** in the format used by the Investment team at ZaloPay/VNG. This is a structured, table-driven document — not prose paragraphs. It follows the spirit of the leadership memo guideline (honest reflection, causal reasoning, specific numbers, options over symptoms) but in the team's actual working format.

---

## Document Structure

YYYY.MM-Investment

Executive Summary: One bolded callout line for MMF: key result or key priority this month

I. MMF (Money Market Fund)
  1. Performance Overview: Metrics table (MAU/AUM/Deposit/Redemption/Activation Rate vs KPI + MoM), then Performance Insights
  2. Key Priorities: Table with Category | What Went Well | What Needs to Be Improved | Next Step
  3. Roadmap & Risk: Optional quarterly highlights table + detailed roadmap table

--- Notes (for review — delete before publishing) ---
  → All data caveats, accuracy notes, calculation assumptions collected here

---

## KPI Reference Table

Use this table to populate the **% vs KPI** column for MAU and AUM automatically — do not ask the user for these KPI targets.

| Month | MAU KPI (K users) | AUM KPI (ty VND) |
|-------|-------------------|------------------|
| Jan 2026 | 960 | 3,743 |
| Feb 2026 | 984 | 3,802 |
| Mar 2026 | 1,045 | 3,996 |
| Apr 2026 | 1,114 | 4,217 |
| May 2026 | 1,183 | 4,435 |
| Jun 2026 | 1,252 | 4,649 |
| Jul 2026 | 1,322 | 4,859 |
| Aug 2026 | 1,391 | 5,065 |
| Sep 2026 | 1,461 | 5,267 |
| Oct 2026 | 1,529 | 5,459 |
| Nov 2026 | 1,596 | 5,641 |
| Dec 2026 | 1,680 | 5,881 |
| Jan 2027 | 1,695 | 6,205 |
| Feb 2027 | 1,732 | 6,630 |
| Mar 2027 | 1,772 | 7,098 |
| Apr 2027 | 1,809 | 7,576 |
| May 2027 | 1,842 | 8,069 |
| Jun 2027 | 1,872 | 8,576 |
| Jul 2027 | 1,898 | 9,097 |
| Aug 2027 | 1,921 | 9,631 |
| Sep 2027 | 1,941 | 10,177 |
| Oct 2027 | 1,957 | 10,731 |
| Nov 2027 | 1,968 | 11,288 |
| Dec 2027 | 1,971 | 11,828 |

AUM KPI source unit is VND mn — already converted to ty VND here (divided by 1,000). MAU KPI is in thousands of users.

---

## Step 1: Collect Inputs

Ask the user for (or extract from their notes if pasted):

1. **Month and year** (e.g., "May 2026")
2. **Performance data**:
   - MAU total + N (new), F (first-time depositors), R (returning users)
   - AUM in ty VND
   - Deposit and Redemption volume or transaction count
   - Activation Rate
   - Previous month actuals for MoM comparison
3. **What went well** — per initiative or focus area, with specific outcomes and data where possible
4. **What needs improvement** — root causes, not just surface results
5. **Next steps** — with sprint references or dates
6. **Roadmap updates** — status changes, new items, blockers, dependencies

If the user pastes raw notes or a brain dump, extract these fields and ask only for what's genuinely missing. Leave cells as - if data is not available.

---

## Step 2: Executive Summary

One bold line summarizing the MMF headline for this month:

**MMF — [Key Priority Name]:** [1-2 sentences on the most important result or challenge this month, and why it matters]

Choose what matters most to leadership: if MAU is recovering after a drop, say that. If a critical initiative is delayed, flag it here. If AUM exceeded KPI, lead with that momentum.

---

## Step 3: Performance Overview

### 3.1 Metrics Table

| Metric | [Prev Month] Actual | % vs KPI | [This Month] Actual | MoM Growth | % vs KPI |
|--------|---------------------|----------|---------------------|------------|----------|
| MAU | | | | | |
| — New | | | | | |
| — First-time | | | | | |
| — Returning | | | | | |
| AUM (ty VND) | | | | | |
| Deposit | | | | | |
| Redemption | | | | | |
| Activation Rate | | | | | |

Formatting conventions:
- For **MAU** and **AUM**, look up KPI targets from the reference table above and compute % vs KPI = Actual / KPI x 100%
- MAU sub-rows (New/First-time/Returning) do not have individual KPI targets — use — in their % vs KPI cells
- MoM Growth: +X% or -X%
- % vs KPI: X% where 100% = on target, >100% = exceeded
- AUM in ty VND (no decimal if user didn't provide it)
- Use — for any metric the user didn't provide
- **Do not add parenthetical definitions or unit labels inside table cells** — keep cells clean

### 3.2 Performance Insights

Write 3-5 bullet points **explaining why the numbers moved** — the analyst's read on the table, not a restatement of it.

Each insight should name:
- **Causal factors**: seasonality, feature-driven effects, market conditions
- **Structural vs temporary**: distinguish patterns that need a product response from one-off fluctuations
- **Activation Rate signal**: call out movement and its cause
- **What drove growth**: specific features live, campaigns, partner contribution, seasonality tailwinds

Bad insight: "MAU decreased 4%." Good insight: "MAU giam 4% MoM do thang 2 la peak nen thang 3 co xu huong seasonal giam lai, cong them lai suat hien tai chua du canh tranh so voi MBBank va TCB dang offer 5.2%."

---

## Step 4: Key Priorities

The priorities table reflects **what needs attention based on current performance** — ordered by strategic importance.

| Category | What Went Well | What Needs to Be Improved | Next Step |
|----------|---------------|--------------------------|-----------|

**Category order** (always follow this priority):
1. **Improving MAU** — new user acquisition, first-time depositor conversion, activation rate
2. **Growing AUM** — AUM growth drivers, interest rate competitiveness, deposit volume
3. **Tech & System Improvements** — system stability, operational reliability, key infra projects
4. **Retention** — returning users, redemption flow, churn signals

Include only categories where there is something meaningful to report. Omit empty rows.

Column guidelines:
- **What Went Well**: specific deliverables or data. Use — if nothing truly went well — don't invent positives.
- **What Needs to Be Improved**: the most important column. Go to root cause. "FAU giam 60% do luong Cashier bi tam dung" is right. "FAU decreased" is not.
- **Next Step**: concrete product or engineering action with sprint name or date. Flag cross-team dependencies. **Do not write next steps about data collection, querying metrics, or clarifying data gaps** — every next step should be something the team can execute.

**Decision/blocker framing**: When a cell has a significant unresolved issue — a delay, a strategic choice, a dependency at risk — expand the cell to present options (at minimum 2), their trade-offs, and a recommended path. Don't just name the problem; frame the decision.

---

## Step 5: Roadmap & Risk

### 5.1 Roadmap Highlights (Optional)

Include when there is a quarter-view worth showing. A compact 2-3 month forward table by theme:

| Theme | MM.YYYY | MM.YYYY | (MM.YYYY) |
|-------|---------|---------|-----------|

### 5.2 Detailed Roadmap Table

One single merged table — no sub-headers. Add a **Theme** column so readers can scan by category.

Group rows by theme; do not add sub-headers — the Theme column carries that information.

**Theme labels** (Vietnamese):

| Full label | Short form for table |
|---|---|
| Han che fund-loss | Han che fund-loss |
| He thong hoat dong on dinh | He thong on dinh |
| Van hanh tinh gon va chinh xac | Van hanh tinh gon |
| Ho tro khach hang hieu qua | Ho tro KH |
| Dam bao phap ly | Dam bao phap ly |
| UX improvement | UX improvement |

**Status** — use Confluence {status} macro (colored badge with white text):

| Status | Macro |
|---|---|
| LIVE [date] | {status:colour=Green|title=LIVE DD/MM} |
| RELEASE [date] | {status:colour=Green|title=RELEASE DD/MM} |
| IN PROGRESS | {status:colour=Blue|title=IN PROGRESS} |
| IN PLAN | {status:colour=Yellow|title=IN PLAN} |
| PENDING | {status:colour=Grey|title=PENDING} |
| DELAY | {status:colour=Red|title=DELAY} |

**Note column** — never leave empty for PENDING, DELAY, or IN PROGRESS:
- DELAY: root cause + expected sprint/date
- PENDING: what is blocking (e.g., "Dependency: CXM API spec chua co")
- IN PROGRESS: current progress + target sprint
- LIVE: early metrics post-launch or what "done" means if non-obvious

---

## Step 6: Notes Section

At the very end of the report, always add a clearly marked section collecting all caveats. Use this format:

---
WARNING: Notes for review — delete before publishing

- [Any caveats about data accuracy]
- [Any data gaps — list which cells are marked — and why]
- [Calculation notes — how each metric is defined and computed]
- [KPI comparison notes — confirm if targets were revised this quarter]
---

Collect **all** accuracy caveats, missing data flags, and calculation assumptions here — never scatter them as inline footnotes or parentheticals within the report body. This makes it easy to review and delete the whole section before publishing to Confluence.

---

## Color Coding Rules (Confluence markup)

The output is **Confluence wiki markup**, not Markdown. This is required so colors render correctly when pasted via "Insert - Markup" in Confluence.

### Percentage values — use {color} macro on the text

Apply to: MoM Growth and % vs KPI columns in the performance table, and any % figures cited inline.

| Value type | Rule | Syntax |
|---|---|---|
| MoM Growth positive | Green text | {color:green}+X%{color} |
| MoM Growth negative | Red text | {color:red}-X%{color} |
| % vs KPI >= 100% | Green text | {color:green}X%{color} |
| % vs KPI < 90% | Red text | {color:red}X%{color} |
| % vs KPI 90-99% | No color | plain X% |

Thresholds are guidelines — use judgment. A 95% KPI attainment trending upward doesn't need red.

### Status labels — use {status} macro (colored background, white text)

Use the exact macros from the table in Section 5.2. Do not write plain text like "LIVE" — always use the macro so the badge renders.

---

## Writing Standards

**Explain why, not just what.** Numbers without explanation are noise. Every metric movement should have a named cause — seasonality, a specific feature event, market conditions, a dependency problem.

**Be honest.** If a priority slipped, say so and name the real reason. "Delayed due to bandwidth" is vague. "Delayed because Tech team was pulled onto a P0 Cashier bug" is honest.

**Options over symptoms.** When the report surfaces a problem, don't just describe it — frame the decision: what are the options, what are the trade-offs, what is the recommendation?

**No inline definitions.** Do not add parenthetical definitions or clarifications inside the report body. The report is for the investment team who already know these terms. All clarifications belong in the Notes section.

**Keep the report clean.** The body of the report should be decision-ready — executives should be able to read it without wading through caveats. All caveats, data limitations, and accuracy notes belong exclusively in the Notes section at the end.
