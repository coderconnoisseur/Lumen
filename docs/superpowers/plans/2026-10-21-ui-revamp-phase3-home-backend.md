# UI Revamp Phase 3 (Home backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Home's interim parts with real backend data:
- "Lumen found" with duplicates, spending spikes, price rises and receipts to review
- a real activity feed
- budgets, with per-category limits and an AI-drafted budget the user approves line by line
- a cheap review-count endpoint for the sidebar badge

**Architecture:**
- **Detection logic** is pure Python in `backend/ai/home_signals.py` and `backend/ai/budget.py`. It takes lists of plain dicts and is unit-tested without a database or LLM. It reuses `ai.recurring.find_recurring`.
- **Two new FastAPI routers**, `api/home.py` and `api/budget.py`, follow `api/profile.py`'s pattern (`get_engine` dependency, `current_user`, `rate_limit`).
- **Drafting a budget creates `set_budget` proposals.** Each proposal is approved through the existing `/api/agent/proposals/{id}/approve`, which upserts a `budgets` row. Ask Lumen can create the same proposals through a new agent tool. This is the "tool-calling + human approval" story the spec wants.
- **Money stays numeric on the wire.** Headlines carry `{0}` / `{1}` placeholders plus an `amounts` array, so the frontend formats them in the user's currency with `useMoney()`.

**Tech Stack:** FastAPI, SQLAlchemy (Flask-SQLAlchemy models, `create_all` adds new tables), pytest with the `TestClient` pattern from `tests/test_api_profile.py`, and on the frontend Next.js and Playwright (the `signIn` fixture).

**Spec:** `docs/superpowers/specs/2026-10-20-ui-revamp-design.md` §4 (Home table), §8 (new backend) and §12 (backlog items tagged Phase 3). It builds on `ui-revamp/phase2-home` (PR #92).

## Global Constraints

- **Honesty rule (spec anti-goal):** never invent a number.
  - A ₹ "worth" appears only where money can plausibly come back. That means duplicates only.
  - Price rises and spikes state facts, not savings.
  - With nothing to report, `found` is empty, and the frontend keeps "Nothing needs you right now."
- **No LLM calls in any Home endpoint.** The draft budget is deterministic arithmetic.
- **Propose, then approve (Lumen's rule):** a draft never writes `budgets` directly. Only approving a `set_budget` proposal does.
- **Per-user scoping on every query** (`user_id == claims["sub"]`). This matches the existing routers.
- **Portable SQL:** transactions' `date` is TEXT on SQLite and DATE on Postgres. Load the user's rows and filter in Python, as `agent/tools.py::_get_overview` does.
- **New table via `create_all`:** `budgets` is new, so no `_ADDED_COLUMNS` entry is needed. If Alembic is used in deploy, also add `alembic/versions/002_budgets.py`; follow `001_unified_schema.py`'s style.
- **Timestamps on the wire are ISO UTC with `Z`.** Use `.isoformat() + "Z"` for naive UTC `datetime`s.
- **Git:** no "claude" in branch names and no attribution lines. Open one PR (base `ui-revamp/phase2-home` until #92 merges). Keep `docs/CODEBASE-GUIDE.md` current, tick spec §12 items, and add a STORY entry.

## Decisions this plan makes (owner may override)

- **The brief stays composed on the client.** Phase 2's tested `briefSentence` writes the pace sentence. The server supplies `found[0]`, and the client appends "The one thing worth a look: {headline}." This avoids two implementations of the same sentence.
- **The overall budget is the existing `User.monthly_budget`,** set during onboarding. Per-category limits go in the new `budgets` table. The Budget card shows the overall figure, plus up to 3 categories closest to their limit.
- **Draft budget per category:**
  - Take the mean of the last 3 *complete* calendar months' spend.
  - Round it up: `ceil(avg / 500) * 500` when the average is at least 500, otherwise `ceil(avg / 10) * 10`.
  - Skip categories under ₹300 a month.
  - Create at most 8 proposals, largest first.
  - A new draft rejects the user's still-pending `set_budget` proposals first, with the audit `detail` `{"superseded": true}`, so drafts never pile up.
- **Thresholds for "Lumen found":**
  - **Duplicate:** the same normalised vendor and the same amount (±₹1) within 1 day, in the last 30 days.
  - **Spike:** a category's month-to-date spend is ≥30% above the same day last month **and** at least `max(₹1,000, 5% of last month's total)` above it.
  - **Price rise:** a recurring charge with `price_change.percent ≥ 5` and a last charge within 45 days.
  - **Review:** count > 0.
  - **Order:** duplicate → review → spike → price rise. Return the top 3 plus `more`.
- **Activity is built from existing tables. There is no event table.**
  - **Statement imports:** rows with `source == "statement"`, grouped by `created_at` to the minute, give "Imported a statement · {n} rows".
  - **Receipts:** other transactions give "Read a receipt: {vendor} {0}".
  - **Proposal decisions:** `AuditEvent` rows with actions `proposal_approved` / `proposal_rejected` give "You approved: {label}" or "You rejected: {label}". The label map is `set_budget` → "a {category} budget" and `update_category` → "a category change"; anything else becomes "a suggestion".
  - The newest 6 are returned. Events from the agent, and from superseded rejections, are excluded.
- **The draft-budget review UI is a dialog on Home.** It lists the pending `set_budget` proposals using the existing `components/ask/proposal-card.tsx`, plus an "Approve all" button. A Budget page comes in Phase 5.

## Wire formats (produced by Tasks 2–4, consumed by Task 5)

```jsonc
// GET /api/home/summary
{ "success": true,
  "found": [ { "kind": "duplicate|review|spike|price_rise", "tag": "DUPLICATES|RECEIPTS|SPENDING|SUBSCRIPTIONS",
               "headline": "Possible double charge: Croma {0}", "detail": "Charged on 14 and 15 Oct.",
               "amounts": [2499], "worth": 2499 | null, "href": "/receipts?tab=review" | null } ],
  "more": 0,
  "worth_total": 2499,           // sum of non-null worth, 0 if none
  "activity": [ { "kind": "statement_import|receipt|decision", "text": "Read a receipt: Croma {0}",
                  "amounts": [2499], "at": "2026-10-21T06:00:00Z" } ] }

// GET /api/budget
{ "success": true, "month": "2026-10", "monthly_budget": 28000 | null, "spent": 18412,
  "categories": [ { "category": "Food", "limit": 8000, "spent": 7480 } ] }   // sorted by spent/limit desc

// PUT /api/budget   body: { "monthly_budget"?: number|null, "categories"?: [{ "category": str, "limit": number|null }] }
//   limit null deletes that category's row; returns the GET shape

// POST /api/budget/draft   -> { "success": true, "proposals": [ <_proposal_dict>, ... ] }   // may be []
// GET  /api/review?status=flagged&count=1 -> { "success": true, "count": 3 }
```

## Review Focus

1. **A user with no transactions, or only one month of history:** `draft` returns `[]` (it doesn't divide by zero, and doesn't propose ₹0 limits), the summary returns `found: []`, and the budget `spent` is 0. Tests: `test_draft_needs_history`, `test_summary_empty_user`.
2. **Another user's data never leaks:**
  - Summary, budget and draft only read the caller's rows.
  - Approving someone else's `set_budget` proposal gives 404, which already holds in `_decide`.
  - Tests: `test_summary_is_per_user`, `test_budget_is_per_user`.
3. **Double approval and races:** approving the same `set_budget` twice gives 409 and leaves one budget row. A unique `(user_id, category)` constraint plus an upsert keeps it to one row. Test: `test_set_budget_approve_twice`.
4. **Category spelling:** "food", "Food " and "FOOD" are the same category for spikes, drafts and budget `spent`. Normalise with strip and case-fold for matching, and display the most common spelling. Test: `test_categories_normalise`.
5. **Refunds and negative amounts:** they don't create "spikes", and a refund-heavy previous month doesn't invert the comparison. This also closes the backlog item: `sameDayDelta` guards `then <= 0`. Tests: `test_spike_ignores_refund_month` and Task 5 unit test `sameDayDelta guards a non-positive previous total`.

## File map

| File | Responsibility |
|---|---|
| `backend/models/__init__.py` | `class Budget` (table `budgets`: `id` str36 pk, `user_id` str36 indexed, `category` str, `monthly_limit` float, `updated_at` datetime; `UniqueConstraint(user_id, category)`) |
| `backend/ai/budget.py` (new) | `draft_budget(txns: list[dict], today: date) -> list[dict]` (category, limit, basis) and `month_spend_by_category(txns, today) -> dict[str, float]` |
| `backend/ai/home_signals.py` (new) | `find_signals(txns, today, review_count, recurring) -> list[dict]` and `activity(txns, audit_events, now) -> list[dict]` |
| `backend/api/budget.py` (new) | `GET/PUT /api/budget`, `POST /api/budget/draft` |
| `backend/api/home.py` (new) | `GET /api/home/summary` |
| `backend/api/review.py` | `count` query param on the list |
| `backend/api/agent.py` (`_decide`) | `set_budget` apply branch |
| `backend/agent/tools.py` | `set_budget` in `ProposeActionArgs.type`, plus a `draft_budget` tool that creates the same proposals |
| `backend/asgi.py` | Register the `home` and `budget` routers |
| `backend/tests/test_budget.py`, `test_home_signals.py`, `test_api_home.py`, `test_api_budget.py` (new) | Tests |
| `frontend/src/lib/api/client.ts` | `homeApi.summary()`, `budgetApi.get/put/draft()`, `reviewApi.count()` |
| `frontend/src/app/(app)/home/*` | Wire the summary and budget into the cards; add a draft-budget dialog |
| `frontend/src/components/app-sidebar.tsx` | Badge uses `reviewApi.count()` |
| `frontend/e2e/fixtures.ts`, `e2e/home.spec.ts`, `e2e/home-math.spec.ts` | Stubs and tests |

---

### Task 1: `Budget` model + `draft_budget` (pure)

**Files:** `models/__init__.py`, `ai/budget.py` (new), `tests/test_budget.py` (new)

**Interfaces (produced):**
- `Budget` model, as described in the file map.
- `month_spend_by_category(txns: list[dict], year: int, month: int) -> dict[str, float]`.
  - Keys are the display spelling (the most common original spelling).
  - Matching uses `category.strip().casefold()`. `None` becomes "Uncategorised".
  - Negative amounts are included in totals, so refunds net out.
- `draft_budget(txns: list[dict], today: date) -> list[dict]` returns `[{"category", "limit", "basis": {"months": [..3 "YYYY-MM"], "average": float}}]`, sorted by `limit` descending, max 8.
  - It uses the 3 complete months before `today`'s month.
  - It returns `[]` if fewer than 2 of those months have any spend.

- [ ] **Step 1: Write the failing tests:**
  - `test_draft_rounds_up_to_500`: Food averages 7,120 over Jul, Aug and Sep, so limit = 7,500.
  - `test_draft_small_values_round_to_10`: an average of 404 gives a limit of 410.
  - `test_draft_skips_under_300`.
  - `test_draft_caps_at_8_largest_first`.
  - `test_draft_needs_history`: only last month has data, so `[]`.
  - `test_draft_ignores_current_month`.
  - `test_categories_normalise`: "food", "Food " and "FOOD" form one bucket, displayed as the most common spelling.
  - `test_budget_unique_per_category`: inserting two `Budget` rows with the same user and category raises `IntegrityError` (SQLite engine, `create_all`).
- [ ] **Step 2: Run** `pytest tests/test_budget.py -q`. The expected result is FAIL with an import error.
- [ ] **Step 3: Implement** according to the Interfaces above.
- [ ] **Step 4: Run** the tests again. All should pass.
- [ ] **Step 5: Commit** with `feat: budgets table and deterministic draft budget`.

### Task 2: Budget API + `set_budget` proposals (approve applies) + agent tool

**Files:** `api/budget.py` (new), `api/agent.py` (`_decide`), `agent/tools.py`, `asgi.py`, `tests/test_api_budget.py` (new)

**Interfaces:**
- `router = APIRouter(prefix="/api/budget")`, with `get_engine` as a dependency (mirror `api/profile.py`).
  - **`GET ""`** returns the wire shape above. `spent` is the total for the current calendar month, from `month_spend_by_category`. `categories` lists the user's `Budget` rows with this month's spend.
  - **`PUT ""`** validates `monthly_budget >= 0` or `null` and each `limit > 0` or `null`. It sets `User.monthly_budget`, upserts or deletes `Budget` rows, and returns the GET shape. Invalid input gives a 422.
  - **`POST "/draft"`** runs `draft_budget` over the user's transactions, rejects that user's pending `set_budget` proposals (audit `{"superseded": true}`), and creates one `Proposal(type="set_budget", target=<category>, payload={"limit": n, "basis": {...}}, risk="low", reason="About ₹{avg} a month over {Jul–Sep}; rounded up.", evidence=[])` per line. It returns them through `_proposal_dict`. Rate limit: `"10 per minute"`.
- **`_decide` approve branch for `set_budget`:** inside the same session, upsert `Budget(user_id, category=p.target)` with `monthly_limit=payload["limit"]` and return `applied={"category", "limit"}`.
- **`agent/tools.py`:**
  - Add `"set_budget"` to `ProposeActionArgs.type`.
  - Add a tool `draft_budget(NoArgs)`, described as "Draft a monthly budget from the last 3 months; creates set_budget proposals the user approves". It calls the same helper as `POST /draft`. Factor that helper out as `api.budget.create_draft(engine, user_id, today) -> list[Proposal dict]`.
  - Register the tool wherever the other tools are listed.

- [ ] **Step 1: Write the failing tests** in `test_api_budget.py` (fixture like `test_api_profile.py::client`, including the `agent` router and `get_agent_deps` override):
  - **`test_get_budget_empty`:** `monthly_budget` is null, `spent` is 0 and `categories` is `[]`.
  - **`test_put_then_get`:** set the budget to 28000 with Food at 8000, then GET shows Food's spent for this month.
  - **`test_put_null_deletes_category`.**
  - **`test_put_rejects_negative`:** returns 422.
  - **`test_draft_creates_pending_set_budget_proposals`:** seed 3 months of rows, POST, and get N proposals of type `set_budget` with status pending.
  - **`test_redraft_supersedes_pending`:** a second POST leaves only the new proposals pending, and the old ones are rejected.
  - **`test_approve_set_budget_upserts_row`:** after approval, GET `/api/budget` shows the category limit.
  - **`test_set_budget_approve_twice`:** the second approve gives 409 and there is exactly one `budgets` row.
  - **`test_budget_is_per_user`:** user B's GET doesn't see user A's rows, and B approving A's proposal gives 404.
  - **`test_agent_tool_draft_budget`:** calling the tool function with a `ToolContext` creates the same pending proposals.
- [ ] **Step 2: Run them.** The expected result is FAIL with 404s or import errors.
- [ ] **Step 3: Implement** according to the Interfaces above.
- [ ] **Step 4: Run** `pytest -q`. The whole backend suite should pass, with the CI env vars `OPENROUTER_API_KEY=test-key SECRET_KEY=test-secret-key-for-ci-only SUPABASE_URL=https://example.supabase.co`.
- [ ] **Step 5: Commit** with `feat: budget API and set_budget proposals (draft, approve, agent tool)`.

### Task 3: Home signals + activity (pure) and `GET /api/home/summary`

**Files:** `ai/home_signals.py` (new), `api/home.py` (new), `asgi.py`, `tests/test_home_signals.py` and `tests/test_api_home.py` (new)

**Interfaces:**
- `find_signals(txns: list[dict], today: date, review_count: int, recurring: list[dict]) -> list[dict]` returns ordered items in the wire format. Each kind's headline:
  - **duplicate:** `"Possible double charge: {vendor} {0}"`, detail `"Charged on {d1} and {d2}."`, `amounts=[amount]`, `worth=amount`, `href=None`.
  - **review:** `"{n} receipt(s) need a glance"`, detail `"Lumen wasn't sure about these. Nothing is saved until you approve."`, `href="/receipts?tab=review"`.
  - **spike:** `"{Category} is up {pct}%"`, detail `"{0} so far vs {1} by this point last month."`, `amounts=[now, then]`, `href="/spending"`.
  - **price_rise:** `"{vendor} went up {pct}%"`, detail `"{0} → {1} a {cadence}."`, `href="/bills"`.
- `activity(txns: list[dict], events: list[dict], now: datetime) -> list[dict]`, according to the Decisions above. `events` are dicts with `action`, `created_at` and `type`/`target` of the proposal.
- `GET /api/home/summary` loads the caller's transactions, flagged review count, recurring list (`find_recurring(txns, today)`), and the last 50 `AuditEvent`s joined to `Proposal` for type and target. It returns `{"success": True, "found": items[:3], "more": max(0, len(items)-3), "worth_total": …, "activity": …}`. Rate limit: default.

- [ ] **Step 1: Write the failing tests:**
  - **`test_home_signals.py`:**
    - `test_duplicate_same_vendor_amount_within_a_day`
    - `test_no_duplicate_two_days_apart`
    - `test_spike_needs_30pct_and_floor`: +35% on ₹600 isn't a spike, +35% on ₹5,000 is.
    - `test_spike_ignores_refund_month`
    - `test_price_rise_from_recurring`
    - `test_order_and_review_item`
    - `test_activity_groups_statement_rows`: 42 rows in one minute give one "Imported a statement · 42 rows".
    - `test_activity_labels_decisions_and_skips_superseded`
    - `test_activity_times_are_utc_z`
  - **`test_api_home.py`:**
    - `test_summary_empty_user`: returns `found []`, `worth_total 0` and `activity []`.
    - `test_summary_reports_duplicate_and_worth`.
    - `test_summary_is_per_user`.
    - `test_summary_requires_auth`: 401.
- [ ] **Step 2: Run them.** The expected result is FAIL.
- [ ] **Step 3: Implement** according to the Interfaces above. Normalise vendors with `ai.recurring`'s `_norm` (import it; don't copy it).
- [ ] **Step 4: Run** `pytest -q`. The whole suite should pass.
- [ ] **Step 5: Commit** with `feat: Home summary endpoint (Lumen found signals and activity feed)`.

### Task 4: Review count

**Files:** `api/review.py`, `tests/test_api_review.py`

- [ ] **Step 1:** Write `test_list_count_only`: with 3 flagged items, `GET /api/review?status=flagged&count=1` returns `{"success": true, "count": 3}` and has no `items` key.
- [ ] **Step 2:** Run it. The expected result is FAIL, because `items` comes back.
- [ ] **Step 3:** Add a `count: bool = False` param. When it's true, run `select(func.count())` with the same filters.
- [ ] **Step 4:** Run `pytest tests/test_api_review.py -q`. It should pass.
- [ ] **Step 5:** Commit with `feat: count-only review queue query for the sidebar badge`.

### Task 5: Frontend wiring

**Files:**
- `lib/api/client.ts`, `app-sidebar.tsx`, `lib/home-math.ts` (backlog fix)
- `home/use-home-data.ts`, `home/homeContent.tsx`, `home/_components/{lumen-found,budget-card,activity-card,calendar-card}.tsx`
- A new `home/_components/draft-budget-dialog.tsx`
- `e2e/fixtures.ts`, `e2e/home.spec.ts`, `e2e/home-math.spec.ts`

**Interfaces:**
- **`client.ts`:**
  - `homeApi.summary(): Promise<HomeSummary>`, using `cached`, with key `/api/home/summary`.
  - `budgetApi.get()`, `budgetApi.put(body)` and `budgetApi.draft()`. Non-GET calls already clear `cached`.
  - `reviewApi.count(): Promise<number>`.
  - Export the types `HomeSummary`, `FoundItem`, `ActivityItem` and `BudgetState`, matching the wire formats above.
- **`fill(text: string, amounts: number[], money: (n: number) => string): string`** in `lib/home-math.ts` replaces `{i}` with `money(amounts[i])`. Unit-test it.
- **`useHomeData`:** the second effect ("once") also loads `homeApi.summary()` and `budgetApi.get()` through `allSettled`. `HomeData` gains `summary: HomeSummary | null` and `budget: BudgetState | null`, and loses the transaction-derived activity. `toReview` comes from `summary.found` (the review item) or 0. The separate review list call is removed.
- **`LumenFound`:**
  - The header reads "Lumen found", then "{n} things worth a look". When `worth_total > 0`, it adds " · {money(worth_total)} you may get back".
  - It shows up to 3 tiles (tag, serif headline from `fill`, detail from `fill`, and a link "SEE →" when there's an `href`).
  - It keeps the empty copy.
- **Brief:** when `summary.found[0]` exists, append `" The one thing worth a look: " + fill(headline).replace(/\.$/, "") + "."`.
- **`BudgetCard`:**
  - With `monthly_budget`: "₹spent of ₹budget", a progress bar (`bg-good`, or `bg-bad` when over), and "₹left · N days · ~₹/day". N days is days left in the month including today. When over budget, it says "₹X over" instead.
  - It then lists up to 3 category rows, "Food ₹7,480 / ₹8,000".
  - Without `monthly_budget` but with categories: it shows the category rows only.
  - With neither: the Phase 2 empty state.
- **`DraftBudgetPromo`:**
  - The button reads "DRAFT BUDGET" and is enabled. On click, it calls `budgetApi.draft()` and opens `DraftBudgetDialog`.
  - The dialog lists the returned proposals with the existing `ProposalCard`, using its approve and reject handlers through `agentApi.decide`; check that function's name in `client.ts`. It has an "Approve all" button.
  - On close, refetch `budgetApi.get()`.
  - If there are no proposals, the dialog says "Not enough history yet. Lumen needs about two months of spending to draft a budget."
  - The promo hides when the user already has category budgets.
- **`ActivityCard`:** renders `summary.activity`, each item as `fill(text)` plus `relativeTime(at)`. It keeps the empty copy.
- **`CalendarCard`:** `kShort` uses the user's currency symbol. Derive it once from `money(0)` by stripping digits and separators, and keep the `k` suffix. This is a backlog item.
- **`sameDayDelta`:** guard `then <= 0`. This is a backlog item.
- **Sidebar badge:** `reviewApi.count()`.
- **Fixture:** `signIn(page, { home: { summary?, budget?, draft? } })` stubs `/api/home/summary`, `/api/budget` (GET/PUT), `/api/budget/draft`, and `/api/review?count=1` (from `reviewCount`). The existing proposal approve stub returns `{ success: true, proposal: {...status:"approved"}, applied: {...} }`.

- [ ] **Step 1: Write the failing tests:**
  - **`home-math`:**
    - `fill replaces placeholders with money`
    - `sameDayDelta guards a non-positive previous total`: `[5]` vs `[-10]` gives null.
  - **`home`:**
    - **`lumen found shows server signals and worth`:** a summary with a duplicate (worth 2499) and a spike gives the header "2 things worth a look · ₹2,499 you may get back" and two tiles.
    - **`brief adds the one thing worth a look`.**
    - **`budget card shows progress against the monthly budget`:** budget 28000 and spent 18412 give "₹18,412 of ₹28,000" and "₹9,588 left".
    - **`budget card says when over`.**
    - **`draft budget opens proposals and approve all applies them`:**
      1. The draft stub returns 2 `set_budget` proposals.
      2. Click DRAFT BUDGET. The dialog shows 2 cards.
      3. Click Approve all. Both approve endpoints are called.
      4. Close the dialog. The budget is refetched.
    - **`draft with no history explains why`.**
    - **`activity comes from the summary`:** "Imported a statement · 42 rows" and "2h ago".
    - **`calendar uses the user's currency`:** with a profile currency of USD, the cell shows "$2.2k".
    - **`sidebar badge uses the count endpoint`:** the request to `/api/review` has `count=1`.
- [ ] **Step 2: Run** `npm run test:e2e`. The expected result is that the new tests FAIL.
- [ ] **Step 3: Implement** according to the Interfaces above. Remove the Phase 2 interim code paths that the summary replaces: transaction-derived activity, and the review list call on Home.
- [ ] **Step 4: Run** `npm run test:e2e`, `tsc`, `lint` and `build`. All should pass, and `/home` should stay static.
- [ ] **Step 5: Commit** with `feat: Home wired to summary and budget APIs; draft-budget dialog; badge via count`.

### Task 6: Docs, review, ship

- [ ] **Step 1:** Update the docs:
  - `docs/CODEBASE-GUIDE.md`: the Home section (the interim notes become real sources), new API endpoints, the `budgets` table, `set_budget` proposals and the agent tool.
  - Spec §12: tick the Phase 3 items. That covers the interim Home parts, `kShort`, `sameDayDelta`, the review count endpoint, and confirming that statement import writes before returning. It does: `api/statements.py` commits inside the request.
  - `docs/direction/STORY.md`: one entry.
- [ ] **Step 2:** Run the whole-branch review on the most capable model, with this plan's Review Focus. Fix Critical and Important findings with RED→GREEN tests. Ledger the minors into spec §12.
- [ ] **Step 3:** Run the backend `pytest -q` and the frontend `npm run test:e2e`, `tsc`, `lint` and `build`. All should be green. Push `ui-revamp/phase3-home-backend` and open the PR.
