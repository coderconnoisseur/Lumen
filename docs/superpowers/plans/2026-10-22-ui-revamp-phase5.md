# UI revamp Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Home v2 and the Spending, Bills & subscriptions, Budget and Receipts & statements pages to the approved mockups, on one shared page skeleton, with the cheap backend each page needs.

**Architecture:** A small set of shared page pieces (`components/page/*`, `lib/chart.ts`) is built first and used by every page so they can't drift. Each sub-phase (5a–5e) is one stacked PR into `refactor`. Pages keep fetching through `lib/api/client.ts`; new backend routes are FastAPI routers in `backend/api/` like `budget.py`.

**Tech Stack:** Next.js (app router), Tailwind v4 + shadcn tokens (Sky theme), motion, Playwright e2e; FastAPI + SQLAlchemy (Flask-SQLAlchemy models), pytest.

**Spec:** `docs/superpowers/specs/2026-10-22-ui-revamp-phase5-design.md` (mockups in `docs/superpowers/specs/2026-10-22-phase5/`), parent `docs/superpowers/specs/2026-10-20-ui-revamp-design.md`.

## Global Constraints

- Labels: `.label-ui` (Funnel Sans, sentence case). No all-caps mono, no shadcn default blue `Button` on these pages, no dark dialog in the app.
- Nothing the data can't back is shown: deferred elements are hidden, never faked (spec §2, §6).
- A control whose label is an action does that action; it never sends its text to the chat.
- Zero layout shift: every range/filter/month change, hover-edit and dialog keeps its box; each gets a bounding-box test.
- Pages work at 375px wide with no sideways scroll; leave `md:pr-12` room for the floating account menu in header rows.
- Inside `.bui` (Ask) use bui tokens (`bg-hover`, `bg-surface`, `border-line`, `text-ink-2`), never shadcn `accent`.
- Git: branch names without "claude", no attribution lines in commits or PRs; PRs into `refactor` on coderconnoisseur/Lumen.
- Backend test env: `OPENROUTER_API_KEY=test-key SECRET_KEY=test-secret-key-for-ci-only SUPABASE_URL=https://example.supabase.co python -m pytest -q` from `backend/`.
- Frontend lint/build env: `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-dummy NEXT_PUBLIC_BACKEND_URL=http://127.0.0.1:9`.

## Review Focus

1. **Empty account** (no transactions, no budget, no bills): every Home card shows its empty state at its loading height; no NaN, "₹0 of ₹0", or a chart line at zero. Pinned by Task 3 and Task 6 empty-state tests.
2. **Phone width (375px)**: chart ticks never overlap (the reported "01 OC09 OCT"), calendar cells keep amounts readable, header actions wrap under the title without covering the account menu. Pinned by Task 2 (`pickTicks`) and Task 3 / Task 1 bounding-box tests.
3. **Forecast missing or outside the month** (backend forecasts from the last transaction date): no "heading for" text and no dotted line. Pinned in Task 3.
4. **Ask prefill** (`/ask?draft=`) must never send by itself, also after a reload or when Ask is already mounted. Pinned in Task 5.
5. **Ask busy state**: Keep/Delete in the thread rail are disabled while an answer is in flight; deleting the open thread mid-answer must not orphan the answer. Pinned in Task 8.

---

## Phase 5a — shared skeleton, Home v2, dialogs, Ask/§12 fixes (detailed)

Branch: `ui-revamp/phase5-pages` (contains the spec commit; stacked on `ui-revamp/polish`).

### Task 1: Page header, page card, quiet buttons

**Files:**
- Create: `frontend/src/components/page/page-header.tsx`, `frontend/src/components/page/page-card.tsx`
- Modify: `frontend/src/components/ui/button.tsx` (variants), `frontend/src/app/(app)/home/_components/card.tsx` (delete; callers import `PageCard`), all Home cards that import `HomeCard`, `frontend/src/app/(app)/home/homeContent.tsx`
- Test: `frontend/e2e/home.spec.ts`

**Interfaces:**
- Produces: `PageHeader({ title: ReactNode; brief?: ReactNode; actions?: ReactNode; children?: ReactNode })` — renders `<h1 class="text-[26px] font-medium tracking-tight">`, actions right-aligned in the same row with `md:pr-12`, brief below in `font-serif text-[19px] text-ink-2`-equivalent (`text-foreground/80`), `children` = a control row under the brief.
- Produces: `PageCard({ title: ReactNode; href?: string; action?: ReactNode; extra?: ReactNode; loading?: boolean; skeletonHeight: number; className?; "data-testid"?; children })` — same contract as today's `HomeCard` (skeleton at final height, `minHeight` after), restyled: `rounded-2xl border border-border/70 bg-card px-5 py-[18px] shadow-[0_1px_2px_rgba(28,28,26,.04),0_4px_16px_-8px_rgba(28,28,26,.08)]`; title row = `.label-ui` title, `›` after it when `href`, `extra` (legend, pill) then `action` at the right.
- Produces: `Button` variants `quiet` (`border border-border bg-card/70 text-foreground/80 hover:bg-card hover:text-foreground backdrop-blur`) and `ink` (`bg-foreground text-background hover:bg-foreground/90`); size `pill-icon` (`size-[34px] rounded-full`).

- [ ] **Step 1: Write the failing test** `home header keeps clear of the account menu` in `e2e/home.spec.ts`: at 1440×900 and 1024×800, `signIn`, goto `/home`; the bounding box of `getByRole("button", { name: "Account menu" })` does not intersect the boxes of `getByRole("button", { name: /upload/i })` and `getByRole("button", { name: "Export" })`; `getByRole("heading", { level: 1 })` has `font-size` `26px`.
- [ ] **Step 2: Run** `npx playwright test e2e/home.spec.ts -g "account menu"` — Expected: FAIL (font-size 24px / names differ).
- [ ] **Step 3: Implement** `PageHeader`, `PageCard`, the button variants; switch Home's greeting row to `PageHeader` (title = greeting, brief = `<Brief>`), replace every `HomeCard` import with `PageCard` and delete `card.tsx`.
- [ ] **Step 4: Run** the new test and the whole `e2e/home.spec.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: shared page header and card for the Phase 5 pages`.

### Task 2: Chart helpers

**Files:**
- Create: `frontend/src/lib/chart.ts`
- Test: `frontend/e2e/home-math.spec.ts` (pure-function tests live here)

**Interfaces:**
- Produces: `smoothPath(points: [number, number][]): string` — SVG path through every point; monotone cubic (Fritsch–Carlson) so a running total never dips or overshoots between points; 0 points → `""`, 1 point → `"M x y"`.
- Produces: `pickTicks(candidates: { i: number; x: number; label: string; keep?: boolean }[], minGap: number): typeof candidates` — keeps `keep` ticks (today, first, last) and drops any other tick closer than `minGap` px to a kept one, left to right.

- [ ] **Step 1: Write failing tests** in `e2e/home-math.spec.ts`:
  - `smoothPath([[0,10],[10,20],[20,20],[30,40]])` starts with `"M0 10"`, contains `"20 20"` and ends with `"30 40"`.
  - Sampling the cubic segments of `smoothPath([[0,0],[10,100],[20,100],[30,101]])` at t=0.25/0.5/0.75 never gives y > 101 or a y lower than the previous sample (monotone, no overshoot). Parse the `C` commands to compute the samples in the test.
  - `pickTicks` with x = 0, 20, 40, 300, 310 (`keep` on 0, 300, 310) and `minGap: 48` returns labels for 0, 300, 310 only.
- [ ] **Step 2: Run** `npx playwright test e2e/home-math.spec.ts` — Expected: FAIL (module not found).
- [ ] **Step 3: Implement** both in `lib/chart.ts`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: smooth monotone chart path and tick picking`.

### Task 3: Hero spend card v2

**Files:**
- Modify: `frontend/src/app/(app)/home/_components/spend-card.tsx`
- Test: `frontend/e2e/home.spec.ts`

**Interfaces:**
- Consumes: `PageCard`, `smoothPath`, `pickTicks`; existing props of `SpendCard` plus `onUpload: () => void`.
- Title (`TITLE` map): `"Spent in <Month>"` for 1M (month from `period.start`), `"Spent this week"`, `"Spent this quarter"`, `"Spent in <Year>"`; `href="/spending"`.

- [ ] **Step 1: Write failing tests** in `e2e/home.spec.ts` (use the existing home fixture with transactions and forecast):
  - `hero shows delta, percent and the forecast total`: text matches `/\+₹[\d,]+ \(\d+%\) vs \w+ by the \d+(st|nd|rd|th)/` and `/heading for ₹[\d,]+/`.
  - `no forecast, no heading-for`: fixture forecast dates all in an earlier month → no `heading for` text and no `[data-series="forecast"]`.
  - `ticks never overlap at phone width`: viewport 375×812; the bounding boxes of all `[data-testid="tick"]` are pairwise non-overlapping.
  - `the + button opens upload`: click `getByRole("button", { name: "Upload a receipt" })` inside `[data-testid="spend-card"]` → a dialog is visible.
  - keep the existing range-change bounding-box test green.
- [ ] **Step 2: Run** `npx playwright test e2e/home.spec.ts -g "hero|ticks|\\+ button"` — Expected: FAIL.
- [ ] **Step 3: Implement**: number 36px medium; delta line `+₹X (Y%) vs <Prev month> by the <ordinal day>` (bad colour when up, good when down; for 3M/YTD "vs last period"/"vs <year>"); `· heading for <money(last forecast point)>` only when the forecast is drawn; legend (Month / Previous / Forecast) in `extra`; `+` icon button (`aria-label="Upload a receipt"`) in `action`; paths via `smoothPath`; chart height 200px; bill pins become 22px round markers on the x-axis with the vendor's first letter and `title={vendor}`; ticks via `pickTicks` with `data-testid="tick"`, `minGap` 48; range chips centred below.
- [ ] **Step 4: Run** `e2e/home.spec.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: Home hero card in the Origin style`.

### Task 4: "Month, day by day" calendar + recent transactions

**Files:**
- Modify: `frontend/src/app/(app)/home/_components/calendar-card.tsx`, `frontend/src/lib/home-math.ts` (export `ordinal(n)` if Task 3 didn't)
- Test: `frontend/e2e/home.spec.ts`

**Interfaces:**
- Consumes: `PageCard`; new prop `reminders: Reminder[]`, `today: Date`.
- Produces: `vendorChip(name: string): { initials: string; hue: number }` in `lib/home-math.ts` (2 initials, stable hue from the name) — reused by Spending/Bills.

- [ ] **Step 1: Write failing tests**: `calendar marks today and names future bills` — the cell for today's date has `data-today="true"`; a fixture reminder dated after today puts its vendor text in that day's cell; future cells have `data-future="true"`; the card title links to `/spending`; `See all` in Recent transactions links to `/spending`. `vendorChip("Swiggy Instamart")` → `initials: "SI"` and the same hue on two calls (home-math.spec).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** per `home.html`: title `"<Month>, day by day"`, month total + "across N days" (days with spend), 50px cells with day number top and short amount bottom, heat shade as today, today outlined in primary, future cells dashed with up to one bill name; recent rows with a 28px initials chip from `vendorChip`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: day-by-day calendar with amounts and bill names`.

### Task 5: Lumen found as a list, Ask prefill

**Files:**
- Modify: `frontend/src/app/(app)/home/_components/lumen-found.tsx`, `frontend/src/app/(app)/ask/chatbotContent.tsx`, `frontend/src/components/ask/prompt-bar.tsx` (accept an initial value if it doesn't)
- Test: `frontend/e2e/home.spec.ts`, `frontend/e2e/ask.spec.ts`

**Interfaces:**
- Produces: `/ask?draft=<text>` — opens a fresh chat with the composer filled with `<text>`, focused, **not sent**; the URL is cleaned (`router.replace("/ask")`) so a reload doesn't refill. Used by Lumen found "Ask why", Spending, and Bills "How to cancel".
- Produces: `askWhy(item: FoundItem, money): string` in `lumen-found.tsx` — `"Why " + headline (filled, lower-cased first letter, no trailing period) + "?"`.

- [ ] **Step 1: Write failing tests**:
  - home: `Lumen found is a list with doing links` — each item is a row with an icon, headline, detail, a primary link to `item.href` and an "Ask why" link whose href starts with `/ask?draft=`.
  - ask: `draft prefills without sending` — goto `/ask?draft=Why%20is%20Food%20up%3F`; composer value is `Why is Food up?`; no `/chat` POST happened (count requests in the fixture route); URL becomes `/ask`; reload → composer empty.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** list layout per `home.html` (32px tinted icon by `kind`: duplicate=bad, spike=warn, price_rise/review=primary; title row pill "N to look at"); `?draft=` handling next to the existing `?q=` effect, guarded by the same `lastQ`-style ref.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: Lumen found list with real actions; /ask?draft= prefills`.

### Task 6: Budget card v2, Coming up, Home layout

**Files:**
- Modify: `frontend/src/app/(app)/home/_components/budget-card.tsx`, `bills-card.tsx`, `homeContent.tsx`
- Test: `frontend/e2e/home.spec.ts`

**Interfaces:**
- Consumes: `BudgetState` from `lib/api/client.ts` (unchanged), `PageCard`, `vendorChip`.

- [ ] **Step 1: Write failing tests**:
  - `budget card shows spent of total, percent and top categories`: with a fixture budget of 4+ categories → text `/₹[\d,]+ of ₹[\d,]+/`, a `%` label, exactly 4 `[data-testid="budget-cat"]` rows ordered by spent desc; an over-budget category row has `data-over="true"`.
  - `empty account Home`: fixture with no transactions/budget/reminders → no text matching `/NaN|of ₹0\b/`; every card's box height equals its loading skeleton height ±1px (record during loading via a delayed route, compare after).
  - `coming up lists the next four bills`: 6 upcoming reminders → 4 rows with date chips (weekday + day).
  - existing draft-budget tests stay green (promo still opens the draft dialog in 5a; 5d moves it).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** per `home.html`: layout = hero full width, then `grid lg:grid-cols-[minmax(0,1fr)_380px]`: left = calendar card, Lumen found; right = Budget in <Month>, Coming up, Activity (kept at the bottom for now). Budget: big spent of total, green bar + %, then top 4 category bars (green / amber ≥90% / red over).
- [ ] **Step 4: Run** full `e2e/home.spec.ts` — Expected: PASS.
- [ ] **Step 5: Commit** `feat: Home v2 layout, budget and coming-up cards`.

### Task 7: Upload and Export restyle, light upload dialog

**Files:**
- Modify: `frontend/src/components/uploadDialog.tsx`, `frontend/src/components/exportDialog.tsx`, `homeContent.tsx`
- Test: `frontend/e2e/home.spec.ts`

**Interfaces:**
- Produces: `DialogDemo` gains `trigger?: ReactNode` (default: `<Button variant="quiet"><Upload/>Upload</Button>`) and `open`/`onOpenChange` passthrough so the hero `+` (Task 3) and `?upload=1` open the same dialog. `ExportDialog` default trigger = `Button variant="quiet" size="pill-icon" aria-label="Export"` with a download icon.

- [ ] **Step 1: Write failing tests**: `upload dialog is light` — open it; computed `background-color` of `[role="dialog"]` has luminance > 0.9 (parse rgb); no element inside has class matching `neutral-9|#0b0612`. `Home buttons are quiet` — the Upload button's computed background is not `rgb(37, 99, 235)` (blue-600).
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**: dialog on Sky tokens (`bg-card`, `border-border`, `text-foreground/muted-foreground`), drop zone `border-dashed border-border bg-muted/40`, file rows `bg-muted/50`; keep all upload logic untouched.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat: quiet Upload/Export and a light upload dialog`.

### Task 8: Ask and chat §12 fixes

**Files:**
- Modify: `frontend/src/app/(app)/ask/thread-rail.tsx`, `frontend/src/components/app-sidebar.tsx` (render `AskPalette` outside `<Sidebar>`; lift `paletteOpen` into `app-shell.tsx` or a tiny context), `backend/routes/chat.py` (`_thread_for` + `_save_exchange` in one commit), `backend/api/agent.py` (409 text)
- Test: `frontend/e2e/ask.spec.ts`, `frontend/e2e/shell.spec.ts`, `backend/tests/test_chat_threads.py` (or the existing chat test module), `backend/tests/test_agent_api.py` (existing proposals tests)

**Interfaces:**
- Backend: `_thread_for(user_id, thread_id, question)` no longer commits; the `/chat` handler commits once after `_save_exchange`. On a lost claim, both 409s say `"This proposal was already decided."`.

- [ ] **Step 1: Write failing tests**:
  - e2e ask: `rail actions wait for the answer` — with a delayed `/chat` route, while pending the thread's Delete button is disabled; opening the delete confirm moves focus to "Keep"; at 375px with the history sheet open the trash button is visible without hover.
  - e2e shell: `ctrl+k works on a tablet with the sheet closed` — viewport 768×1024 (below the md sheet breakpoint if 768 is still sheet; else 767), press Control+k → palette dialog visible.
  - backend: `test_chat_save_failure_leaves_no_empty_thread` — monkeypatch the message save to raise; after the failed POST, the user has 0 threads.
  - backend: `test_lost_claim_says_already_decided` — approve twice concurrently (or claim then approve) → 409 with detail `"This proposal was already decided."`.
- [ ] **Step 2: Run** them — Expected: FAIL.
- [ ] **Step 3: Implement** the four fixes.
- [ ] **Step 4: Run** `e2e/ask.spec.ts e2e/shell.spec.ts` and backend `pytest -q` — Expected: PASS.
- [ ] **Step 5: Commit** `fix: Ask rail busy/focus/touch, palette outside the sheet, one-commit chat save, clear 409`.

### Task 9: 5a docs, full checks, PR

- [ ] **Step 1:** STORY.md entry `## 32.` (owner review round + Home v2: what was flagged, what changed, test counts), CODEBASE-GUIDE: `components/page/*`, `lib/chart.ts`, `/ask?draft=`; spec §12: tick the Phase 5 items done in 5a.
- [ ] **Step 2:** Run backend `pytest -q`, `pytest -q -m eval`; frontend `npm run lint`, `npm run build` (dummy env), `npm run test:e2e`. Expected: all green.
- [ ] **Step 3:** Screenshot `/home` at 1440 and 375 with seeded fixture data (throwaway `e2e/tmp/shot.spec.ts`) and compare with `home.html` side by side; fix visible drift.
- [ ] **Step 4:** Push `ui-revamp/phase5-pages`, open PR into `refactor` (or stacked on `ui-revamp/polish` until #96 merges) with manual checks: Home matches the mockup on your seeded account; hero `+` and Upload open the same light dialog; "Ask why" fills Ask without sending; phone width has no overlapping ticks.

---

## Phase 5b — Spending (detailed)

Branch: `ui-revamp/phase5b-spending`, stacked on `ui-revamp/phase5-pages` (#97). Mockup: `docs/superpowers/specs/2026-10-22-phase5/spending.html`; spec §4.2.

**Decided here:** everything is computed client-side from `GET /transactions` (date-filtered, paged like Home's `fetchTxns`) plus `GET /api/home/summary` findings. The only backend change is `source` in the transactions list. The "first time at a merchant" card is dropped (spec §4.2). "Always file X here" is omitted (no rule store). The old `/analytics` and `/ai-analytics` pages and their components go once nothing imports them (both URLs already redirect to `/spending`).

### Task B1: transactions list says where each row came from
- Modify `backend/routes/database_query.py` (list response adds `'source': txn.source`); test in the existing transactions route tests (`grep -l "/transactions" backend/tests`): a statement-imported row lists `source == "statement"`, a receipt row `None`.
- Commit `feat: transactions list includes source`.

### Task B2: spending maths (pure)
- Create `frontend/src/lib/spending-math.ts`, tests `frontend/e2e/spending-math.spec.ts`.
- Produces:
  - `type Choice = "this-month" | "last-month" | "3M" | "YTD" | { from: Date; to: Date }`
  - `spendPeriods(choice: Choice, today: Date): { current: Period; previous: Period; label: string; prevLabel: string }`: previous is the same length immediately before; last-month = the whole previous calendar month vs the one before; custom = inclusive dates.
  - `byCategory(cur: Txn[], prev: Txn[]): { category: string; amount: number; share: number; change: number }[]`: sorted by amount desc; null/"" → "Uncategorised"; share of the period total; change = amount − prev amount.
  - `topMerchants(txns: Txn[], n: number): { vendor: string; amount: number; count: number; category: string | null }[]`
  - `monthlyTotals(txns: Txn[], today: Date, months: number): { month: Date; total: number }[]`: oldest first, includes the current month.
  - `needsCategory(txns: Txn[]): number`: category null, "", "Other" or "Uncategorised".
- Tests: one per function with exact numbers (e.g. 3 categories incl. a null one → shares summing to 1, change vs prev; last-month in January → December vs November; YTD previous = same span last year).

### Task B3: Spending page shell, data and period control
- Replace `frontend/src/app/(app)/spending/page.tsx` (single `<h1>` via `PageHeader`); create `spending/spending-content.tsx`, `spending/use-spending-data.ts` (period + previous txns, last 6 months for the bars, summary findings; skeletons only on first load, like Home).
- Period control: segmented This month / Last month / 3M / YTD / Custom (Custom shows two native `<input type="date">`), a "Compare with <prev>" switch (hides the previous line and change columns when off), and the date range text.
- Brief: "<Top category> is most of the change, and <largest single txn vendor> is <money> of it." only when the change is up and the top category explains > 40% of it; otherwise "You've spent <total> so far in <period>." Real numbers only.
- Tests (`frontend/e2e/spending.spec.ts`, fixture `home.txns`): one `<h1>` "Spending"; switching period chips keeps the hero card's box (bounding-box test); Custom shows two date inputs; old content gone ("Spending Analytics", "AI Insights" not present).

### Task B4: hero card
- Extract Home's chart body into `frontend/src/components/page/cumulative-chart.tsx` (`CumulativeChart({ period, previous, cur, prev, forecast?, pins?, today, showPrevious })`), used by both `SpendCard` and the Spending hero, so Home's tests stay green unchanged.
- Spending hero: "Spent in <label>", total, change vs previous (same format as Home), cumulative chart; right inset "Month by month" bars for the last 6 months with the average; for 3M/YTD the bars replace the line as the main chart.
- Tests: total and delta text; 6 bars with the current month highlighted; 3M shows bars as the main chart.

### Task B5: By category + Lumen noticed
- By category card: horizontal bars (amount, share, change vs previous when comparing); clicking a row sets `?category=` and the filter pill "Filtering transactions: X" with Clear; footer "N transactions still need a category → Sort them now" (scrolls to the table filtered to Uncategorised) only when N > 0.
- Lumen noticed: `LumenFound` with a `title` prop ("Lumen noticed"), same rows and actions.
- Tests: clicking Shopping filters the table to Shopping rows and the URL has `category=Shopping`; Clear restores; footer count matches uncategorised rows.

### Task B6: Transactions table, Top merchants, Export
- Table: search box (vendor substring, client-side), category pill filter, source filter (All / Statement / Receipt), columns date, merchant (`VendorChip`), category pill, source, amount; 25 rows then "Show more". Hover/focus shows a pencil; the menu lists known categories and saves via `transactionApi.updateTransaction(id, { category })`, updating the row in place (no row height change).
- Top merchants: top 7 with count and category.
- Export: the quiet icon button downloads a CSV of the current filtered rows (client-side `Blob`), filename `lumen-spending-<from>-<to>.csv`.
- Tests: search narrows rows; editing a category sends the PUT and the pill changes without the row's box changing; CSV download has a header row and the filtered rows.

### Task B7: remove the old pages, docs, checks, PR
- Delete `app/(app)/analytics`, `app/(app)/ai-analytics`, and `components/analytics/*`, `components/ai-analytics/*` that nothing else imports (grep first).
- STORY 34, codebase guide (Spending section), spec §12 tick (two `<h1>`s).
- Full checks (backend, eval, lint, build into `.next-build`, e2e) green, screenshot vs `spending.html` at 1440 and 375, then PR into `ui-revamp/phase5-pages` (retarget to `refactor` as the stack lands).

## Phase 5c — Bills & subscriptions (detailed)

Branch: `ui-revamp/phase5c-bills`, stacked on `ui-revamp/phase5b-spending` (#98). Mockup `bills.html`; spec §4.3 and the builder-check decision on saved states.

### Task C1: recurring API with saved states (backend, TDD)
- Model `RecurringState` (`recurring_states`: id, user_id, vendor_key = `ai.recurring._norm(vendor)`, state `cancelled|not_a_bill`, changed_at; unique (user_id, vendor_key)); created by `create_all` like `budgets`.
- `api/bills.py`, router `/api/bills`, registered in `asgi.py`:
  - `GET /recurring` → `{success, items: [...find_recurring fields + "state": "active"|"cancelled"|"charged_again"], hidden: [{vendor, vendor_key}]}`. `not_a_bill` vendors leave `items` and go to `hidden`; `cancelled` shows `state: "cancelled"` unless `last_charge_date` is after `changed_at`'s date, then `"charged_again"`.
  - `POST /recurring/state {vendor, state: "cancelled"|"not_a_bill"|"active"}` → upsert (active deletes the row); returns the new GET payload.
- Tests (`tests/test_api_bills.py`, setup like `test_api_budget.py`): per-user isolation; three monthly Netflix charges listed active; cancel → cancelled; a charge after cancel → charged_again; not_a_bill → in hidden only; active restores; vendor key ignores case/punctuation ("NETFLIX.com" vs "Netflix com").

### Task C2: Home reads bills from the recurring API
- `billsApi.recurring()` / `billsApi.setState(vendor, state)` in `lib/api/client.ts`; `use-home-data` maps items with `next_due_date` in the next 31 days, not `possibly_stopped`, state active → `Reminder` (`toBills`), replacing `/api/analytics/reminders` (which only had rows after the old analysis ran; spec §12 5c item).
- e2e fixture serves `/api/bills/recurring` built from `home.reminders` (vendor→vendor, date→next_due_date, amount→typical_amount, monthly) and records state POSTs; Home's bill tests stay unchanged in intent.
- Tests: Coming up / bill pins / calendar names come from the recurring route; a cancelled or stopped item is not a bill on Home.

### Task C3: the Bills page
- `app/(app)/bills/` (replaces the interim list): `PageHeader` "Bills & subscriptions" with a ‹ month › switcher; brief ("Rent of ₹X is due <day>. N subscriptions look stopped, about ₹Y a month." from real items only).
- Three tiles: Due in the next 30 days (sum + count), Recurring every month (monthly equivalents: weekly×52/12, yearly/12; active items only), Subscriptions that look stopped (`possibly_stopped`, count + ₹/month).
- Month calendar (Monday first) with each item's projected due days in the shown month (monthly: next_due_date's day clamped; weekly: every 7 days from next_due_date; yearly: if the month matches), today outlined, past-due days muted; beside it Upcoming (next 30 days) grouped This week / Next week / Later with group totals.
- Table with tabs Subscriptions / Bills / All (kind subscription vs bill+recurring): VendorChip, cadence, last charged, next, amount; pills: price rise (from → to), looks stopped, charged again after you cancelled. Actions per row: Mark as cancelled, Not a bill, How to cancel (→ `/ask?draft=How do I cancel <vendor>?`). Cancelled rows dimmed in a group at the bottom with Undo; a "Hidden (N)" footer lists not-a-bill vendors with Undo.
- Tests: tiles' numbers; calendar shows a bill on its projected day for this and next month; tabs filter; Mark as cancelled POSTs and moves the row to Cancelled without the table jumping (bounding box of the table's first row); Not a bill hides it and Undo brings it back; How to cancel href; month switching keeps the calendar box; CLS < 0.01 while loading.

### Task C4: clean-up, docs, checks, PR
- Remove the interim `bills/upcoming-bills.tsx` and `aiAnalyticsApi.getReminders` if unused.
- STORY 34, guide (Bills), spec §12 (tick the 5c item).
- Full checks green, screenshot vs `bills.html` at 1440 and 375, PR stacked on #98.

## Phase 5d — Budget page (detailed)

Branch: `ui-revamp/phase5d-budget`, stacked on `ui-revamp/phase5c-bills` (#99). Mockup `budget.html`; spec §4.4 and the builder-check decision "budgets are versioned by month".

### Task D1: budgets per month (backend, TDD)
- `Budget.effective_from` = `"YYYY-MM"` (String(7)); unique (user_id, category, effective_from) as `u_budget_user_category_month`. `models/database.py`: `_migrate_budget_versions(engine)` after `_add_missing_columns` (column in `_ADDED_COLUMNS`): fills NULLs with the row's `updated_at` month, drops the old `u_budget_user_category` (Postgres: `DROP CONSTRAINT IF EXISTS`; SQLite: rebuild the table, since its autoindex can't be dropped), creates the new unique index. Idempotent.
- `api/budget.py`: `limits_in_force(rows, month) -> {key: (category, limit)}` = latest row per case-folded category with `effective_from <= month`; a `monthly_limit <= 0` row is a removal (PUT with `limit: null` writes one for the current month). `upsert_budget(session, user_id, category, limit, month)`.
- `GET /api/budget?month=YYYY-MM` (default current; 422 on a bad month) → the existing shape for that month. `GET /api/budget/history?months=6` (1–12) → `{success, months: [{month, budget, spent}]}` oldest first ending this month; `budget` = `monthly_budget` or the sum of limits in force, `null` for a past month with no limit in force.
- Draft: `payload.month` = current month; approving writes rows effective from `payload.month` (current month if missing/bad). `draft_budget`'s `basis.months` lists only months with spend (§12).
- Tests: `test_api_budget.py` — editing this month leaves last month's limits; history budget/spent per month and `null` before any budget; removal hides the category only from this month on; approve writes `effective_from`; bad month 422; `test_budget.py` — basis months skip an empty month; unique index allows two months; migration on an old-schema SQLite file keeps rows, fills `effective_from`, and allows a second month.

### Task D2: the Budget page (frontend)
- `budgetApi.get(month?)`, `budgetApi.history(months)`; type `BudgetMonth {month, budget: number|null, spent}`. `lib/budget-math.ts`: `pace(total, spent, today, month)` → `{pct, evenPct|null, left, daysLeft, perDay}` (evenPct/perDay only for the current month); `usedTone(spent, limit)` → `"good"|"warn"|"bad"` (warn ≥ 90%).
- `app/(app)/budget/` + sidebar **Plan · Budget** between Track and Records. Header "Budget", ‹ month › switcher (next disabled at the current month), actions on the current month only: "Edit budget" (quiet; edits the overall total in place) and "Let Lumen draft" (dark). Brief from real numbers ("You're on track: ₹X under an even pace." / "₹X over an even pace." / "₹X over budget."). Past months read-only.
- Hero: spent of total, bar with even-pace tick, Left / Days left / Safe per day (= left ÷ days left), pace chart = `CumulativeChart` with the even line passed as the dashed series.
- By category table: Budget / Spent / Left / Used bar (green, amber ≥90%, red over). Clicking the budget amount (current month) swaps it for an input of the same height: Enter saves (`PUT`), Esc cancels. Footer "Categories add up to X · Y of your Z is unassigned" (only with an overall total) + Add category (inline name + amount row).
- Draft panel on the page: shows pending `set_budget` proposals (loaded on open, or filed by "Let Lumen draft"; `?draft=1` drafts on arrival). Each line: category, proposed amount, "was X" / "new", basis sentence, Skip / Approve with aria-labels "Skip <category>" / "Approve <category> at <amount>", decided state in place, "Approve remaining N", 409 → "This draft was replaced. Draft again." No month-bars glyph (basis has no per-month amounts; hidden, not faked).
- Last 6 months: dashed budget outline + actual bar (green under, red over), the current month "so far" with a pale run-rate projection; "N of M months under" over past months that had a budget.
- Home: the promo becomes a link to `/budget?draft=1` (dialog removed); the budget card title links to `/budget`.
- Tests (`budget.spec.ts`, `budget-math.spec.ts`): hero numbers and pace tick; month switch requests `?month=` and hides edit actions; inline edit PUTs and the row's box doesn't change; Esc cancels; draft panel approve/skip names, approve-remaining, 409 message; history bars over/under; CLS < 0.01; phone width no sideways scroll. Home's draft-dialog tests move here.

### Task D3: docs, checks, PR
- STORY 35, guide (Budget), spec §12 ticks (draft accessible names, `basis.months`).
- Full checks green, screenshot vs `budget.html` at 1440 and 375, PR stacked on #99.

## Phase 5e — Receipts & statements (outline)
Backend (TDD): `StatementImport` table + write on import; `GET /api/statements/imports`. Frontend: header actions; Needs-your-review cards from the review queue with highlights from validation flags (replaces the Review tab); library list with filter chips (Statements = import rows) and search; Statement imports card; From your inbox card; Activity moves here from Home if it no longer fits. Old `/documents`, `/import`, `/review` routes redirect into `/receipts`. STORY 36, then the whole-branch review for Phase 5.
