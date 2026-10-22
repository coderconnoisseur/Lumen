"""Budgets (UI revamp Phase 3): per-category spend for a month, and a deterministic draft from recent months.

Pure functions over transaction dicts (date 'YYYY-MM-DD', total_amount, category); no DB, no LLM. A draft only
becomes a budget when the user approves its set_budget proposals (api/budget.py, api/agent.py).
ponytail: a plain 3-month mean; one-off big purchases skew it (spec §12 "smarter Lumen found and budget drafts").
"""
from __future__ import annotations

import math
from collections import Counter, defaultdict
from datetime import date

MIN_MONTHLY = 300  # categories averaging less aren't worth a line
MAX_LINES = 8


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


def draft_budget(txns: list[dict], today: date) -> list[dict]:
    """One line per category: the mean over the 3 complete months before today's (only those with any spend, which
    are the ones basis.months lists), rounded up.
    Empty when fewer than 2 of those months have any spend (not enough history to suggest limits)."""
    months = []
    y, m = today.year, today.month
    for _ in range(3):
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
        months.append((y, m))
    months.reverse()
    totals = _totals(txns, set(months))
    spent = sorted({mo for (_, mo), v in totals.items() if v})  # months with any spend (a new user may have only 2)
    if len(spent) < 2:
        return []
    names = _display_names(txns)
    lines = []
    for key in {k for k, _ in totals}:
        avg = sum(totals.get((key, mo), 0.0) for mo in months) / len(spent)
        if avg >= MIN_MONTHLY:
            lines.append({"category": names[key], "limit": _round_up(avg),
                          "basis": {"months": [f"{yy}-{mm:02d}" for yy, mm in spent], "average": round(avg, 2)}})
    lines.sort(key=lambda l: l["limit"], reverse=True)
    return lines[:MAX_LINES]
