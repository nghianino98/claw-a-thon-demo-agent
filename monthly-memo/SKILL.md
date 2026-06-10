---
name: monthly-memo
description: >
  Write a monthly report memo following the VNG/Zalopay prose-based memo format. Use this skill whenever someone wants to write, draft, or prepare a monthly report, monthly update, monthly memo, or monthly business review. Also trigger when someone mentions "monthly meeting prep", "báo cáo tháng", "monthly priorities", or asks to write up what their team did this month. The output is a self-sufficient, prose-only memo (no bullet points) covering all 7 required sections, ready to post to Confluence.
---

# Monthly Memo Skill

You are helping write a **monthly report memo** in the format required at VNG/Zalopay. This is a prose document — full paragraphs, complete sentences. No slides. No bullet points. The reader should understand the full picture without you in the room.

## Core Principles

**Prose, not bullets.** Bullet points hide thinking. Prose forces you to explain what happened, why, what the impact is, and what is being done. Every section must be written in complete sentences and paragraphs.

**Be specific, not vague.** "Improving compliance coverage" is a line anyone can write in five seconds. Good writing names exactly what is being improved, measured by what, by when. Vague language is a sign the thinking isn't done yet.

**Be honest.** Reflect what the team did and didn't do well. Don't stop at surface results — go to root causes and way of working. Don't retrofit last month's priorities to match what you actually did.

**Length: 600–1,200 words total.** Under 400 words = too vague. Over 1,500 words = operational detail that belongs in your team's working layer, not here.

---

## Interview the User First

Before writing, ask for the key inputs. You need:

1. **Team/function name** and the **month** being reported
2. **Last month's top 3 priorities** — what were they, and what happened to each?
3. **This month's top 3 priorities** — what are the 3 most important things and why now?
4. **SEL/strategic initiatives** — which quarterly milestones are active, and what's the status?
5. **Key metrics** — what moved, what's vs target, and what does it mean?
6. **Biggest risk or bottleneck** right now
7. **Any decisions or help needed** from leadership?
8. **What changed** externally or internally since last month?

If the user provides raw notes, bullet points, or a brain dump — that's fine. Your job is to turn that material into well-written prose. Ask clarifying questions when the reasoning is unclear or a cause/impact is missing.

---

## The 7-Section Template

Write each section as prose. Use the section titles as headers.

### Section 1: Top 3 Priorities of the Incoming Month

State the three most important things the function is focused on achieving this month — not everything, only what matters most right now. For each priority, name it and explain in 1–2 sentences the *why now*: why this priority, why this month. If someone claims five equally important priorities, push back — that means ranking hasn't happened.

**Avoid:** Evergreen priorities like "continue improving team performance." Name specific, time-bound things.

**Target length:** 3–5 sentences total.

**Example of good writing:** *"Our top priority this month is delivering the Bank Fee Automation feature on Bank Portal — the T+1 automated calculation and export of 80 monthly reconciliation statements — which must be ready before the April month-end cycle to be useful. If it misses this window, the team absorbs another month of manual effort across 80 partners, and downstream reporting to VNG gets delayed."*

---

### Section 2: Update on Last Month's Top 3 Priorities

Close the loop on last month's three priorities. Cover two dimensions: **delivery** (did it happen?) and **impact** (did it produce the expected result?). A priority can be fully delivered but land differently than expected — that second dimension is often where the real learning lives.

**Shortcut:** If everything went as planned and impact was as expected, one sentence is enough: *"All three priorities from [month] were delivered as planned and are tracking to the expected outcomes."* Don't pad this section.

**Write more** when there was a deviation — delivery slipped, scope changed, or impact differed. Positive surprises are worth documenting too. Be honest: if you said priority X and spent your time on Y, say that and explain why.

**Target length:** 1 sentence if all went as planned; 3–6 sentences per deviation.

---

### Section 3: Progress on Strategic Execution List (SEL)

Report on major initiatives from the SEL that have an active milestone this quarter. For each, cover: (1) what was planned, (2) where you actually are, (3) what is driving any gap or acceleration, (4) what you expect by end of quarter.

This section is cumulative across the quarter — each month's report carries an update on the same initiatives so someone can read all three months and see the full arc.

Don't just say "on track." Explain what that means in concrete terms. If something is behind, say so and say why. Leadership cannot help clear a blocker they don't know about.

**Target length:** 2–4 sentences per active initiative.

---

### Section 4: KPI and Key Metric Movement

Present the key metrics that tell the clearest story of whether the function is healthy — not every metric tracked, just the most important ones. Report movement MoM, YoY where relevant, and vs KPI target.

Then **interpret** the numbers. Don't just list them. What are the numbers saying? What is better or worse than expected? What are you doing about it? The data layer is easy — this section is about the meaning layer.

If there's a live dashboard, link to it and write the interpretive narrative here instead of recreating tables of numbers.

*Functions without quantitative KPIs may skip this section or use qualitative data.*

**Target length:** 2–4 sentences per key metric cluster.

---

### Section 5: Biggest Risk or Bottleneck

Name the one or two things that most threaten the ability to deliver on the plan this month or quarter. Be specific. Name the risk, explain its root cause, quantify the potential impact where possible, describe what's already being done, and flag whether help from leadership is needed.

**Avoid:** Generic risks like "resourcing constraints" or "market uncertainty." Name what is specifically at risk, right now, in this function.

This section should connect naturally into Section 6.

**Target length:** 3–6 sentences.

---

### Section 6: Decisions or Help Needed from Leadership

Make specific asks. If a decision is needed, name what the decision is, what the options are, and what the recommendation is. If cross-functional help is needed, name it precisely.

Not every report needs something here — "None this month" is a valid answer. But when there is an ask, make it clear and specific. Don't write "additional senior support." Say exactly what is needed, so leadership can say yes, no, or let's discuss.

**Target length:** 3–5 sentences per ask, or "None this month."

---

### Section 7: What Changed Since Last Month

Capture 1–3 developments in the external or internal environment that shifted context since the last report. Each development should be connected to an implication or action — don't just report the news, say what it means for the team.

For front-office teams: significant partner or competitor moves. For risk/compliance teams: new regulatory drafts, enforcement actions, or fraud pattern changes. For data/engineering: infrastructure or tooling changes. For FP&A/Accounting: macro developments affecting cost or revenue assumptions.

**Avoid:** Generic industry updates with no clear implication. If you mention a development, say what it means or what you're watching as a result.

**Target length:** 2–4 sentences per development.

---

## Quality Checklist Before Finalizing

Before you output the memo, verify:

- [ ] All 7 sections are present and written in full prose (no bullet points anywhere)
- [ ] Total word count is 600–1,200 words
- [ ] Section 1 priorities each have an explicit *why now*
- [ ] Section 2 covers both delivery AND impact (not just what was done)
- [ ] Section 3 names each initiative and states what was planned vs actual
- [ ] Section 4 includes an interpretive narrative, not just numbers
- [ ] Section 5 names a specific risk with root cause and impact
- [ ] Section 6 either makes a specific ask or states "None this month"
- [ ] Section 7 connects each development to an implication

If the memo is under 400 words, push back to get more substance. If it's over 1,500 words, tighten by removing operational detail.

---

## Output Format

Produce the memo as clean Markdown with the 7 section headers. It should be ready to paste into Confluence. Do not include a cover page or metadata header — start directly with Section 1.

If the user provides raw notes, write the full memo draft. If they want to iterate, incorporate their edits and re-check the quality checklist.
