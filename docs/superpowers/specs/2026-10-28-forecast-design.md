# Plan · Forecast: design

Mockup: `docs/superpowers/specs/2026-10-28-forecast/forecast.html` (approved by the owner 2026-10-28, with the shorter
headline). Builds on the UI revamp (spec `2026-10-20-ui-revamp-design.md`, Phase 5 addendum `2026-10-22-ui-revamp-phase5-design.md`):
same page skeleton, Sky tokens, zero layout shift, phone width, PRs into `refactor` (never stacked).

## 1. Why

The app already says "heading for ₹80,697" on Home, but that number comes from `ai/forecasting_agent.py`: daily
exponential smoothing with a fixed ±5% trend nudge. It knows nothing about bills (rent alone is a third of a month),
gives no range, and nobody has measured how right it is. Lumen is the owner's AI-engineering showcase; a forecast that
is explainable line by line and *measured* (backtested, CI-gated, its accuracy shown to the user) is the story.

The page answers: "where will this month land, what about the next three, will I stay in budget, how much will be left,
and what if I change something?"

## 2. Goals, non-goals, anti-goals

**Goals**
- A **Forecast** page under Plan (sidebar Plan · Budget, Forecast), built to the mockup.
- Horizon: **this month + the next 3 months** (owner).
- **Two methods, backtested, keep the better** (owner): "bills + everyday" and a statistical time-series model. **Bills
  are always the detected bills; the two methods compete only on everyday spending** (owner, after the builder check),
  so every breakdown adds up whichever wins. They are scored on the whole-month total (bills + their everyday
  forecast); the page uses the one with the lower backtest error for that user and shows both errors.
- The page answers (owner): will I stay in budget (overall and per category, this month), money left after spending
  (income − forecast, per month), what-ifs, and a "why" line per month.
- **Accuracy measured and shown** (owner): a backtest eval suite gated in CI, and "Last N forecasts were within ±X%" on
  the page.
- **One number everywhere** (owner): Home's "heading for", Budget's "at this pace" bar, Ask Lumen's `forecast` tool and
  the Forecast page all use the same forecast service. The old smoothing code and `/api/analytics/forecast` are retired.

**Non-goals**
- Saved scenarios (owner: what-ifs are try-only, nothing saved).
- Learning income from statements (owner: income comes from the profile only; credits stay skipped on import).
- LLM-written forecasts or "why" text: the "why" line is built from the numbers, so it can't invent a reason.
- Horizons beyond 3 months ahead; seasonality across years (not enough history in most accounts).

**Anti-goals** (failure even if it "works")
- A forecast with no range, or a range that pretends to be certain.
- Two different "this month will land at" numbers anywhere in the app.
- A "why" sentence that isn't true for the numbers shown.
- Showing "money left" when the profile has no income (hide it, offer to add income instead).
- A headline that reads like a paragraph (owner): one short line, number first, verdict in colour.

## 3. The forecast service (backend)

New pure module (e.g. `ai/forecast.py`; no DB, no LLM; transaction dicts in, numbers out) plus a thin route.

### 3.1 Inputs
- The user's transactions (debits; refunds net out as elsewhere), the recurring charges and their saved states
  (`ai/recurring.find_recurring` + `recurring_states`, as `api/bills.py` does), budgets per month (`limits_in_force`,
  `User.monthly_budget`), and `User.monthly_income`.
- "Today" comes from the request (the browser's month and day), as Budget does since the month-skew fix, so the 1st of
  the month in IST isn't read as last month on the UTC server.

### 3.2 Method A: bills + everyday
- **Bills:** active recurring charges of kind `bill` or `subscription` (not cancelled, not looking stopped; the
  catch-all `recurring` kind, e.g. regular visits to one shop, stays in everyday spending; my call) projected onto their due days in each month
  of the horizon with `dueDays`' rules (monthly, weekly, yearly). Late-but-not-stopped bills count as still due this
  month. For the current month, bills already charged this month are not counted again.
- **Everyday spending:** everything that isn't a recurring bill. Its monthly level is learned from the last complete
  months that had spend (up to 6; at least 2, else the method declines), robust to one-offs (median, or a trimmed mean:
  builder's call, decided by the backtest). For the current month: days left × the everyday daily rate.
- **Range:** from how much the everyday level varied month to month (e.g. the 20th–80th percentile of past monthly
  everyday totals, widened for months further ahead). Bills add no width.
- Per category: the same split (bills by their category, everyday by each category's share of the learned level).

### 3.3 Method B: statistical
- Bills exactly as in Method A; the model forecasts **everyday spending only** (owner). A classical time-series model
  over the user's everyday spending (daily or monthly totals) with **no new dependency** (numpy
  and pandas only; `statsmodels` isn't installed). Builder's call which model; Holt's linear trend on monthly totals
  (with a day-of-week shape for the rest of the current month) is the suggested starting point. Its range comes from
  its own residuals. Per-category everyday splits use each category's share, as in A. The page labels it by its real
  name.

### 3.4 Backtest and choice
- For each of the last up to 6 complete months M: forecast M's total using only transactions dated before M (and the
  recurring detection run on that history; a vendor may count as a bill in one test month and not another, which is
  fine: that's what the user would have seen), compare with M's actual total. Error = absolute % error; the method's score
  = median absolute % error over those months. Also record how often the actual fell inside the range.
- The page uses the method with the lower score **for that user**; ties go to bills + everyday (more explainable). With
  fewer than 3 backtestable months: use bills + everyday, and say "too little history to measure accuracy yet" instead
  of the accuracy pill.
- The current month is forecast as a whole-month total (spent so far + the rest), so the backtest also checks a
  mid-month cut: forecasting M from data up to M's 15th must stay within the same gate (this is what Home shows most of
  the month).

### 3.5 "Why" line per month (deterministic templates, first that applies)
1. This month has a single payment bigger than half the month's usual everyday level: "Higher than usual: the ₹X
   <vendor> order on <day>."
2. A yearly or rare bill falls in the month: "Includes the yearly ₹X <vendor> renewal on <day>."
3. A cancelled subscription drops out: "Lower: <vendor> is cancelled."
4. Default: "Your usual month: rent, N bills and everyday spending like <months>."
5. Months 3+ ahead with a wide range may add: "Ranges widen further out."
Every number in the line must match the numbers on the page.

### 3.6 API
- `GET /api/forecast?today=YYYY-MM-DD` (today within ±1 day of the server's date, like Budget's month rule) →
  - `months`: 4 entries (this month first): `{month, forecast, low, high, bills, everyday, budget|null, income|null,
    left|null, why, over_budget: bool|null}`; the first also has `spent_so_far`, `bills_still_due` (count, amount) and
    `everyday_rest`.
  - `daily`: this month's cumulative actual to today and the forecast path to month end (for the hero chart), with
    `low`/`high` at month end.
  - `categories`: this month's per-category `{category, spent, forecast, budget|null}`.
  - `categories` is returned for every month in `months` too (`months[i].categories`), for the Ask tool; the page
    shows this month's.
  - `items`: the recurring charges the what-ifs can toggle (kind `bill` or `subscription`, active)
    `{vendor, monthly_equivalent, kind}`.
  - `accuracy`: `{method: "bills_everyday"|"<model name>", median_error_pct, months_tested, in_range_pct,
    tried: [{method, median_error_pct}]}` or `{months_tested: <3, …}` when there's too little history.
- Per-user, rate limited like the neighbouring routes, tests first. Reading only; no new table.

### 3.7 Retire the old forecast
- `ai/forecasting_agent.py` and `/api/analytics/forecast` go; Home's "heading for", Budget's run-rate projection
  (`runRate` in `lib/budget-math.ts`) and Ask Lumen's `forecast` tool read the new service. The Ask tool returns the
  same months, range and why line, so answers cite the same numbers the page shows. My calls: its `months` argument
  is capped at 4 (this month + 3; it was 1–6), and each month carries its bills, everyday and per-category forecast,
  so "what will my utility bills come to over the next three months?" is answered from the forecast; the routing
  rules in `agent/prompts.py` are updated to match. The agent eval cassettes that
  recorded the old tool output are re-recorded (owner runs `--record` with their key, as before).

## 4. The page (frontend)

`app/(app)/forecast/`, sidebar Plan · Forecast after Budget. Same skeleton as the other Phase 5 pages.

- **Header:** "Forecast", the accuracy pill, and
  **one short headline** (owner): `October lands near ₹82,400 · ₹12,400 over budget` (number bold, verdict in its
  colour; "under budget" in green; no budget → `October lands near ₹82,400`). Nothing else in the headline; next
  months live in their cards.
- **Accuracy pill** (my call, after the builder check: "within ±X%" with a median would be false half the time):
  "Usually off by about X% · last N months", X = the kept method's median absolute % error on the whole-month backtest;
  with fewer than 3 testable months, "Too little history to measure accuracy yet". "How this works" shows the same
  measure for both methods.
- **Hero, "<Month> lands at":** the forecast, "likely ₹low – ₹high · spent ₹X so far", and the split: spent so far /
  bills still due (n) / everyday spending for the days left / forecast. Chart: cumulative actual to today (solid),
  forecast path to month end (dotted), the range as a band at month end, the budget as a dashed line, bill pins on the
  axis (the existing `CumulativeChart` extended, or a sibling).
- **This month and the next three:** four columns: forecast, range, budget, a range bar with the budget tick, money
  left of income (hidden without income; an "Add your income" link to the profile instead), the "why" line.
- **<Month> by category:** spent, forecast, budget, "₹X over" / "₹X left" / "no budget", with a "N will run over" pill.
- **What if** (try-only, client-side): a toggle per recurring subscription/bill (its monthly equivalent off the next
  three months; this month is mostly spent so it isn't changed) and one "Add a monthly cost" amount. Shows each
  month's new money left (or new forecast without income) next to the old one, and a "Make it real" link to Bills
  (cancel) or Budget (set a limit). Nothing is saved.
- **How this works:** the method in plain words and both methods' backtest errors, the kept one marked.
- Zero layout shift (skeletons at final heights), works at 375 px with nothing past the edge, buttons named for screen
  readers, the hand cursor (already global).

## 5. Evaluation

- New offline eval suite `forecast` (no LLM): synthetic users from `evals/generator` (the world already used by other
  suites) plus the demo seed, each with a year of transactions; backtest both methods over each user's last 6 months
  and the mid-month cut. Report median absolute % error per method, in-range rate, and per-user wins.
- **Gates** (in `evals/gates.yaml`, CI fails below them): the chosen method's median error ≤ 10% on the whole-month
  backtest and ≤ 12% at the mid-month cut, in-range rate ≥ 60%. Starting values; adjust once after the first real run
  and record the change in STORY.
- The suite also checks the "why" line's numbers match the month's numbers.
- STORY entry with the before (the old smoothing forecast scored by the same backtest) and after numbers.

## 6. Delivery

Sequential PRs into `refactor` (no stacking; each merged before the next starts):
1. **F1** forecast service (both methods, backtest, choice, why line) + eval suite and gates. Pure, tested.
2. **F2** `GET /api/forecast`; Home, Budget and the Ask tool switched to it; the old forecast retired.
3. **F3** the Forecast page + sidebar; STORY, codebase guide, §12.
Each PR: TDD per task, CLS and phone tests for the page, a manual-check list, then a release when the owner says.

## 7. Left to the builder
The statistical model, the robust-average choice and the range percentiles (decided by the backtest within the gates);
file layout; chart implementation; exact copy of the "why" templates within §3.5's rules; how the eval generator makes
a year of data per synthetic user.
