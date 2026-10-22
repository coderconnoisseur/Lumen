# Lumen inner-app UI/UX revamp: design

Status: **DRAFT for owner review** · 2026-10-20 · supersedes the "no new design system" line in
`docs/direction/specs/SPEC-UX.md` (its evidence-first chat and review-queue goals still stand).
Reference mockup: [`2026-10-20-ui-revamp/home-mockup.html`](2026-10-20-ui-revamp/home-mockup.html)
(screenshot: `home-mockup.png`). Use the **Sky** variant; the Ink variant is rejected.

## 1. Why

The signed-in app still carries its November 2025 skeleton: a stock shadcn sidebar ("Financial command
center", "Workspace", "Compare"), tabs that no longer match what the app does (Analytics and Spending Views
open the same page, "Review (test)", a separate Import page), and an Overview that looks like every
AI-generated dashboard. The owner wants a full rethink (information architecture, layout, palette, motion),
not a re-skin. Inspiration: Origin Financial's app (useorigin.com): dense, warm, every card says something
specific, serif + mono-label typography, a sky motif that our landing page already uses.

Success = opening Lumen feels like a calm, specific briefing on *your* money, not a template; nothing on screen
moves unless you asked it to; and it stays light on the free Vercel tier.

## 2. Goals / non-goals / anti-goals

**Goals**
- New information architecture and sidebar (section 3).
- A new Home built from the mockup (section 4).
- A design system: Sky palette, type scale, spacing, motion rules (sections 5–6), applied to every inner page.
- Ask Lumen touch-up: fresh chat on open + history list; Home Ask bar hands off smoothly (section 7).
- A **zero layout-shift rule** enforced app-wide, starting with the known bug (section 6.3).
- Frontend performance pass (section 9).

**Non-goals**
- Bank/card linking, net worth, credit score, investments, financial-planner booking, paywalls. Every number
  comes from imported statements, receipts and invoices already in Lumen.
- Landing page, login and onboarding (already redesigned; only re-tint to share tokens if trivial).
- The BYOK feature itself (another session builds it). This revamp only gives it a home: the avatar menu.

**Anti-goals** (fail even if it works)
- Generic KPI-card grid, gradient-blob "AI dashboard" look.
- Any click on one region visibly nudging another region (the profile-menu bug class).
- Invented numbers or scores. A card with no real data shows an honest empty state, not a placeholder figure.
- Bouncy or slow animation; anything that ignores `prefers-reduced-motion`.

## 3. Information architecture (owner-decided)

```
Lumen
  Home
TRACK
  Spending                 ← merges /analytics (+weekly/monthly/yearly tabs) and /ai-analytics charts
  Bills & subscriptions    ← recurring charges, payment calendar, reminders
PLAN
  Budget        (NEW)
  Forecast      (later; shown only once built)
───────────
  Receipts & statements  3 ← merges /documents, /import, /review; badge = items needing review
  Ask Lumen          ⌘K
```

- Group labels describe what the user does (owner rule: never name groups after backend concepts like
  "AI" or "Data"). **Insights is not a tab**: its content becomes Home's "Lumen found" cards and the Spending
  page.
- **Profile, settings, API keys (BYOK), theme, log out → top-right avatar menu.** The sidebar is navigation
  only.
- **Collapse:** icon rail (~56px) with tooltips, toggled by a button and Ctrl/⌘+B, remembered across visits
  (the existing shadcn sidebar cookie is fine). The content area animates width; content must not jump.
- Mobile (<768px): the sidebar becomes a sheet (existing shadcn behaviour). Builder's call on adding a
  bottom tab bar.
- Old URLs (`/dashboard`, `/analytics`, `/ai-analytics`, `/chatbot`, `/documents`, `/import`, `/review`,
  `/upload`) redirect to their new homes so bookmarks and the demo keep working. New route names are the
  builder's call (suggested: `/home`, `/spending`, `/bills`, `/budget`, `/receipts`, `/ask`).
  Until Phase 5 redesigns them, the new URLs render the existing page content (Spending = analytics +
  ai-analytics stacked; Receipts = documents + import + review as tabs). Budget's nav item appears only once
  its page exists (my call).

## 4. Home (owner-approved content)

Layout per the mockup: greeting row (left) + icon buttons and avatar (right); sub-tabs
**Overview · This month · Year**; a one- or two-sentence brief in Newsreader; then a two-column grid
(main ~1fr, side ~330px) over a sky-tinted header band that fades into the page.

| Card | Content | Data |
|---|---|---|
| Brief | e.g. "October is running 9% lighter than September. The one thing worth a look: food delivery is up ₹2,140, and Netflix renews on Friday." | **Rule-based, no LLM per page load.** New backend: a summary endpoint picks the top fact or two from month-to-date vs last month, the biggest category change, and the next bill. |
| Spent this month | Cumulative spend line for this month vs last month (dashed) plus a dotted forecast to month-end, with bill pins on the future part. Range chips 1W/1M/3M/YTD. | Existing `/api/analytics/dashboard` + `/forecast`; recurring bills for the pins. |
| Lumen found | "N things worth ₹X this month", then up to 3 action cards: mono TAG, serif number-led headline, one line of why, a link. Kinds: unused/new subscriptions, category spikes, receipts needing review, duplicate charges. | New aggregation endpoint over the existing anomalies, insights and recurring detection and the review queue. ₹ "worth" only where a real saving exists; otherwise the headline carries no amount. |
| Spending calendar + Recent transactions | Month heat-grid (darker = more spent, amount in cell) beside the last 5 transactions. | Existing invoice/transaction data. |
| Budget **(NEW)** | "₹spent of ₹budget", progress bar, "₹left · N days · ~₹/day". Empty state → the draft-budget card. | New budget model + API (section 8). |
| Let Lumen draft your budget **(NEW)** | Promo card; drafts per-category limits from 3 months of spending; user approves each line before save (Lumen's propose-then-approve rule). | Reuses the agent proposal/approve flow. |
| Upcoming bills | Next 3 recurring charges with date chips. | Existing recurring detection / reminders. |
| Activity | Imports, receipts read, new subscriptions spotted, with relative times. | New lightweight feed from created_at timestamps; no new event table unless needed. |

Deferred: the "+" ask-about-this button on every card (owner: maybe later). The Ask bar lives in the sidebar
("Ask anything ⌘K"); typing there and pressing Enter routes to Ask Lumen with the question already
running (section 7).

## 5. Visual system: Sky (owner-decided)

Tokens from the mockup, to be re-expressed as `oklch` CSS variables in `globals.css` (replacing the current
blue-grey dark theme):

| Token | Value | Use |
|---|---|---|
| bg | `#f4f3ef` | page (warm paper) |
| side | `#efeee9` | sidebar |
| card | `#ffffff` | cards |
| line | `#e6e4de` | borders, dividers |
| text / mute | `#1b1b1a` / `#7c7a74` | body / secondary |
| accent / accentSoft | `#2f6fe0` / `#dfe9fb` | links, chart line, selection / promo cards |
| good / bad | `#2e8b57` / `#c4572f` | deltas, bill pins |
| band | `linear-gradient(#cfe2fb → #e9f1fb → bg)` | sky header band, Home only (builder may reuse on other page headers) |

Light theme only for this revamp, scoped to the signed-in `(app)` route group; the root layout's forced
`dark` stays for landing/login/onboarding (my call). No "theme" item in the avatar menu yet. Ink (dark) is out; a later dark mode is possible because everything goes
through tokens.

Type: **Funnel Sans** (UI, numbers), **Newsreader** (brief, card headlines, italics for emphasis),
**IBM Plex Mono** small caps-style labels (10.5px, 0.12em tracking) for card titles, tags and axis ticks.
Load fonts via `next/font` (self-hosted, no layout shift). Radius 14px for cards, 8px for controls.

## 6. Interaction and motion (owner-decided: quiet and quick)

### 6.1 Motion rules
- 150–250ms, ease-out; opacity/transform only (never animate layout properties except the sidebar width).
- Route change: content fades/slides 4–8px; the sidebar and header never re-animate.
- Numbers count up once on first load, not on every revisit.
- Ask handoff: the sidebar Ask input morphs into the chat composer (shared element / View Transitions API
  where supported; plain fade fallback).
- All motion off under `prefers-reduced-motion`.
- Use **one** animation library (`motion`); drop the duplicate `framer-motion` import path.

### 6.2 Feedback states
Every async card has a skeleton matching its final size (no jump when data arrives), an empty state with a
next step, and an inline error with retry. Abstaining is a designed state (from SPEC-UX).

### 6.3 Zero layout-shift rule (owner requirement)
**Known bug:** opening the profile dropdown shifts the chat column left. Root cause: Radix menus/dialogs are
modal by default; `react-remove-scroll` hides the page scrollbar and adds compensating padding, so centered
content moves. This affects every DropdownMenu, Dialog, Select and Popover.
**Fix once, globally:** `html { scrollbar-gutter: stable; }` plus neutralising the scroll-lock padding
(`body[data-scroll-locked] { margin-right: 0 !important; padding-right: 0 !important; }`), and/or
`modal={false}` on non-blocking menus in the shared `ui/` wrappers.
**Rule going forward:** an interaction in one region may not change the size or position of another region.
Overlays float; reserved space for async content; images and fonts sized ahead of time. Verify with a
Playwright check that opens each menu/dialog and asserts that main-content bounding boxes don't change (CLS = 0).
Playwright is a dev-only dependency; the check runs locally against the dev server with demo data and is
**not** a CI gate for now (my call; promote to CI once a seeded signed-in CI app exists).

## 7. Ask Lumen touch-up (owner-decided)

- Opening Ask Lumen starts a **fresh chat** with suggested questions (drawn from the current "Lumen found"
  items); past chats are in a collapsible history list on the side; one click resumes a chat.
- **Real threads (owner-decided):** add a conversation/thread id to `ChatMessage` (migration) plus endpoints
  to list threads, create one, and load one. Existing flat history becomes a single "Earlier chats" thread.
  This makes Phase 4 full-stack.
- From the sidebar Ask bar or ⌘K: Enter → navigate to Ask with the question already sent, so the answer
  appears as the page settles (Google AI-Overview feel). **No streaming in this revamp (owner-decided):**
  show a polished thinking state (work-trace steps animating in), then fade in the full answer. Token
  streaming (SSE) is a separate follow-up task.
- Restyle to Sky; keep evidence-first behaviour (citations, work trace, proposal cards) from SPEC-UX.
- Fix the stray "Next:" artefact visible under answers (seen in the 2026-10-20 screenshot).

## 8. New backend this implies

1. **Home summary** endpoint: the brief sentences + "Lumen found" items, rule-based, cached per user per day
   or invalidated on import.
2. **Budget**: per-user monthly budget with per-category limits (table + CRUD); "draft budget" as an agent
   proposal the user approves.
3. **Activity feed**: recent events from existing timestamps.
4. **Chat threads** (section 7).

Each ships with tests in the existing mocked-LLM suite style.

Calls made while writing this (not owner-decided; owner may override):
- New endpoints go in FastAPI `backend/api/` (the newer pattern, where agent proposals live), reading the
  analytics helpers as functions rather than calling the Flask routes.
- Draft budget = **one proposal per category** using a new `set_budget` proposal type, so the existing
  approve/reject-per-proposal flow and card UI work unchanged. "Approve all" is a convenience button. Fits the AI-engineering story: the draft
budget is tool-calling + human approval.

## 9. Performance pass (last phase)

- Remove unused heavy dependencies from the app bundle: `three`, `postprocessing`, `lenis` (check landing-page
  use first; lazy-load them there if still needed), `mathjs` if unused, the duplicate `framer-motion`.
- Code-split charts (`recharts`) with `next/dynamic`; server-render static shells where possible.
- Measure before/after (bundle size per route, Lighthouse LCP/CLS/INP) and log the numbers as a STAR entry
  in `docs/direction/STORY.md`.

## 10. Phased path (one PR per phase into `refactor`)

| # | Phase | Contents |
|---|---|---|
| 0 | Foundations | Sky tokens, fonts via next/font, global layout-shift fix + Playwright CLS check, motion rules |
| 1 | App shell | New sidebar IA, icon-rail collapse, top-right avatar menu (settings / BYOK slot / log out), route redirects |
| 2 | Home UI | Mockup → components with real existing data; budget/brief/activity cards render empty states |
| 3 | Home backend | Summary + "Lumen found" endpoint, activity feed, budget model + draft-budget proposal; wire into Home |
| 4 | Ask Lumen | Chat threads (migration + endpoints), fresh chat + history list, Ask-bar handoff with thinking state, restyle, "Next:" fix |
| 5 | Inner pages | Spending, Bills & subscriptions, Budget, Receipts & statements: each gets a short mockup round with the owner before build |
| 6 | Performance | Section 9, with measured before/after |

Keep `docs/CODEBASE-GUIDE.md` current in each PR.

## 11. Left to the builder
- Exact route names, component file layout, and whether Home sub-tabs "This month" / "Year" ship in phase 2 or later.
- Chart implementation (keep recharts or hand-rolled SVG like the mockup), as long as it matches the look and passes the perf budget.
- Mobile layout details beyond "sidebar becomes a sheet".
- Copy for empty states and the brief's rule templates.

## 12. Deferred backlog (revisit in the phase named)

Small items found while building, parked here so they aren't lost. Tick them off in the PR that fixes them.

- [x] **Phase 2.** The `theme-color` meta is still `#050505` inside the light app, so the mobile browser bar stays black. Make it per route group (`viewport` export in `(app)/layout`). *(Phase 0 review)*
- [x] **Phase 2.** Muted text on the `#cfe2fb` end of `--band` is about 4.2:1. Use `foreground` for text on the band. *(Phase 0 review)*
- [x] **Phase 4.** The Ask Lumen chat still uses the dark `.bui` palette inside the light shell. Restyle it to Sky. *(Phase 0)*
- [ ] **Phase 6.** The global reduced-motion rule also stops loading spinners. Consider exempting spinners with `motion-safe:` or giving them a static "Loading…" label. *(Phase 0 review)*
- [ ] **Phase 6.** The e2e suite is local and Chromium-only. Add Firefox once Windows allows Playwright's build (`E2E_FIREFOX=1`), and consider running it in CI with the `signIn` fixture. *(Phase 0)*
- [x] ~~**Phase 6.** `(app)/layout` reads the sidebar cookie on the server.~~ Not needed: the sidebar only renders client-side (behind the auth guard), so Phase 1 reads the cookie there and the app routes stay static. *(Phase 1)*
- [x] **Phase 5.** Spending and Bills both show the payment calendar and reminders cards in the interim. Remove the duplicate when the pages are redesigned. *(Phase 1 decision)* *(Done in 5a: those cards read fields the backend never sent and were removed; Bills shows upcoming bills until 5c.)*
- [x] **Phase 3.** The sidebar's review badge downloads every flagged item just to count them. Add a count-only endpoint (e.g. `GET /api/review?status=flagged&count=1`). *(Phase 1 review)*
- [x] **Phase 5.** `/spending` stacks two old pages, so it has two `<h1>`s and fetches the calendar and reminders twice. It goes away with the redesign. *(Phase 1 review)* *(Done in 5b: Spending is one page.)*
- [ ] **Phase 6.** iOS Safari 15 and older don't support `overflow-x: clip`, so wide landing marquees could scroll sideways there. If that matters, add an `@supports not (overflow-x: clip)` fallback (not `hidden` on body). *(Phase 1 review)*
- [x] **Phase 4.** Ctrl/⌘+K checks `e.key === "k"`, so Caps Lock or Shift misses it. Use `e.code === "KeyK"`. *(Phase 1 review)*
- [ ] **Phase 6.** The sidebar cookie expires after 7 days (shadcn default), so a collapsed rail reopens after a week away. Extend it to about a year. *(Phase 1 review)*
- [x] **Phase 3.** Replace Home's interim parts: the brief (summary endpoint), Lumen found (subscriptions, spikes, duplicates), Activity (a real feed, including statement imports dated earlier than this month), and wire up Budget and the draft-budget promo. *(Phase 2)*
- [ ] **Later.** Home sub-tabs (Overview / This month / Year). The chart's range chips cover this for now. *(Phase 2 decision)*
- [x] **Phase 5.** The Export and Upload buttons on Home still use the old loud blue `Button` and the dark upload dialog. Restyle them with the dialogs. *(Phase 2)* *(Done in 5a.)*
- [x] **Phase 3.** The calendar's `kShort` hardcodes `₹`; use the user's currency symbol like `useMoney`. *(Phase 2 review)*
- [x] **Phase 3.** `sameDayDelta` only guards a zero previous total. A refund-heavy start of month (negative running total) flips the brief's "lighter"/"heavier". Use `then <= 0`. *(Phase 2 review)*
- [ ] **Phase 6.** `CountUp` paints the final number for one frame before counting from 0. Start at 0 when it will animate. *(Phase 2 review)*
- [x] **Phase 6.** Measure each Home card's real content height against its `skeletonHeight` (the spend card's is estimated at about 270px vs 262px); the CLS test threshold of 0.01 can hide a small shift. *(Phase 2 review)* *(Done in 5a at the desktop layout; see the stacked-layout item below.)*
- [x] **Phase 3.** Confirm statement imports write rows before the POST returns. Confirmed: `api/statements.py` commits inside the request. *(Phase 2 review)*
- [ ] **Later (owner request).** Make "Lumen found" and the budget draft smarter. A plain 3-month mean is skewed by one-off big purchases (a phone, a laptop). Ideas: a median or trimmed mean per category; treat single large purchases as one-offs and leave them out of the limit (or suggest a separate "planned purchases" line); use seasonality and income; let the agent (LLM) explain or adjust a draft line, while approval still stays with the user. Measure any new rule against an eval set before switching. *(Phase 3)*
- [x] **Phase 4.** `_decide` (api/agent.py) checks `status == pending` without a conditional UPDATE. Two concurrent approvals on Postgres can both apply (duplicate audit lines), and two approvals for the same new category can return 500 on the unique constraint. Use the conditional `update(...).where(status=="pending")` pattern from `_save_invoice`. *(Phase 3 review)*
- [ ] **Phase 4.** Drafting a budget (HTTP or the agent tool) retires all pending `set_budget` proposals. A draft from Ask while Home's dialog is open makes that dialog's approvals return 409. Two quick drafts can leave two pending sets. Consider scoping by draft id and a per-user lock. *(Phase 3 review; Phase 4: Home's dialog now says "This draft was replaced. Draft again." instead of erroring. Scoping is still open.)*
- [x] **Phase 4.** After approving draft lines, Home reloads only the budget. Also reload the summary so Activity shows "You approved…" at once. *(Phase 3 review)*
- [ ] **Phase 6.** `/api/home/summary` and `/api/budget` each scan all of a user's transactions in Python on every Home visit. Fine for a few thousand rows; filter by date in SQL (and cache) if a user grows past that. *(Phase 3 review)*
- [x] **Phase 5.** Draft dialog: per-line buttons are named just "Approve" / "Skip". Add the category to their accessible names. The `basis.months` list always shows 3 months even when only 2 had spend. *(Phase 3 review; 5d: the draft moved to the Budget page with named buttons, and `basis.months` lists only months with spend.)*
- [x] **Phase 5.** `POST /chat` commits a new thread before saving its messages. If that save fails, the response points at an empty titled thread. Create both in one commit. *(Phase 4 review)* *(Done in 5a.)*
- [x] **Phase 5.** A lost approval race returns 409 "Proposal is already pending" (status read before the claim). Re-read the status or use a generic message. *(Phase 4 review)* *(Done in 5a: generic "This proposal was already decided.")*
- [ ] **Phase 6.** The `chat_messages.thread_id` index exists only on fresh databases (`_ADDED_COLUMNS` adds the column, not the index). Add `CREATE INDEX IF NOT EXISTS`. Fine at current scale because every query also filters on the indexed `user_id`. *(Phase 4 review)*
- [x] **Phase 5.** Thread rail: disable Keep/Delete while an answer is in flight; move focus to "Keep" when the confirm row opens; the trash icon is hover-only, so it's invisible on touch (mobile Sheet). *(Phase 4 review)* *(Done in 5a.)*
- [x] **Phase 5.** Below 768px the sidebar is a Sheet, and `AskPalette` renders inside it, so Ctrl+K on a tablet keyboard does nothing until the sheet is open. Render the palette outside `<Sidebar>`. *(Phase 4 review)* *(Done in 5a: the palette lives in app-shell.)*
- [ ] **Later.** Suggested question "What's waiting for my review?": check the agent can answer it (no review-queue tool). `price_rise` could use its subject ("Why did Netflix go up?"). *(Phase 4 review)*
- [x] **Phase 5c.** Home's "Coming up" and bill pins come from `/api/analytics/reminders`, which only has rows after the spending-pattern analysis has run (the old Spending page triggers it). Switch Home and Bills to the recurring-charges API in 5c. *(5a, owner report)* *(Done in 5c: Home and Bills read `/api/bills/recurring`.)*
- [ ] **Phase 6.** Below `lg` the Home cards stack and their placeholders no longer match the loaded heights; the Budget card also grows once a budget exists. Size placeholders per breakpoint, or load the budget with the page. *(5a; not done in 5d, moved to Phase 6)*
- [ ] **Later.** Budget page: "Safe per day" is left ÷ days left; subtract bills still due this month (the Bills data) once both are on the page. *(5d)*
- [ ] **Later.** The overall monthly budget (`User.monthly_budget`) isn't versioned like category limits, so history uses today's total for past budgeted months. Version it if people change it often. *(5d)*
- [ ] **Later.** Draft lines could show a small month-by-month glyph once `basis` carries per-month amounts. *(5d)*
- [ ] **Later.** Receipts: tell receipts from invoices in the data so the library can have both chips; "Compare" on a duplicate needs the review item to carry the record it duplicates. *(5e)*
- [ ] **Later.** Receipts library lists the latest 100 receipts; page through `/transactions` if people need older ones there. *(5e)*
- [x] **Phase 6.** Phase 5 review minors: refunds (negative spend) draw a full bar instead of an empty one (budget hero/categories, Home budget card, Spending by category) — clamp at 0. *(5 review)* Done: bars clamp at 0.
- [x] **Phase 6.** Bills calendar projects a monthly bill into months before its first charge, and hides cancelled bills in months they really were charged. Project from `last_charge_date` on; show real charges for past months. *(5 review)* Done: shown from the first known charge, and a cancelled/stopped one up to its last; real past charges still not drawn.
- [x] **Phase 6.** Naive UTC timestamps (`created_at`, `last_successful_poll`) are parsed as local time: "Checked 6 h ago" right after a poll in IST, late uploads dated a day off. Send them with `Z`. *(5 review)* Done client-side (`parseUtc`).
- [x] **Phase 6.** Spending brief can name a payment bigger than the category's change ("one ₹9,999 payment is most of a ₹2,000 jump"); check the size first. *(5 review)* Done: named only when it is between half and all of the rise.
- [x] **Phase 6.** Receipts brief says "Everything … is filed" when the review list failed to load; say nothing instead. *(5 review)* Done: says how many files instead.
- [ ] **Phase 6.** Small layout shifts: "Connect email" joins the header after load (wraps on phones); Budget hero/History taller than their skeletons on phones; a pending draft narrows By category one frame after load on lg. *(5 review)* Not reproduced: phone CLS tests for Budget and Receipts pass (< 0.01); kept as regression tests.
- [x] **Phase 6.** Home's spike link `?category=` is matched case-sensitively on Spending ("food" rows missed under "Food"). *(5 review)* Done: matched ignoring case.
- [ ] **Phase 6.** Import page currency starts as USD until the profile loads; an INR user who doesn't notice imports in USD. *(5 review; predates 5e)* Not reproduced: a delayed-profile test starts in INR; kept as a regression test.
- [x] **Phase 6.** If the budget-versions migration is skipped on Postgres (only a warning), edits to an existing category in a new month hit the old unique constraint and 500. Make that failure loud. *(5 review; migration smoke-tested on Postgres 16 locally)* Done: logged as an error naming the consequence.
- [ ] **Later.** Spending: the category edit (pencil) is hidden below `sm`, so phones can't recategorise; and "Lumen noticed" wraps beside its pill at 375px. *(5b)*
- [ ] **Owner, manual.** In Firefox, check that the profile/avatar menu doesn't shift the Ask Lumen column, and click through the old pages on light in a demo session. *(Phase 0 PR #89)*
