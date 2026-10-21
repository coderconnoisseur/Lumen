# UI Revamp Phase 2 (Home UI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the generic "Financial Overview" dashboard with the approved Home from the mockup. It uses only data that exists today. Cards that need Phase 3 backend show honest empty states.

**Architecture:**
- **Data.** One client hook `useHomeData()` fetches existing endpoints in parallel: transactions for this period and the previous one, reminders, forecast and the review queue.
- **Logic.** Everything the cards compute lives in pure functions in `lib/home-math.ts`, so it can be unit-tested with Playwright's node runner (no browser) and later replaced by the Phase 3 summary endpoint.
- **Card components** are colocated in `app/(app)/home/_components/`.
- **Chart.** A hand-rolled SVG, as in the mockup. No recharts on Home, which keeps the Home bundle small (spec 11 leaves the chart library to the builder).

**Tech Stack:** Next.js 14, Tailwind v4 Sky tokens (Phase 0), `motion/react`, Playwright (unit tests and e2e with the `signIn` fixture from Phase 1).

**Spec:** `docs/superpowers/specs/2026-10-20-ui-revamp-design.md` §4 (Home), §5 (visual system), §6 (motion, feedback states, zero shift) and §12 backlog items tagged Phase 2. Visual reference: `docs/superpowers/specs/2026-10-20-ui-revamp/home-mockup.html`, Sky variant. Builds on `ui-revamp/phase1-shell` (PR #91).

## Global Constraints

- **Card set and order (spec §4, owner-approved):**
  - **Main column:** Brief → Spent this month → Lumen found → Spending calendar + Recent transactions.
  - **Side column (~330px):** Budget → Upcoming bills → Draft-budget promo → Activity.
  - **Deferred:** the "+" ask-about-this button on cards (owner: "maybe later").
- **Honesty rule (spec anti-goal):** no invented numbers or scores. A card without real data shows an empty state that suggests a next step.
- **Type:**
  - Brief and action headlines use `font-serif` (Newsreader).
  - Card titles, tags and axis ticks use `label-mono`.
  - Numbers use Funnel Sans.
  - `₹` formatting goes through the existing `useMoney()` in `lib/format.ts`.
- **Motion:** 150–250ms with the `@/lib/motion` constants. Numbers count up **once per session** and not on revisits. Nothing animates layout.
- **Zero layout shift (spec 6.2/6.3):** every async card renders a skeleton at its final size. Arriving data must not move anything.
- **Sky band:** `--band` behind the greeting and brief, Home only. Text on the band uses `foreground`, never `muted-foreground` (backlog: about 4.2:1 contrast).
- **No new dependencies.**
- **Git:** no "claude" in branch names and no attribution lines. Open one PR (base `ui-revamp/phase1-shell` until #91 merges, then `refactor`). Keep `docs/CODEBASE-GUIDE.md` current and tick the §12 backlog items this phase closes.

## Data sources (existing endpoints, shapes verified)

| Need | Call | Shape used |
|---|---|---|
| This period's and the previous period's spend, calendar, recent list, activity | `transactionApi.getTransactions({ date_from, date_to, page_size: 500, sort_by: "date", sort_order: "desc" })` | `{ data: { id, vendor_name, date: "YYYY-MM-DD", total_amount, category, created_at }[] }` |
| Upcoming bills, bill pins on the chart | `aiAnalyticsApi.getReminders(31)` | `{ reminders: { id, vendor, amount, date, type: "upcoming" \| …, category }[] }` |
| Forecast to month end | `aiAnalyticsApi.getForecast(31)` | `{ forecast: { success, forecast?: { dates: string[], values: number[], total_predicted } } }`. When `success` is false, no forecast line is drawn |
| "Receipts need a glance" action card | `reviewApi.list()` | length |

## Decisions this plan makes (owner may override)

- **Brief (interim until the Phase 3 summary endpoint).**
  - It is a single rule-based sentence computed client-side: `briefSentence(...)`.
  - With last-month data: "October is running 9% lighter than September", or "…heavier…" when it is up.
  - Otherwise: "You've spent ₹18,412 so far in October."
  - The next bill is appended when one is known: "Netflix renews on Friday."
- **Lumen found (interim).** The only Phase 2 item is the review count ("3 receipts need a glance" → `/receipts?tab=review`). With nothing to show, the card says "Nothing needs you right now." Phase 3 adds subscriptions, spikes and duplicates.
- **Budget card.** An empty state ("No budget yet") plus the promo card, whose button is disabled and labelled "Coming soon". Phase 3 wires it up.
- **Activity (interim).** Derived from the 5 newest transactions by `created_at`, shown as "Added Swiggy ₹486 · 2h ago". Phase 3 may replace this with a real feed.
- **Home sub-tabs** (Overview / This month / Year) **are not built.** Spec §11 left this open, and the range chips on the chart cover the need. Recorded in the backlog.
- **The upload and export buttons** move into the greeting row as two icon buttons, reusing the existing `DialogDemo` (upload, still opened by `?upload=1`) and `ExportDialog`.
- **`theme-color`** (backlog item). `(app)/layout.tsx` becomes a 6-line server file that exports `viewport = { themeColor: "#f4f3ef", colorScheme: "light" }` and renders the current client layout, moved to `components/app-shell.tsx` unchanged. A client file cannot export `viewport`.

## Review Focus

1. **A brand-new user with zero transactions:** every card shows its empty state, with no `NaN`, `₹0 of ₹0`, empty chart axes or division by zero. Task 1 test `brief with no data` and Task 3 e2e `new user sees empty states`.
2. **Month boundaries:** on the 1st of a month, the chart and "vs last month" use the right periods. On the 31st, the previous month has only 30 days, so compare against the last day that exists, not a missing one. Task 1 test `same-day comparison clamps to previous month length`.
3. **Slow backend (Render cold start):** the cards' skeletons hold their final size and nothing moves when data arrives. Task 2 e2e `home has no layout shift while loading`.
4. **The forecast endpoint fails or reports `success: false`:** the chart still renders actuals without the dotted line. Task 3 e2e `chart survives a failed forecast`.
5. **Large amounts and long vendor names (₹15,00,000, "Bharat Sanchar Nigam Limited Postpaid"):** text truncates and doesn't wrap the layout. Task 4 e2e `long names truncate`.

## File map

| File | Responsibility |
|---|---|
| `frontend/src/lib/home-math.ts` (new) | Pure functions: periods, cumulative series, same-day comparison, brief sentence, calendar buckets, relative time |
| `frontend/e2e/home-math.spec.ts` (new) | Node-only unit tests for `home-math` (no `page` fixture) |
| `frontend/src/app/(app)/home/use-home-data.ts` (new) | `useHomeData(range)` parallel fetch → `{ status, txns, prevTxns, reminders, forecast, toReview }` |
| `frontend/src/app/(app)/home/_components/*.tsx` (new) | `brief.tsx`, `spend-card.tsx`, `lumen-found.tsx`, `calendar-card.tsx`, `bills-card.tsx`, `budget-card.tsx`, `activity-card.tsx`, `card.tsx` (shared shell: title row and skeleton) |
| `frontend/src/app/(app)/home/homeContent.tsx` (new) | Replaces `dashboardContent.tsx` (deleted) |
| `frontend/src/app/(app)/layout.tsx` → `frontend/src/components/app-shell.tsx` | Server/client split for `viewport` |
| `frontend/e2e/fixtures.ts` | `signIn(page, { home?: HomeFixture })` adds stubs for `/transactions`, `/api/analytics/reminders` and `/api/analytics/forecast`, with an optional delay |
| `frontend/e2e/home.spec.ts` (new) | Home e2e |
| Delete if unused afterwards | `components/section-cards.tsx`, `components/animatedListItemUse.tsx`. Confirm by grep. Keep `uploadDialog.tsx` and `exportDialog.tsx` |

---

### Task 1: `home-math` pure functions with unit tests

**Files:** create `frontend/src/lib/home-math.ts` and `frontend/e2e/home-math.spec.ts`.

**Interfaces (produced, used by Tasks 2–5):**

```ts
export type Txn = { id: string | number; vendor_name: string | null; date: string; total_amount: number | null; category: string | null; created_at: string | null };
export type Range = "1W" | "1M" | "3M" | "YTD";
export type Period = { start: Date; end: Date; days: number };          // inclusive, local dates at 00:00
export function periods(range: Range, today: Date): { current: Period; previous: Period };
//   1W: Mon..Sun week containing today vs the week before; 1M: calendar month vs previous calendar month;
//   3M: last 3 calendar months incl. current vs the 3 before; YTD: Jan 1..Dec 31 this year vs last year.
export function cumulative(txns: Txn[], p: Period): number[];           // length p.days, running sum by day index
export function sameDayDelta(cur: number[], prev: number[], dayIndex: number): { abs: number; pct: number } | null;
//   compares cur[dayIndex] with prev[min(dayIndex, prev.length-1)]; null if prev total at that point is 0
export function briefSentence(a: { monthName: string; prevMonthName: string; spent: number; delta: { pct: number } | null;
  nextBill?: { vendor: string; date: Date } ; money: (n: number) => string; today: Date }): string;
export function calendarBuckets(txns: Txn[], p: Period): { day: number; amount: number }[]; // one per day of p
export function heat(amount: number, max: number): number;              // 0 when amount 0, else 0.15..0.85
export function relativeTime(iso: string, now: Date): string;           // "just now" | "5m ago" | "2h ago" | "3d ago" | "14 Oct"
```

- [ ] **Step 1: Write the failing tests** in `e2e/home-math.spec.ts`. Import with the relative path `../src/lib/home-math`, because Playwright doesn't resolve the `@/` alias. Use exact values. Test names:
  - `periods 1M on Oct 20 is Oct 1..31 vs Sep 1..30`: the days are 31 and 30.
  - `periods 1W uses Monday weeks`: 2026-10-20 is a Tuesday, so the week is Oct 19..25.
  - `cumulative sums by day and ignores out-of-period and null amounts`: transactions on Oct 1 (100), Oct 3 (50), Sep 30 (999) and Oct 3 (null) give `[100,100,150,…]` with length 31.
  - `same-day comparison clamps to previous month length`: cur has length 31, prev has length 30, and day index 30 is compared with prev[29].
  - `sameDayDelta is null when previous is 0`.
  - `brief lighter`: spent 18412, pct -9.2, Sep→Oct, gives `"October is running 9% lighter than September."`.
  - `brief heavier with next bill`: pct 12, next bill Netflix 2026-10-23 with today 2026-10-20, gives `"October is running 12% heavier than September. Netflix renews on Friday."`.
  - `brief with no data`: spent 0, delta null, gives `"Nothing spent yet in October."`.
  - `brief with no comparison`: spent 18412, delta null, gives `"You've spent ₹18,412 so far in October."` (money stubbed as `n => "₹" + n.toLocaleString("en-IN")`).
  - `next bill more than 6 days out uses a date`: 2026-11-01 with today 2026-10-20 gives `"… Rent renews on 1 Nov."`.
  - `heat`: `heat(0,100)=0`, `heat(100,100)=0.85`, and a small positive value is ≥0.15.
  - `relativeTime`: 30s gives "just now", 5min gives "5m ago", 2h gives "2h ago", 3d gives "3d ago", and 10d gives "10 Oct" for 2026-10-10 with now 2026-10-20.
- [ ] **Step 2: Run** `npx playwright test e2e/home-math.spec.ts --project=chromium`. The expected result is FAIL, because the module isn't found.
- [ ] **Step 3: Implement** `home-math.ts`. Use local dates throughout. Parse `YYYY-MM-DD` as a local date, not UTC: `new Date(y, m-1, d)`.
- [ ] **Step 4: Run it again.** All tests should pass.
- [ ] **Step 5: Commit** with `feat: home math (periods, cumulative spend, brief sentence) with unit tests`.

### Task 2: Home frame, data hook, theme-color, no-shift skeletons

**Files:**
- Move `(app)/layout.tsx` → `components/app-shell.tsx` (`export function AppShell`), and write a new server `(app)/layout.tsx`.
- Create `use-home-data.ts`, `_components/card.tsx`, `_components/brief.tsx` and `homeContent.tsx`. Point `home/page.tsx` at `HomeContent`.
- Delete `dashboardContent.tsx`.
- Extend `fixtures.ts`. Create `e2e/home.spec.ts`.

**Interfaces:**
- `useHomeData(range: Range)` returns `{ status: "loading" | "ready", txns: Txn[], prevTxns: Txn[], reminders: Reminder[], forecast: { dates: string[]; values: number[] } | null, toReview: number }`.
  - It uses `Promise.allSettled`, so a failed call yields an empty value for that card, not an error page.
  - `type Reminder = { id: string|number; vendor: string; amount: number|null; date: string; type: string; category?: string }`.
- `HomeCard({ title, href?, children, loading, skeletonHeight })` renders the `label-mono` title row (with `›` when `href` is set) and a card. While `loading` it shows a `Skeleton` of `skeletonHeight` px instead of `children`.
- `signIn(page, { home: { txns?, prevTxns?, reminders?, forecast?: object | "fail", delayMs? } })`. Route the transactions stub by its `date_from` query param, returning the current or previous set.
- Layout from the mockup:
  - **Greeting row:** "Good {morning|afternoon|evening}, {first name}" at 24px/500, with the upload and export icon buttons on the right.
  - **Brief:** below the greeting, `font-serif` 21px, max-w-[820px].
  - **Band:** `absolute inset-x-0 top-0 h-[260px] bg-(--band) pointer-events-none` behind both.
  - **Grid:** `grid gap-3.5 lg:grid-cols-[1fr_330px]`.

- [ ] **Step 1: Write the failing e2e tests** in `home.spec.ts`:
  - **`home greets and briefs`:** with the fixture's txns totalling 18412 this month and 20280 for the same days last month, the page title starts "Home", the heading matches `/^Good (morning|afternoon|evening), E2E$/`, and the brief contains "lighter than".
  - **`app pages set a light theme-color`:** `meta[name=theme-color]` on `/home` has content `#f4f3ef`, and on `/login` it is still `#050505`.
  - **`home has no layout shift while loading`:**
    1. Use `delayMs: 1500`.
    2. Add an init script that sums `PerformanceObserver({type:"layout-shift", buffered:true})` values, excluding entries with `hadRecentInput`.
    3. After the brief is visible and 500 ms more have passed, expect the sum to be `< 0.01`.
  - **`old dashboard is gone`:** no text "Financial Overview" and no "What to watch".
- [ ] **Step 2: Run them.** The expected result is FAIL: the old dashboard, a dark theme-color and the old heading.
- [ ] **Step 3: Implement** according to the Interfaces above. The brief uses `briefSentence` with `useMoney()`. Month names come from `toLocaleString("en-IN", { month: "long" })`.
- [ ] **Step 4: Run** `npm run test:e2e`. The expected result is that everything passes, including Phases 0 and 1.
- [ ] **Step 5: Commit** with `feat: Home frame (greeting, sky band, brief) with no-shift skeletons and light theme-color`.

### Task 3: Spent card (cumulative chart, forecast, bill pins, range chips)

**Files:** create `_components/spend-card.tsx` and wire it into `homeContent.tsx`. Tests go in `home.spec.ts`.

**Interfaces:**
- `SpendCard({ range, onRange, cur: number[], prev: number[], forecast, reminders, today, loading })`. `HomeContent` owns `range` state, defaulting to `"1M"`, and passes it to `useHomeData`.
- **Header:** the title "SPENT THIS {WEEK|MONTH|QUARTER|YEAR}" (3M → QUARTER), the big total `cur[todayIndex]` with a one-time count-up, and the delta line "↓ ₹1,830 vs Sep at this point". The delta line is `text-good` when spending is down and `text-bad` when up, and is hidden when `sameDayDelta` is null. A legend sits on the right.
- **SVG** (`viewBox 0 0 860 170`, `preserveAspectRatio="none"` on the paths only; text stays crisp in a separate HTML axis row):
  - The current series drawn up to today as a solid `--primary` line with a gradient area fill.
  - The previous series as a dashed `muted-foreground` line at 60% opacity, across the full period.
  - Forecast, only for the 1M range when `forecast` is present: a dotted `--primary` line from today's cumulative value, adding `forecast.values` day by day until the month ends.
  - Bill pins from reminders with `type === "upcoming"` and a date inside the future part of the period. Each pin is a `--bad` stroked circle with a mono label.
  - A today marker line.
- **Axis:** 5 ticks (first day, ~25%, ~50%, today, last day). Dates use `label-mono`.
- **Chips:** 1W, 1M, 3M and YTD, as `button`s with `aria-pressed`.

- [ ] **Step 1: Write the failing tests:**
  - **`spend card shows total and delta`:** the text "₹18,412" is visible and the delta is "↓ ₹1,868 vs Sep at this point".
  - **`range chips switch period`:** clicking "1W" changes the title to "SPENT THIS WEEK" and gives "1W" `aria-pressed="true"`.
  - **`chart survives a failed forecast`:** with `forecast: "fail"`, the card renders, its svg has the solid series path and has no `[data-series=forecast]`.
  - **`bill pins show upcoming bills`:** a reminder for Netflix 3 days ahead gives an svg text "Netflix".
  - **`new user sees empty states`:** with no txns, the card shows "Nothing spent yet in {Month}" and no `NaN` appears anywhere on the page.
- [ ] **Step 2: Run them.** The expected result is FAIL.
- [ ] **Step 3: Implement.** Map x as `i / (days-1) * 860` and y as `160 - v / max * 140`, where max is the largest of cur, prev and forecast end values (and 1 if all are 0). Give each path `data-series="current|previous|forecast"` for the tests.
- [ ] **Step 4: Run** `npm run test:e2e`. Everything should pass.
- [ ] **Step 5: Commit** with `feat: Home spend card with last-period comparison, forecast and bill pins`.

### Task 4: Lumen found, spending calendar, recent transactions, upcoming bills

**Files:** create `_components/lumen-found.tsx`, `calendar-card.tsx` and `bills-card.tsx`. Tests go in `home.spec.ts`.

**Interfaces:**
- **`LumenFound({ toReview })`.** Title "LUMEN FOUND". When `toReview > 0`, it shows one action tile: tag "RECEIPTS", a serif headline "{n} receipt(s) need a glance", the line "Lumen wasn't sure about these. Nothing is saved until you approve.", and a link "REVIEW →" to `/receipts?tab=review`. When `toReview` is 0, it shows "Nothing needs you right now." The tile grid is `grid-cols-1 sm:grid-cols-3`, ready for Phase 3's three tiles.
- **`CalendarCard({ txns, period })`** has two halves:
  - **Left: "SPENDING CALENDAR".** A grid with 7 columns, Monday first, with leading blanks. Each cell shows the day number and the amount (`₹1.2k` style when it's 1000 or more). The background is `rgb(from var(--primary) r g b / heat)`. Cells use white text when heat > 0.5. This card always shows the current calendar month, whatever range is chosen.
  - **Right: "RECENT TRANSACTIONS".** The 5 newest transactions by date: vendor, then "Category · 20 Oct", then the amount. Each row uses `truncate` with `min-w-0`.
- **`BillsCard({ reminders, today })`.** Title "UPCOMING BILLS". It lists the next 3 reminders with `type === "upcoming"` and a date ≥ today. Each row has a date chip (weekday in mono plus the day number), the vendor and the amount. The empty state is "No bills coming up in the next month."

- [ ] **Step 1: Write the failing tests:**
  - **`lumen found links to review`:** with `reviewCount: 2`, a tile "2 receipts need a glance" links to `/receipts?tab=review`. With 0, the text is "Nothing needs you right now."
  - **`calendar shows amounts by day`:** with a fixture of ₹2,210 on the 4th, the cell for "4" contains "₹2.2k".
  - **`recent transactions list newest first`:** the first row shows "Swiggy".
  - **`long names truncate`:** with the vendor "Bharat Sanchar Nigam Limited Postpaid Services India" at ₹15,00,000, the row's height equals a short row's height, ±1px.
  - **`bills card lists next three`:** given 4 upcoming reminders, 3 rows are shown and the soonest is first.
- [ ] **Step 2: Run them.** The expected result is FAIL.
- [ ] **Step 3: Implement** according to the Interfaces above.
- [ ] **Step 4: Run** `npm run test:e2e`. Everything should pass.
- [ ] **Step 5: Commit** with `feat: Home cards for Lumen found, spending calendar, recent transactions and bills`.

### Task 5: Budget empty state, draft-budget promo, activity; cleanup and ship

**Files:** create `_components/budget-card.tsx` and `activity-card.tsx`; delete the unused old components; update docs.

**Interfaces:**
- **`BudgetCard()`.** Title "BUDGET · {MONTH}". The empty state is "No budget yet", plus the line "Lumen can draft one from your last 3 months."
- **`DraftBudgetPromo()`.**
  - The card background is `bg-accent-soft` with no border.
  - The heading is "Let Lumen draft your budget".
  - The body is "Built from 3 months of your actual spending. You approve every line before it's saved."
  - A disabled pill button reads "COMING SOON" with `aria-disabled`.
- **`ActivityCard({ txns, now })`.** Title "ACTIVITY". It shows the 5 newest transactions by `created_at` as "Added {vendor} {₹amount}" with `relativeTime` on the right. Empty state: "Nothing imported yet. Upload a receipt or a statement to get started." Include a link to `/receipts?tab=import`.

- [ ] **Step 1: Write the failing tests:**
  - **`budget is honest until Phase 3`:** "No budget yet" is visible, and the "COMING SOON" button is disabled.
  - **`activity shows newest imports`:** with `created_at` set 2h ago, the text "2h ago" is visible.
  - **`side column order`:** the side-column card titles are, in order, Budget, Upcoming bills, Let Lumen draft your budget, Activity.
- [ ] **Step 2: Run them.** The expected result is FAIL.
- [ ] **Step 3: Implement** according to the Interfaces above.
- [ ] **Step 4:** Delete `section-cards.tsx` and `animatedListItemUse.tsx` if `grep -rn` shows no other importers. Then run:
  - `npx tsc --noEmit`, `npm run lint` and `npm run build` with the dummy env. All should be clean, and `/home` should stay static (○).
  - `npm run test:e2e`: everything passes.
- [ ] **Step 5:**
  - Update `docs/CODEBASE-GUIDE.md` §7b2 with Home's cards, data sources, the interim rules and where Phase 3 plugs in.
  - In spec §12, tick the theme-color and band-contrast items, and add "Phase 3: replace interim brief, Lumen found, activity; wire budget" and "Later: Home sub-tabs (Overview / This month / Year)".
  - Add a STORY entry.
- [ ] **Step 6:** Run the whole-branch review (most capable model) with this plan's Review Focus. Fix Critical and Important findings with RED→GREEN tests. Push `ui-revamp/phase2-home` and open the PR.
