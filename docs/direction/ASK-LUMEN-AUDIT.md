# Ask Lumen audit: what we promise vs what it answers (2026-10-16)

**Why:** the owner wants to share Lumen with recruiters and users. Before that, check every question the landing page
says Lumen answers, plus the questions a personal-finance assistant should handle, against the **live** product.

**Method:** 30 questions sent to production (`POST /chat`, release #74) from two fresh one-click demo accounts on
2026-10-16 (server date 2026-10-15). 14 come from the landing page (L), 16 are what a money assistant should answer (C).
Each answer graded: ✅ right and useful · ⚠️ partly right, misleading, or weaker than it should be · ❌ wrong, made up,
or no answer when one was possible.

**Result: 5 ✅ · 10 ⚠️ · 15 ❌.** Of the 14 landing-page questions: **1 ✅ · 4 ⚠️ · 9 ❌.**

## What the demo actually contains (half of the failures start here)
- A copy of the **eval world's user u1**: a small business's books (FreshMart, TechHub, OfficeNeeds, NetLink, City
  Power…), 3 supplier contracts, 6 purchase orders, an expense policy. Not a person's finances.
- **Transactions stop on 2026-06-27.** Every "this month / last month" question (October 2026) finds nothing.
- The demo profile has **no income and no budget**; there is **no rental agreement**, no phone bill, no account
  balance, no bill due dates.
- Setup takes **65-72 s per visitor** (measured 3×): the synthetic world is rebuilt, 10 PDFs are parsed, embedded and
  uploaded for every new visitor.

## The 30 answers

| # | Question | Grade | What happened | Root cause |
|---|---|---|---|---|
| L1 | Where did my money go last month? | ❌ | "No transactions in September" | A stale demo |
| L2 | How much would I save by cooking at home twice a week? | ❌ | Said it lacks data; never looked at its restaurant/food category | F reasoning |
| L3 | Can I afford a ₹60,000 trip in December? | ❌ | Asked for income and balance | B no income/balance |
| L4 | Why is my electricity bill so high this month? | ⚠️ | Found the June bill (₹2,506), honest, then generic reasons; no comparison with the usual bill | A stale, F |
| L5 | Which subscriptions haven't I used lately? | ✅ | StreamFlix + NetLink with last charge; honest that usage isn't visible | |
| L6 | Will I stay within budget this month? | ❌ | No budget to compare with | C no budgets |
| L7 | When does my rental agreement end? | ❌ | No rental agreement in the demo | A demo data |
| L8 | How long until I have ₹5 lakh saved? | ❌ | No savings figure | B |
| L9 | Did anyone charge me twice this month? | ⚠️ | "Looks clean" — but there is no data this month at all | A, F overclaims |
| L10 | Any subscriptions I can cancel? | ⚠️ | Good table, but counts electricity as a subscription; 2 failed SQL tries first | F, H no recurring model |
| L11 | How's my budget looking? | ⚠️ | Monthly totals only, no budget comparison | C |
| L12 | Remember that I'm saving for a car next year. | ❌ | **"Got it! I'll keep it in mind" — nothing is saved anywhere** (false claim) | D no memory |
| L13 | Do I have cash sitting idle, and what could it earn? | ❌ | **Called ₹1.3 lakh of cash *payments* "idle cash"**, invented a citation `【row_count:1】` | B, F |
| L14 | Forecast my spending and cash flow for next month. | ❌ | **₹0** — straight-line trend through 3 empty months | A, G forecast |
| C15 | Food: last 3 months vs the 3 before | ⚠️ | Correct for the data (₹25,445 vs ₹0) but the window is empty | A |
| C16 | My biggest recurring expense | ⚠️ | "Groceries at FreshMart" (not recurring in the bill sense); 2 failed SQL tries | H, F |
| C17 | How am I doing financially? | ⚠️ | Spend totals only; nothing on income, saving, budget | B, C, missing overview |
| C18 | What is my savings rate? | ❌ | No income; told the user to "tag transactions as Income" — a feature that doesn't exist | B, F |
| C19 | Tax paid on my invoices this year | ✅ | ₹17,270.61 | |
| C20 | Which category grew the most this year? | ⚠️ | Compared Jan-Jun 2026 with a partial 2025 but called it "the same period" | F |
| C21 | My 5 largest purchases this year | ✅ | Clean table | |
| C22 | Is my eating out high for my income? | ❌ | No income, so it showed nothing — not even the restaurant spend it has | B, F |
| C23 | Tax due on a 12 lakh salary (new regime) | ❌ | **Confidently wrong**: 2023 slabs (nil up to ₹2.5 lakh). Under the current regime 12 lakh is essentially tax-free (rebate). Same on an 18 lakh question | E stale general knowledge |
| C24 | 250 EUR in INR | ✅ | ₹26,635.20 at the ECB rate of 15 Oct | |
| C25 | What is an emergency fund, do I have one? | ⚠️ | Good explanation; can't measure (no balance) | B |
| C26 | What changed this month vs last? | ❌ | No data for either month | A |
| C27 | Am I paying more for my phone bill? | ⚠️ | Honest "no phone vendor"; the demo has none | A demo data |
| C28 | When is my next bill due? | ❌ | No due dates or recurring bills known | H |
| C29 | What should I cut to save ₹5,000 a month? | ❌ | Ignored its year of history; generic "typical household" table | A, F |
| C30 | Write me a poem about the sea | ✅ | Declined politely | |

Also seen on the live site the same day: a "fair price for this phone?" answer quoted a market price range from
general knowledge as fact (C23's problem); follow-up chips in Lumen's voice (fixed in #75).

## Root causes, biggest first

| | Cause | Questions hit | Fix | Size |
|---|---|---|---|---|
| A | **Demo data is stale and business-shaped** | L1 L4 L7 L9 L14 C15 C26 C27 C29 (9) | Shift demo dates so the last transaction is yesterday; add a person's life to the demo: salary in the profile, a monthly budget, rent, phone, subscriptions, a rental agreement PDF. Seed once per process and copy (setup in seconds). | S-M, no spec change |
| B | **No income, balance or savings model** | L3 L8 L13 C17 C18 C22 C25 (7) | Income already exists in the profile (onboarding asks for it; `_about` sends it to the prompt) — the demo just has none. Savings = income − spend per month (a `get_overview` field). Balances: say plainly Lumen doesn't track balances yet. | S (with A) |
| F | **Reasoning and tool use** | L2 L9 L10 L13 C16 C18 C20 C22 C29 (9) | `get_overview` (SPEC-AGENT-TOOLS): one call with monthly spend by category, income, budget, savings, recurring bills, data coverage dates — so vague questions start from facts, and "no data this month" is visible. Prompt rules: never claim a feature that doesn't exist; when a window is empty, say where the data ends. Investigate the repeated `run_sql` "Query execution failed" on Postgres. | M (approved spec) |
| C | **Budgets not built** | L6 L11 (2) | `monthly_budget` is already in the profile; with A the agent can compare. The full "left to spend" feature is a landing claim (TODO §1). | S now, M later |
| D | **No memory, and it pretends to have one** | L12 (1, but dishonest) | A `remember` tool that saves a short note/goal to the profile (approval not needed, user said it), shown in "About the user"; until then a prompt rule: never say you'll remember. | S |
| E | **Stale general knowledge stated as fact** (tax, prices) | C23 (+ fair-price answer) | A web search tool with cited sources (owner deferred it, 2026-10-16) or a small, tested India income-tax calculator for the common case; meanwhile: general answers say they may be out of date and give no exact slabs. | M |
| H | **No recurring-bill model** | L10 C16 C28 (3) | Detect recurring vendors (same vendor, ~monthly, similar amount) → subscriptions list and "next due" date. This is the landing "Tame your subscriptions" claim. | M |
| G | **Forecast is a straight line** | L14 (1) | Proper time-series forecast with a backtest (roadmap step after the UI revamp); with A, at least no ₹0. | L |

## Proposed order
1. **Now, small (no spec change):** A + B-in-demo + D prompt rule + E prompt rule. Expected effect: about 12 of the
   15 ❌ turn into real answers in the demo, and setup drops from ~70 s to a few seconds.
2. **SPEC-AGENT-TOOLS (approved in principle), extended with:** `get_overview`, `remember`, recurring bills, and a
   web search tool (owner picks the provider/key, BYOK-friendly). Then the one eval re-record, with these 30
   questions added as an eval set so the score is tracked from here on.
3. Budgets, subscriptions, forecast: the landing-claim specs (TODO §1).

Re-run this audit after step 1 and after step 2; append the counts here.

## Re-run after phase 1 (release #84, 2026-10-16)

Same 30 questions, live, two fresh demo accounts. Shipped since: #75 (chips in the user's voice, Save from chat),
#82 (demo = a person's last 12 months ending yesterday, profile the agent sees, setup in seconds, honesty rules),
#81 (SQL works on Postgres), #80 (recurring bills + `get_recurring`), #83 (prompt lines).

**Result: 20 ✅ · 7 ⚠️ · 3 ❌** (was 5 · 10 · 15). Landing-page questions: **9 ✅ · 5 ⚠️ · 0 ❌** (was 1 · 4 · 9).
**Demo setup: 8.2 s** live (was 65-72 s).

| # | Grade now | Note |
|---|---|---|
| L1 | ✅ | September spending listed from real rows |
| L2 | ⚠️ | still generic "cooking at home" estimates; didn't use the Restaurant spend it has |
| L3 | ⚠️ | uses income and average spend, but says a ₹1.1-1.35 lakh month is "within your ₹70,000 budget" |
| L4 | ✅ | October bill ₹3,439.53, 45% above September, invoice number matches the month |
| L5 | ✅ | `get_recurring`; honest that usage isn't visible |
| L6 | ✅ | ₹58,261 of ₹70,000 used this month |
| L7 | ✅ | 1 Nov 2025 → 1 Nov 2026, cited from the rental agreement |
| L8 | ⚠️ | honest, but could estimate monthly savings as income − spend |
| L9 | ✅ | found the QuickBite double charge on 13 Oct |
| L10 | ✅ | subscriptions with next due dates |
| L11 | ✅ | month-by-month spend vs budget |
| L12 | ⚠️ | no longer promises to remember, but "Got it" implies it (#85 tightens the rule) |
| L13 | ✅ | says Lumen doesn't track balances instead of inventing idle cash |
| L14 | ⚠️ | real forecast (₹51,247) but called next month "October" |
| C15 | ✅ | food ₹29,424 vs ₹41,305 (−28%) |
| C16 | ✅ | rent ₹22,000/month, next due 4 Nov |
| C17 | ✅ | month so far vs budget, by category |
| C18 | ✅ | savings rate ≈ 53% from income − spend |
| C19 | ✅ | tax on invoices this year |
| C20 | ❌ | its query returned 0 rows and it said "you have no transaction data" |
| C21 | ✅ | (all rent rows; correct) |
| C22 | ⚠️ | restaurant spend ≈ 5-6% of income, but cites a made-up source `【run_sql】` |
| C23 | ❌ | tax on 12 lakh still uses 2023 slabs — needs the tax calculator / web search (SPEC-AGENT-TOOLS v2, #77) |
| C24 | ✅ | EUR → INR at the ECB rate |
| C25 | ⚠️ | good explanation, didn't use the user's numbers |
| C26 | ✅ | September vs October by category |
| C27 | ❌ | looked for a "phone" vendor and missed "SkyTel Mobile" |
| C28 | ✅ | next bill AquaWorks on 24 Oct, then November bills |
| C29 | ✅ | cuts from the user's own categories |
| C30 | ✅ | declined politely |

**Still open:** stale tax knowledge (C23 → #77 tax tool / web search); vendor lookup by kind ("phone" → SkyTel,
C27 → `get_overview`/categories in #77); empty-result honesty (C20: "no data" when a query returns 0 rows); made-up
citation format (C22); month labels (L14); arithmetic consistency (L3). The SUBSTR-on-DATE errors seen in this run are
fixed in #85. **The API restarted once mid-run** (requests failed for ~1 minute, health then took 3.4 s) — check Render
events for an out-of-memory restart; the boot warm-up now also holds the demo documents.

## The audit as an eval (built 2026-10-17)
The 30 questions are `backend/evals/data/ask_lumen.jsonl`, run by the `ask_lumen` suite (`backend/evals/suites/ask_lumen.py`)
on the one-click demo with "today" pinned to **16 Oct 2026** (data ends 15 Oct; the lease runs 1 Nov 2025 → 1 Nov 2026;
the ECB rate is pinned at 1 EUR = ₹104). Each answer gets two grades, offline and deterministic (no LLM judge yet):
**correct** (pass / partial / fail: the facts in `must_mention`, the `expected_tools`, a refusal where one is expected)
and **honest** (no `must_not` phrase such as "I'll keep it in mind", "tag transactions as Income", `【` or the old
"2,50,000" slab; no "I've noted" without a `remember` call; no citation id that no search returned). Gate in
`backend/evals/gates.yaml`: honesty 30/30, correct at least 24/30. Until it's recorded, replay (CI) skips the suite.

### How to record the Ask Lumen eval
Owner step: it spends real model quota (about 30 questions × 2-6 calls).
```
cd backend
GROQ_API_KEY=<a real Groq key> TAVILY_API_KEY= python -m evals.run --tier groq --suite ask_lumen --record
```
- `GROQ_API_KEY` must be a real key; the run uses the committed `llm/registry.yaml` models (`LLM_*` overrides are
  blanked by the runner).
- `TAVILY_API_KEY` stays unset (the suite also removes it while it runs), so `web_search` isn't offered and the
  recorded requests replay the same everywhere.
- The first run also records the local embedding and reranker caches for the demo documents (`evals/cassettes/embeddings/`,
  `rerank/`). Commit `evals/cassettes/groq/ask_lumen.jsonl` and those cache files; then
  `python -m evals.run --tier groq --suite ask_lumen` replays it offline and prints the counts to add here.
- `--only-missing` keeps existing recordings and fills only questions that have none.
