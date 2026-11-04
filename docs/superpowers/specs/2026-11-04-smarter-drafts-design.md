# Smarter budget drafts and "Lumen found": design

Date: 2026-11-04. Backlog item: `2026-10-20-ui-revamp-design.md` §12, "Make 'Lumen found' and the budget draft smarter".
"Owner" marks the owner's decisions; "My call" marks the builder's, open to correction.

## 1. Why

A budget draft is a plain 3-month mean, so one laptop inflates next month's limit by a third of its price. "Lumen found"
says "Shopping is up 200%" when what happened is one big purchase. Both come from the same missing idea: telling a
one-off purchase apart from usual spending. Lumen is an AI-engineering showcase, so the change must be measured, with
before and after numbers, and the numbers must be stated honestly.

## 2. Measured starting point

Replay of the last 6 complete months on the eval users (u1, u2, one demo account; 132 draft lines), scratch prototype.
These accounts are synthetic or built on synthetic data; treat the numbers as indicative.

| Rule | Real month fits the limit | Usual part of the month fits | Unused room when it fits | Typical miss |
|---|---|---|---|---|
| Mean of 3 months (today) | 64% | 72% | 19% | 24% |
| Median of 3 months | 58% | not measured | not measured | 19-27% by user |
| 75th percentile of 6 months | 73% | 80% | 19% | 24% |
| 75th percentile of 6 months, one-offs left out | 65% | 73% | 17% | 20% |

"Usual part" leaves out the target month's own one-offs. The median-of-3 row comes from an earlier run scored per user.

What this says:
- A median alone doesn't help: categories like Shopping are lumpy in both directions.
- Leaving out one-offs barely moves the fit rate. **Its value is not a better fit on these accounts.** The value is that
  one big purchase stops inflating a limit, the typical miss shrinks a little, and the draft can say what it left out.
- Plain "75th percentile of 6 months" fits more often only because its limits are higher (₹7,720 against ₹6,864 on
  average) and it keeps big purchases in the limit, which is what the owner decided against (§4).
- "Lumen found": of 14 spike alerts raised in the replay, in 10 a single purchase was at least half of that category's
  spend so far.

## 3. Goals, non-goals, anti-goals

**Goals**
- A draft limit fits an ordinary month about 3 times in 4 (owner), without one-off purchases raising it (owner).
- Each draft line says in plain words what it's based on and names what it left out (owner).
- A "Lumen found" spike caused by one purchase names that purchase (owner).
- An offline eval suite with CI gates and honest before/after numbers in STORY.

**Non-goals**
- No LLM anywhere in the rules or the reason text (owner). Ask Lumen can still explain a draft.
- No "planned purchases" budget line (owner).
- No seasonality or income-based limits. The data can't validate seasonality (about a year of history), and income
  says nothing about what's usual in a category.
- No change to the forecast. It uses its own everyday-spending method and is scored separately.
- No new UI: the reason is existing text on the draft line and the Found card.

**Anti-goals**
- Limits that look smart but fail often. A rule more than 2 points below today's fit on usual months doesn't ship. Within
  2 points counts as level (one draft line is about 0.8 of a point here): it ships only if `laptop_shift` passes, and STORY
  states the drop. Below that, stop and ask the owner. (My call.)
- Hiding a real rise behind "one-off": rent, bills and regular habits must never be left out.
- Claiming an improvement the eval doesn't show. If the fit rate is flat, STORY says it's flat.

## 4. The rules

Pure functions over transaction dicts, in `ai/budget.py` and `ai/home_signals.py`; no DB, no LLM.

### 4.1 What counts as a one-off

`one_offs(txns_in_category, recurring_vendors)`: a purchase is a one-off when all of these hold:
- it's at least `ONE_OFF_MULTIPLE` (starting value 3) times the category's median purchase over the lookback;
- it's at least `ONE_OFF_FLOOR` (starting value ₹2,000) in the amount's own units, so small categories don't trigger it;
- the category has at least `ONE_OFF_MIN_PURCHASES` (starting value 4) purchases in the lookback, because a median of
  two or three purchases says nothing;
- its vendor isn't a recurring charge, by the same normalised vendor match `ai/recurring.py` uses;
- the same vendor has no other charge within 25% of this amount in a different month of the lookback. This protects what
  recurring detection can't see yet: rent to a new landlord, a 6-monthly premium, a big monthly shop on irregular dates.
  (My call.) A large purchase at a shop you also use for small things can still be a one-off.

Refunds (negative amounts) are never one-offs and aren't part of the median. A refund from a left-out one-off's vendor, in
the same or a later month, up to that one-off's amount, is left out with it, so a returned laptop doesn't drag a usual
month down. Other refunds net into their month's total. A month's usual total is floored at 0. (My call.)
The starting values come from the prototype. The eval (§5) may move them once; the change and its reason go in STORY.

### 4.2 The draft

`draft_budget(txns, today, recurring=None)`, keeping the existing line shape and adding to `basis`:
- Lookback: the up to 6 complete months before today's month. Months before the account's first transaction don't count;
  a month inside that span with no spend in a category counts as 0.
- Fewer than 2 months with any spend: empty, as today.
- A category's limit is the `DRAFT_PERCENTILE` (starting value 75) of its monthly totals with one-offs left out, rounded
  up with the existing `_round_up`.
- `MIN_MONTHLY` and `MAX_LINES` stay. `MIN_MONTHLY` is applied to the same usual monthly level as the limit.
- `basis` becomes `{months, average, usual, one_offs: [{vendor, amount, date}]}`. `average` stays the plain mean over
  `months`, so proposals already saved keep reading correctly.

### 4.3 The reason line

`api/budget.py` builds it as today, from numbers in `basis` only:
- `"Usually up to ₹7,500 a month over May–Oct, rounded up."`
- With one one-off: add `"Left out the ₹34,746 TechHub order."`
- With several: add `"Left out 3 big one-off purchases (₹61,200)."`

Budget's draft panel already shows the reason, so no frontend change is needed. Saved pending proposals keep their old
reason text until redrafted. Ask Lumen's `draft_budget` tool description changes from "last 3 complete months" to match.
Agent eval recordings that cover it are re-recorded by the owner, as with the forecast.

### 4.4 "Lumen found"

`find_signals` passes its recurring list to `_spikes`. A spike names the category's biggest purchase this month when all
of these hold (my call; this will name fewer alerts than the 10 of 14 in §2):
- the purchase is between half and all of the rise, Spending's brief's existing rule;
- the next biggest purchase this month is less than half of it, so two similar purchases name nothing;
- its vendor isn't recurring, so a bill's rise is never told as a purchase.

It doesn't have to pass `one_offs()`: naming a cause is safe where leaving spending out of a limit isn't.
- Headline: `"{0} at TechHub pushed Shopping up 200%"`, amount in `amounts` as usual.
- The detail line, link, ordering and `tag` stay. Alerts with no single cause read as they do today.
- Spikes are still shown: an unexpected big charge is worth seeing (owner).

## 5. Evaluation

New offline suite `evals/suites/drafts.py`, no LLM, on the same three users as the forecast suite. Scored per draft line
over the last 6 complete months, each draft built only from what was known before that month. Today's rule is kept in the
suite as the baseline, so before and after come from one run.

**Measures**
- `fit_usual`: the target month's spend without its own one-offs is within the limit. The target's one-offs are judged by
  §4.1 over the lookback plus the target month, with recurring detected as of the end of the target month, and the same
  judgement applies to both rules.
- `fit_all`: the whole month's spend is within the limit. Reported, not gated (a one-off in the target month is meant to
  break the limit).
- `unused_room`: median of (limit − spend) ÷ limit in months that fit. Stops "just raise every limit" from passing.
- `laptop_shift`: add one ₹80,000 purchase (seeded) to one of the last 3 lookback months of a category with at least 4
  purchases, and measure how far that category's limit moves. Today's rule moves about ₹26,667. This is the headline
  before/after and the gated figure. The same measure on lookback months 4-6, which only the new rule reads, is reported
  alongside.
- `reason_truth`: every amount in a reason equals an amount in that line's `basis`.
- `never_left_out`: measured against ground truth, not the list the draft was given. Truth is the demo's seeded bills plus
  vendors recurring across the full history. None may be a one-off once it has at least 2 earlier charges at draft time.

Baseline and new rule are compared on the draft lines both produce, since `MIN_MONTHLY` and `MAX_LINES` can pick different
categories. Each rule's own full set is reported too. (My call.)

**Found cases** (a small labelled set built in the suite from the eval users' data, with purchases injected):
- one big purchase causes the rise → the alert names that purchase;
- a broad rise across many purchases → the alert names nothing;
- a rise caused by several similar purchases → the alert names nothing;
- a recurring bill's price rise → names nothing.

Refunded one-offs get a unit test, because the eval data has no refunds.

**Gates** (`evals/gates.yaml`, `drafts:`), starting values, set against the first real run and recorded in STORY:
- `fit_usual` ≥ 70% and not below the baseline's by more than 2 points, on the shared lines;
- `unused_room` ≤ 25%;
- `laptop_shift` median ≤ ₹1,000;
- `reason_truth` and `never_left_out` 100%;
- Found cases 100%.

A goal of "about 3 in 4" isn't a gate at 75% because the prototype reached 73%. If the real run stays below 75%, STORY
says so; the owner decides whether to tighten the rule or accept it. Same treatment as the forecast's 10% target.

## 6. Delivery

One PR into `refactor`, not stacked: rules, eval, gates, reason text, tool description, tests first, STORY entry,
codebase guide, §12 updated, whole-branch review. Then a release when the owner says, then a live check on the demo. No
schema or env changes (`basis` is JSON inside the proposal payload).

## 7. Left to the builder

File layout inside the suite; how to pass recurring vendors into `draft_budget` (`api/budget.py` already can reach
`api/bills._recurring`, which has saved states); the exact seed for `laptop_shift`; wording of the reason within §4.3's pattern.
