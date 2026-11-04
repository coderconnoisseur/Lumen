"""Budgets (UI revamp Phase 3): per-category spend for a month, and a deterministic draft from recent months.

Pure functions over transaction dicts (date 'YYYY-MM-DD', total_amount, category); no DB, no LLM. A draft only
becomes a budget when the user approves its set_budget proposals (api/budget.py, api/agent.py). Drafts aim to fit usual
months and leave one-off big purchases out (spec 2026-11-04-smarter-drafts-design.md, scored by evals/suites/drafts.py).
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import date
from statistics import median

from ai.recurring import _norm

MIN_MONTHLY = 300  # categories usually under this aren't worth a line
MAX_LINES = 8
DRAFT_MONTHS = 6  # complete months a draft looks back over
DRAFT_PERCENTILE = 75  # a limit should fit about 3 usual months in 4
ONE_OFF_MULTIPLE = 3  # a one-off is at least this many times the category's median purchase
ONE_OFF_FLOOR = 2000  # ... and at least this much, so small categories don't trigger it
ONE_OFF_MIN_PURCHASES = 4  # a median of fewer purchases says nothing
SIMILAR_WITHIN = 0.25  # a charge this close to another month's from the same vendor is regular, not a one-off


def _key(category: str | None) -> str:
    return (category or "").strip().casefold() or "uncategorised"


def _month(d) -> tuple[int, int] | None:
    s = str(d or "")[:7]
    try:
        return int(s[:4]), int(s[5:7])
    except ValueError:
        return None


def _display_names(txns: list[dict]) -> dict[str, str]:
    """The most common spelling of each category (case/space-insensitive match)."""
    seen: dict[str, Counter] = defaultdict(Counter)
    for t in txns:
        name = (t.get("category") or "").strip() or "Uncategorised"
        seen[_key(t.get("category"))][name] += 1
    return {k: c.most_common(1)[0][0] for k, c in seen.items()}


def _totals(txns: list[dict], months: set[tuple[int, int]]) -> dict[tuple[str, tuple[int, int]], float]:
    out: dict[tuple[str, tuple[int, int]], float] = defaultdict(float)
    for t in txns:
        m = _month(t.get("date"))
        if m in months and t.get("total_amount") is not None:
            out[(_key(t.get("category")), m)] += float(t["total_amount"])
    return out


def month_spend_by_category(txns: list[dict], year: int, month: int) -> dict[str, float]:
    """Net spend per category in one calendar month (refunds net out), keyed by display name."""
    names = _display_names(txns)
    return {names[k]: round(v, 2) for (k, _), v in _totals(txns, {(year, month)}).items()}


def _round_up(avg: float) -> int:
    return math.ceil(avg / 500) * 500 if avg >= 500 else math.ceil(avg / 10) * 10


def _amount(row: dict) -> float:
    return float(row.get("total_amount") or 0)


def _vendor(row: dict) -> str:
    return _norm(row.get("vendor_name") or "")


def one_offs(rows: list[dict], recurring: set[str] | frozenset[str] = frozenset()) -> list[dict]:
    """The purchases in one category's rows that aren't usual spending: well above its median purchase, from a vendor
    that isn't recurring and hasn't charged a similar amount in another month (rent to a new landlord, a 6-monthly
    premium). Refunds are never one-offs and aren't part of the median."""
    buys = [r for r in rows if _amount(r) > 0]
    if len(buys) < ONE_OFF_MIN_PURCHASES:
        return []
    cut = max(ONE_OFF_MULTIPLE * median(_amount(r) for r in buys), ONE_OFF_FLOOR)

    def regular(r: dict) -> bool:
        v = _vendor(r)
        return bool(v) and (v in recurring or any(
            _vendor(o) == v and _month(o.get("date")) != _month(r.get("date"))
            and abs(_amount(o) - _amount(r)) <= SIMILAR_WITHIN * _amount(r) for o in buys))

    return [r for r in buys if _amount(r) >= cut and not regular(r)]


def usual_month_totals(rows: list[dict], keys: list[str], recurring: set[str] | frozenset[str] = frozenset()
                       ) -> tuple[dict[str, float], list[dict]]:
    """One category's spend per month ('YYYY-MM') with its one-offs left out, and the one-offs. A refund from a left-out
    purchase's vendor, on or after it, goes with it, so a returned laptop doesn't drag a usual month down. Never below 0."""
    left_out = one_offs(rows, recurring)
    remaining = [[r, _amount(r)] for r in left_out]
    totals = dict.fromkeys(keys, 0.0)
    for r in sorted(rows, key=lambda x: str(x.get("date") or "")):
        amount, key = _amount(r), str(r.get("date") or "")[:7]
        if any(r is o for o in left_out):
            continue
        for slot in remaining:
            if amount < 0 and _vendor(r) and _vendor(slot[0]) == _vendor(r) and str(slot[0].get("date")) <= str(r.get("date")):
                taken = min(-amount, slot[1])
                slot[1] -= taken
                amount += taken
        if key in totals:
            totals[key] += amount
    return {k: max(0.0, v) for k, v in totals.items()}, left_out


def draft_reason(line: dict, currency: str | None) -> str:
    """The sentence on a draft line, built only from its `basis`."""
    from utils.money import fmt

    basis = line["basis"]
    first, last = (date.fromisoformat(basis["months"][i] + "-01").strftime("%b") for i in (0, -1))
    reason = f"Usually up to {fmt(basis['usual'], currency)} a month over {first}–{last}, rounded up."
    left_out = basis.get("one_offs") or []
    if len(left_out) == 1:
        return f"{reason} Left out the {fmt(left_out[0]['amount'], currency)} {left_out[0]['vendor'] or 'one-off'} order."
    if left_out:
        return f"{reason} Left out {len(left_out)} big one-off purchases ({fmt(sum(o['amount'] for o in left_out), currency)})."
    return reason


def draft_budget(txns: list[dict], today: date, recurring: list[dict] | None = None) -> list[dict]:
    """One line per category: the 75th percentile of its usual monthly spend over up to 6 complete months before today's,
    rounded up, so it fits about 3 usual months in 4. Months with no spend at all are data gaps and don't count; a month
    without this category does, as 0. `recurring`: the user's recurring charges, never treated as one-offs.
    Empty when fewer than 2 of those months have any spend (not enough history to suggest limits)."""
    import numpy as np

    months = []
    y, m = today.year, today.month
    for _ in range(DRAFT_MONTHS):
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
        months.append((y, m))
    months.reverse()
    window = set(months)
    totals = _totals(txns, window)
    spent = sorted({mo for (_, mo), v in totals.items() if v})  # months with any spend (a new user may have only 2)
    if len(spent) < 2:
        return []
    keys = [f"{yy}-{mm:02d}" for yy, mm in spent]
    regular = {_norm(r["vendor"]) for r in recurring or [] if r.get("vendor")}
    rows: dict[str, list[dict]] = defaultdict(list)
    for t in txns:
        if _month(t.get("date")) in window and t.get("total_amount") is not None:
            rows[_key(t.get("category"))].append(t)
    names = _display_names(txns)
    lines = []
    for key, group in rows.items():
        usual, left_out = usual_month_totals(group, keys, regular)
        level = float(np.percentile([usual[k] for k in keys], DRAFT_PERCENTILE))
        if level >= MIN_MONTHLY:
            lines.append({"category": names[key], "limit": _round_up(level),
                          "basis": {"months": keys, "average": round(sum(totals.get((key, mo), 0.0) for mo in spent) / len(spent), 2),
                                    "usual": round(level, 2),
                                    "one_offs": [{"vendor": r.get("vendor_name") or "", "amount": _amount(r),
                                                  "date": str(r.get("date"))[:10]} for r in left_out]}})
    lines.sort(key=lambda l: l["limit"], reverse=True)
    return lines[:MAX_LINES]
