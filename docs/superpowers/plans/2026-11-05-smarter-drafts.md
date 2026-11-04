# Smarter Drafts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Budget drafts that one big purchase can't inflate and that say what they left out, and "Lumen found" spikes that name the purchase behind them.

**Architecture:** Pure rules in `backend/ai/budget.py` and `backend/ai/home_signals.py`; `api/budget.py` passes in the user's recurring charges and stores the reason. An offline eval suite scores new against old on the same run and gates it in CI.

**Tech Stack:** Python 3.11, numpy (already used, imported inside the function as in `ai/forecast.py`), pytest. No frontend code: the panel and the Found card already render `reason` and `fill(headline, amounts)`.

**Spec:** `docs/superpowers/specs/2026-11-04-smarter-drafts-design.md`

## Global Constraints
- `ONE_OFF_MULTIPLE = 3`, `ONE_OFF_FLOOR = 2000`, `ONE_OFF_MIN_PURCHASES = 4`, `SIMILAR_WITHIN = 0.25`, `DRAFT_PERCENTILE = 75`, `DRAFT_MONTHS = 6`. The eval may move them once; record it in STORY.
- No LLM. Every amount in a reason comes from `basis`.
- `basis.average` stays the plain mean over `basis.months`.
- Ship rule: `fit_usual` within 2 points of the baseline on shared lines, and `laptop_shift` passes. Worse than that: stop and ask the owner.
- One PR into `refactor`, never stacked; no Claude attribution.

## Review Focus
1. A returned laptop (₹80,000 then −₹80,000 a month later) → usual months unaffected; neither a negative nor a lowered limit. (Task 1 test.)
2. Rent from a new landlord, seen twice, far above other Housing charges → stays in the limit. (Task 1 test.)
3. A big purchase at a shop also used for small things → still a one-off. (Task 1 test.)
4. Blank or missing vendor on a transaction → no crash, never matches another blank as "the same vendor". (Task 1 test; Task 3 test for spikes.)
5. A category whose only spend in the lookback was one-offs, or with fewer than 4 purchases → no crash; with too few purchases nothing is left out. (Task 1 test.)

---

### Task 1: one-offs and the new draft

**Files:** Modify `backend/ai/budget.py`; test `backend/tests/test_budget.py`.

**Produces:**
- `one_offs(rows: list[dict], recurring: set[str] = frozenset()) -> list[dict]`: rows of one category over a lookback; `recurring` holds `_norm`ed vendors.
- `usual_month_totals(rows, keys, recurring) -> tuple[dict[str, float], list[dict]]`: per month key the total with one-offs and their refunds left out, floored at 0; and the one-offs.
- `draft_budget(txns, today, recurring: list[dict] | None = None)`: `recurring` is the items list with `vendor`.
- `basis = {months, average, usual, one_offs: [{vendor, amount, date}]}`.
- `_key`, `_month`, `_round_up` stay; `MIN_MONTHLY`, `MAX_LINES` stay.

- [ ] **Step 1: Write failing tests** in `test_budget.py`:
  - `test_a_big_purchase_is_a_one_off`: Shopping purchases of 1000 ×5 and 34746 → `one_offs` returns the 34746 row.
  - `test_too_few_purchases_leave_nothing_out`: 1000, 1000, 34746 → `[]`.
  - `test_under_the_floor_isnt_a_one_off`: 100 ×5 and 1500 → `[]`.
  - `test_a_recurring_vendor_is_never_a_one_off`: as the first, with the big row's vendor in `recurring`.
  - `test_a_similar_charge_in_another_month_protects_it`: rent 22000 at "New Landlord" in two months plus small Housing charges → `[]`; a 22000 and a 40000 from one vendor (beyond 25%) → the big one can be a one-off.
  - `test_a_big_buy_at_a_shop_used_for_small_things_is_a_one_off`: same vendor, 500 ×5 and 30000.
  - `test_blank_vendors_dont_count_as_the_same_vendor`: two big rows with vendor None, in two months, among small ones → both are one-offs; no crash.
  - `test_a_refunded_one_off_leaves_usual_months_alone`: 5000-ish months, an 80000 in Aug at TechHub, −80000 in Sep at TechHub → `usual_month_totals` values equal the months without it, and no value is negative.
  - `test_another_refund_still_nets_in`: −500 from an unrelated vendor lowers its month by 500.
  - `test_draft_limit_ignores_a_laptop`: six months of ~5000 from several purchases, one month adds 80000 → limit equals the limit without it, and `basis.one_offs == [{vendor, amount: 80000, date}]`.
  - `test_draft_uses_75th_percentile_of_six_months`: monthly totals 1000…6000 → `usual == 4750`, limit 5000, `len(basis.months) == 6`.
  - `test_months_with_no_spend_at_all_dont_count`: as the existing two-month test.
  - `test_a_month_without_this_category_counts_as_zero`: another category spent that month, this one didn't → it's in the percentile.
  - Update `test_draft_rounds_up_to_500` to the new `basis` (`usual: 7180.0`, `one_offs: []`).

- [ ] **Step 2: Run** `python -m pytest tests/test_budget.py -q`. Expected: the new tests FAIL (`one_offs` missing).

- [ ] **Step 3: Implement** in `ai/budget.py`. Import `_norm` from `ai.recurring`. `months` = the up to 6 complete months before today's with any spend at all (a month with no spend anywhere is a data gap, not a ₹0 month); fewer than 2 → `[]`. Per category: `usual_month_totals`, level = `np.percentile(totals, 75)` over `months`, `average` = plain mean over `months`. `MIN_MONTHLY` applies to the level. Refund pairing: walk refunds by date; a refund from a one-off's vendor on or after its date is left out up to what remains of that one-off's amount; the rest nets in. Remove the module's old ponytail note about the 3-month mean.

- [ ] **Step 4: Run** the same command. Expected: PASS.

- [ ] **Step 5: Commit** `feat: budget drafts leave out one-off purchases and aim to fit usual months`.

### Task 2: reason and callers

**Files:** Modify `backend/ai/budget.py`, `backend/api/budget.py`, `backend/agent/tools.py`; test `backend/tests/test_api_budget.py`.

**Produces:** `draft_reason(line: dict, currency: str | None) -> str` in `ai/budget.py`, using `utils.money.fmt`.

- [ ] **Step 1: Write failing tests:**
  - `test_budget.py::test_reason_says_what_its_based_on`: `"Usually up to ₹7,180 a month over May–Oct, rounded up."` shape; no "Left out".
  - `test_reason_names_one_one_off`: ends `"Left out the ₹34,746 TechHub order."`
  - `test_reason_counts_several_one_offs`: ends `"Left out 3 big one-off purchases (₹61,200)."`
  - `test_api_budget.py::test_draft_treats_a_saved_recurring_vendor_as_usual`: a detected monthly bill with one very large charge isn't left out through `create_draft`.
  - `test_api_budget.py::test_draft_reason_is_stored_on_the_proposal`.
- [ ] **Step 2: Run** `python -m pytest tests/test_budget.py tests/test_api_budget.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** `create_draft` reads `api.bills._recurring(engine, user_id, today)["items"]` and passes it; stores `draft_reason`. Agent tool: description and docstring say "up to the last 6 complete months, leaving out one-off purchases"; the "not enough history" note says "at least 2 of the last 6 complete months". Move `_MONTH` formatting into `draft_reason`.
- [ ] **Step 4: Run** the same plus `tests/test_agent_tools.py`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: draft reasons say what they're based on and what they left out`.

### Task 3: "Lumen found" names the purchase

**Files:** Modify `backend/ai/home_signals.py`; test `backend/tests/test_home_signals.py`.

**Produces:** `_spikes(txns, today, recurring: list[dict] | None = None)`; `find_signals` passes `recurring`. Named spike: `headline = "{2} at TechHub pushed Shopping up 200%"`, `amounts = [now, then, purchase]`. Detail, tag, subject, href unchanged.

- [ ] **Step 1: Write failing tests** in `test_home_signals.py`:
  - `test_a_spike_from_one_purchase_names_it`.
  - `test_a_broad_rise_names_nothing`: many small purchases; headline stays `"Food is up 35%"`.
  - `test_two_similar_purchases_name_nothing`: then 2000; now 3000 + 3000.
  - `test_a_purchase_bigger_than_the_rise_names_nothing`: then 5000; now one 7000.
  - `test_a_recurring_vendor_is_never_named`.
  - `test_a_blank_vendor_is_never_named`.
- [ ] **Step 2: Run** `python -m pytest tests/test_home_signals.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** per spec §4.4, using positive amounts only as `_spikes` already does.
- [ ] **Step 4: Run** the same plus `tests/test_api_home.py`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Lumen found names the purchase behind a spike`.

### Task 4: eval suite and gates

**Files:** Create `backend/evals/suites/drafts.py`, `backend/tests/test_eval_drafts.py`; modify `backend/evals/run.py`, `backend/evals/gates.yaml`.

**Consumes:** `evals.suites.forecast.users()` (first three), `ai.recurring.find_recurring`, Tasks 1 and 3.

**Produces:** `drafts.run(tier, split) -> {cases, metrics, hard_gate_failures}`, the forecast suite's shape. `metrics`: `lines`, `new`/`baseline` each with `fit_usual_pct`, `fit_all_pct`, `unused_room_pct`, `typical_miss_pct`, plus `shared` (both on shared lines), `laptop_shift` (`new_median`, `baseline_median`, `older_months_new_median`), `reason_mismatches`, `left_out_wrongly`, `found_failures`, `per_user`.

- [ ] **Step 1: Write failing test** `test_eval_drafts.py` (`pytestmark = pytest.mark.eval`): `hard_gate_failures == []`, `users == 3`, `lines >= 100`, `baseline.laptop` around 26,667 (between 20,000 and 30,000), `found_failures == []`. Plus `test_every_reason_uses_its_own_numbers`.
- [ ] **Step 2: Run** `python -m pytest tests/test_eval_drafts.py -m eval -q`. Expected: FAIL (no suite).
- [ ] **Step 3: Implement** per spec §5. The baseline is today's rule copied into the suite as `_baseline_draft` (mean of 3 months). Recurring at draft time is `find_recurring(past, month_start)`. Register as `"drafts"` in `run.py`. Laptop vendor is new and unique, seed 42, spread over the last 3 lookback months. Found cases are built from a real user's rows with purchases injected into a fixed month.
- [ ] **Step 4: Set `drafts:` gates** per spec §5 (`fit_usual_min: 70`, `fit_usual_vs_baseline: 2`, `unused_room_max: 25`, `laptop_shift_p90_max: 1000`). Run, read real numbers. If a one-time threshold change helps, make it and note it for STORY. If the ship rule fails, stop and ask the owner.
- [ ] **Step 5: Run** the suite and confirm the existing suites are untouched: `python -m pytest -m eval -q`. Expected: PASS.
- [ ] **Step 6: Commit** `feat: drafts eval suite with before/after numbers and CI gates`.

### Task 5: checks, docs, review, PR

- [ ] Full backend suite; `frontend/e2e/budget.spec.ts`'s reason fixture updated to the new wording, and the spec's stale "Averaged" text removed; budget and home e2e pass.
- [ ] STORY 42 with real numbers, including what didn't improve; CODEBASE-GUIDE; §12 item ticked with what's left.
- [ ] Whole-branch review (Opus), one fix pass, PR into `refactor`.
