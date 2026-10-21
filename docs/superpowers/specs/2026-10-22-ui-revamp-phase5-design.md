# UI revamp, Phase 5: Home v2 and the inner pages

Addendum to `2026-10-20-ui-revamp-design.md` (IA, Sky palette, motion, zero layout-shift rule and §12 backlog still
apply). Approved by the owner on 2026-10-22 from the mockups in `2026-10-22-phase5/` (open the `.html` files in a
browser; `shell.css` is the shared style). The dark "decisions + questions" box on each mockup is a review aid, not UI.

## 1. Why

The owner ran Phases 0–4 locally and found the app still felt like the old one with a new coat: Home didn't resemble
the inspiration (Origin's app home), labels used a generic all-caps mono font, sidebar groups weren't marked, and some
chips sent text to the AI when they should have done something. The inner pages (Spending, Bills, Receipts) are still
the old pages stacked inside new URLs, and Budget has no page. Phase 5 makes every main page look and behave like one
calm product: "not too pushy with info, not too implicit".

The shell fixes (labelled groups, collapse in the sidebar header, no desktop top bar, `.label-ui` sentence-case labels,
upload chip in Ask) shipped first in PR #96 and are the baseline for this phase.

## 2. Goals, non-goals, anti-goals

**Goals**
- Home v2 and four pages (Spending, Bills & subscriptions, Budget, Receipts & statements) built to the mockups.
- Budget becomes a page with a **Plan** sidebar group (Plan · Budget), between Track and Records.
- One shared page skeleton so the pages can't drift: header (title, one-line serif brief, quiet actions), cards,
  labels, number style, the smooth area chart, the calendar grid.
- The cheap backend pieces each page needs (§5), and the §12 items tagged Phase 5 (§7).
- Zero layout shift: every range/filter/month change, hover-edit and dialog keeps its box (bounding-box or CLS tests,
  as in Phases 0–4).

**Non-goals**
- Forecast page (Plan · Forecast) and Phase 6 performance work.
- Smarter "Lumen found" and budget drafts (median/trimmed mean, one-off detection): stays §12 *Later*, gated on an eval
  set first (owner request). The draft UI is built so a "basis" sentence can carry it later.
- Paid-vs-overdue matching of bills to payments, per-field extraction confidence, "unused" (usage) detection, PDF bank
  statements, async extraction states (Reading / Failed + Retry): deferred, see §6.

**Anti-goals** (would be a failure even if it "works")
- Showing anything the data can't back: a deferred element is **hidden**, never faked or filled with placeholders.
- Loud saturated blue buttons, all-caps mono labels, a dark dialog inside the light app.
- A chip or button whose label is an action ("Upload…", "Mark as cancelled") that sends text to the chat instead.
- Layout jumps when data loads, filters change or a row enters edit mode.

## 3. Shared skeleton (all pages)

As in `home.html`:
- **Header row:** sans 26px `h1`, quiet actions on the right (`Upload` as a light button, icon buttons for export/help),
  leaving room for the floating account menu (`md:pr-12`). Below it a one-line Newsreader brief built from real numbers
  (same style as Home's brief; one emphasised phrase in italic accent).
- **Cards:** white, hairline border, 16px radius, very soft shadow; title row = `.label-ui` + optional `›` link + optional
  small `+` action on the right. One strong number per card, tabular numerals.
- **Charts:** smooth (monotone/Catmull-Rom) area line in accent with a soft gradient, previous period dashed grey,
  forecast dotted light accent, today dot, bill pins as small round markers on the x-axis; y labels right-aligned;
  sparse x ticks (no overlap at any width; fixes the "01 OC09 OCT" overlap on phones).
- **Range/period chips** centred under the chart (Home) or in a segmented control under the header (pages).
- **Buttons:** `.btn` quiet (light, hairline) or dark primary for the one main action of a page. The shadcn `Button`
  default blue is not used on these pages; Export/Upload get restyled (§12).
- **Dialogs:** light (Sky tokens), including the upload dialog.

Implementation is the builder's call (a `PageHeader` + a few card primitives in `components/page/` is the expected
shape); the rule is that the five pages use the same pieces.

## 4. Pages

### 4.1 Home v2 (`home.html`)
Greeting row; brief; **hero card "Spent in <month> ›"** (big number, delta vs previous period with sign colour, "heading
for ₹X" from the forecast, legend, `+` = upload, chart, range chips 1W/1M/3M/YTD); then a two-column grid:
- left: **"<Month>, day by day"** card = month total + calendar with the amount in each day cell (heat shade, today
  outlined, future days dashed with known bills named) beside **Recent transactions** (5, logo chip, date · category,
  amount, "See all" → Spending); **Lumen found** as a quiet list (icon, headline, detail, two action links that *do*
  things: e.g. Review duplicate → the review item, See in Spending → filtered Spending, Ask why → Ask with the question
  filled).
- right: **Budget in <month>** (spent of total, green bar + %, top 4 category bars; no budget → the draft promo linking to
  the Budget page); **Coming up** (next 4 bills with date chips); Activity stays only if it fits, else moves to
  Receipts.
Everything on Home already has data except per-category budget bars (exists via `/api/budget`) — no new endpoint.

### 4.2 Spending (`spending.html`)
Answers "where did my money go, and is anything off?". Header + period control (This month / Last month / 3M / YTD /
Custom) + "Compare with <previous>" toggle + date range. Hero: total, delta, cumulative line vs previous; inset "Month
by month" bars (last 6 months, average). For 3M/YTD the bars become the main chart (owner may revisit).
Row 2: **By category** (horizontal bars: amount, share, change vs previous; click a row = filter the table, "Clear";
"N transactions still need a category → Sort them now") and **Lumen noticed** (findings from `/api/home/summary`
kinds: duplicate, spike, price_rise, review; each with real actions + "Ask Lumen why"). The mockup's "First time at a
merchant" card is **dropped** (no such finding kind).
Row 3: **Transactions** table (search, category chip filter, source filter, date/merchant/category pill/source/amount,
hover pencil → category menu; "Always file <merchant> here" only if a rule store exists — otherwise omit) and **Top
merchants**. Export = CSV of the current filtered view.
Removes the duplicated payment calendar + reminders and the two `<h1>`s (§12).

### 4.3 Bills & subscriptions (`bills.html`)
Answers "what's due, what recurs, what can I cut?". Header + month switcher. Three tiles: due in next 30 days, recurring
per month, "subscriptions that look stopped" (renamed from "you may not use": we only know charges stopped, not usage).
**Month calendar** with bill names/amounts on due days (states shown: upcoming, today; paid/late/overdue states are
deferred) beside an **Upcoming** agenda grouped This week / Next week / Later with group totals. **Subscriptions table**
(tabs Subscriptions / Bills / All): logo chip, cadence, last charged, next charge, amount, pills for price rise and
"looks stopped". Actions: **Mark as cancelled**, **Not a bill** (both saved, §5), **How to cancel** → opens Ask with
"How do I cancel <vendor>?" typed but not sent (owner choice). "Set reminder" and the overdue strip are deferred.
Bills owns the calendar and reminders; Spending no longer shows them.

### 4.4 Budget (`budget.html`) — new page, sidebar Plan · Budget
Answers "am I on track, and what should my plan be?". Header + month switcher, "Edit budget" (quiet) and "Let Lumen
draft" (dark). Hero: spent of total, green bar with an even-pace tick, left / days left / safe per day (= left ÷ days
left; subtracting known upcoming bills is the builder's call if the bills data is already loaded), pace chart (actual
vs straight line to the budget). **By category** table: budget, spent, left, bar (green / amber ≥90% / red over), hover
→ inline edit of the amount (Enter saves, Esc cancels, no row height change), footer "categories add up to X, Y
unassigned" + Add category. **Draft panel on the page** (owner choice; replaces the dialog): each line shows proposed
amount, old limit, basis sentence, a small month-bars glyph, Approve / Skip with the category in the accessible name,
decided state in place, "Approve remaining N". Home's promo links here. **Last 6 months**: budget outline vs actual
bars (green under / red over), current month as "so far" + forecast.

### 4.5 Receipts & statements (`receipts.html`)
Answers "what have I given Lumen, and what needs my OK?". Header actions Upload / Import statement / Connect email.
**Needs your review** row of cards (only when the queue is non-empty; count = sidebar badge): extracted fields with the
doubtful ones highlighted from existing validation flags (`total_mismatch`, `duplicate`, `bad_date`, `unknown_vendor`,
`no_currency`), a plain-words reason, Approve / Edit / Reject (duplicate: "Keep both" / Compare / Reject). This replaces
the old Review tab. **Library** list (filter chips All / Receipts / Invoices / Statements / Contracts, search, list view
default; grid toggle optional): file icon, title, came from (Upload / Gmail / Import), date, amount, status (Needs
review, Done; Reading/Failed deferred). Right column: **Statement imports** history (bank/file, period, lines, new /
matched / duplicates / credits skipped bar) and **From your inbox** (Gmail status, Check now, Pause). **Light upload
dialog**: choose Receipts & invoices vs Documents, drop zone, accepted types, per-file progress rows, pointer to Import
statement for CSVs.

## 5. Backend in scope ("build what's cheap", owner choice)
- `GET /api/bills/recurring`: wraps `ai/recurring.find_recurring` (vendor, cadence, typical amount, last/next date,
  bill vs subscription, price change, looks-stopped) minus vendors the user dismissed; plus
  `POST /api/bills/recurring/<vendor>/state` with `cancelled | not_a_bill | active` saved per user (new small table).
  Home's bills card and the Bills page both use it.
- `GET /api/budget?month=YYYY-MM` and `GET /api/budget/history?months=6` (budget vs actual per month). Daily cumulative
  series for the pace chart comes from the transactions the page already fetches (no new endpoint unless that is
  heavy).
- Statement import history: persist one row per import (file name, account/bank label if given, period from the
  rows, counts already returned by the import); `GET /api/statements/imports`.
- §12 backend items: `POST /chat` creates the thread and its messages in one commit; the lost approval race returns a
  generic "This proposal was already decided" (re-read status after a failed claim); `basis.months` lists only months
  that had spend.
- Everything new: per-user scoping, rate limits like the neighbouring routes, tests first.

**Decisions made after the builder check (agent's calls, owner can overrule):**
- **Budgets are versioned by month.** Today `Budget` is one `monthly_limit` per category. Add an `effective_from`
  month (migration; existing rows get the month they were created). A month's budget = for each category, the latest
  row with `effective_from <= month`. Editing (inline or Edit budget) writes a row effective from the **current**
  month, so past months keep what they were; approving a draft "for November" writes rows effective from November.
  Past months are read-only in the UI. History therefore compares each month with the limits that applied then; months
  before any budget show actual spend only (no outline). `User.monthly_budget` stays the overall total fallback.
- **Saved recurring states are keyed by the normalised vendor** (`ai/recurring._norm`, the same key `find_recurring`
  groups by); the route takes the display name and normalises it. `not_a_bill` hides the vendor from every recurring
  list (a "Hidden" tab or footer link lets you undo). `cancelled` keeps the row in a dimmed "Cancelled" group at the
  bottom; if a charge from that vendor appears **after** the cancel date, the state is ignored and the row shows a
  "charged again after you cancelled" pill.
- **Library "Statements" filter** lists the new import-history rows as library items (type Statement, came from
  Import, no file to open since CSVs aren't kept). The chip shows only when there is at least one.
- **Import history starts with the new table** (older imports don't appear). Counts are stored as the import returned
  them; a re-import of the same file is a new history row and its "matched" count may repeat, labelled "at import".

## 6. Deferred (hidden until built; recorded in §12)
Paid / paid-late / overdue matching per bill cycle and the overdue strip; "Set reminder"; usage-based "unused";
quarterly cadence detection; credit-card bill due dates from statements; per-field extraction confidence; persisted
Reading/Failed + Retry; PDF statement import; "Approve all high-confidence"; category rules ("Always file X here");
median/outlier budget drafts (eval set first); Spending's "first time at a merchant" finding.

## 7. §12 items folded in
Duplicate calendar/reminders and the double `<h1>` on Spending; Export/Upload restyle + light upload dialog; draft
buttons' accessible names + `basis.months`; `POST /chat` single commit; generic 409 text; thread rail (disable
Keep/Delete while busy, focus "Keep" when confirm opens, trash visible on touch); AskPalette rendered outside
`<Sidebar>` so Ctrl+K works on tablets with the sheet closed.

## 8. Delivery
Stacked PRs into `refactor`, each green and checkable on its own, in this order (later ones may depend on earlier):
1. **5a** shared skeleton + Home v2 + Export/Upload restyle + light upload dialog + Ask/§12 frontend fixes.
2. **5b** Spending.
3. **5c** Bills (+ recurring API and saved states).
4. **5d** Budget page + Plan group (+ month/history API, draft panel, §12 draft items).
5. **5e** Receipts & statements (+ import history API, review cards replacing the Review tab).
Each PR: TDD per task, layout-shift tests for its controls, a manual-check list for the owner, a STORY entry, and the
codebase guide updated. One whole-branch review at the end of the phase; Critical/Important fixed test-first, Minors to
§12.

## 9. Left to the builder
Component boundaries and file layout; chart implementation (existing chart code vs a small SVG helper); exact
breakpoints (pages must work at phone width with no sideways scroll); empty and loading states in the established
skeleton style; whether Activity stays on Home; how the brief sentence is phrased per page as long as it uses real
numbers only.
