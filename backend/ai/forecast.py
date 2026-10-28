"""Forecast (spec docs/superpowers/specs/2026-10-28-forecast-design.md): where this month and the next three land.

Pure functions over transaction dicts (vendor_name, date 'YYYY-MM-DD', total_amount, category) and the recurring
charges `api/bills.py` reports (with `state`); no DB, no LLM. Known bills fall on their due days; everyday spending
(everything else) is predicted by two methods that compete on a backtest over the user's own past months.
"""
from __future__ import annotations

import calendar
from datetime import date

from ai.recurring import _norm

BILL_KINDS = {"bill", "subscription"}  # the catch-all "recurring" kind (one shop, often) stays everyday spending


def _day(value) -> date | None:
    try:
        return date.fromisoformat(str(value)[:10])
    except (TypeError, ValueError):
        return None


# ---- bills ----

def bill_items(recurring: list[dict]) -> list[dict]:
    """The charges that count as bills: bills and subscriptions still being paid (not cancelled, not looking stopped).
    "charged_again" (a cancel that didn't stick) is still a bill."""
    return [r for r in recurring
            if r.get("kind") in BILL_KINDS and r.get("state", "active") != "cancelled" and not r.get("possibly_stopped")]


def is_bill(txn: dict, bills: list[dict]) -> bool:
    keys = {_norm(b["vendor"]) for b in bills}
    return bool(txn.get("vendor_name")) and _norm(txn["vendor_name"]) in keys


def due_days(item: dict, year: int, month: int) -> list[int]:
    """The days of `month` (1-12) a charge is expected on, projected from its next due date by its cadence (the same
    rules as the frontend's bills-math dueDays)."""
    nxt = _day(item["next_due_date"])
    last = calendar.monthrange(year, month)[1]
    if item["cadence"] == "monthly":
        return [min(nxt.day, last)]
    if item["cadence"] == "yearly":
        return [nxt.day] if (nxt.year, nxt.month) == (year, month) else []
    first = date(year, month, 1)
    offset = (nxt - first).days % 7
    return list(range(1 + offset, last + 1, 7))


def bills_in_month(bills: list[dict], year: int, month: int, today: date, txns: list[dict]) -> list[dict]:
    """Bills still to be paid in a month, `{vendor, category, amount, day}`, by day. In the current month a bill already
    charged this month isn't due again, and one whose expected date has passed without a charge is due today (late,
    not stopped). Earlier days of the current month are past: only today onwards counts."""
    current = (year, month) == (today.year, today.month)
    paid = {_norm(t["vendor_name"]) for t in txns
            if t.get("vendor_name") and (d := _day(t.get("date"))) and (d.year, d.month) == (year, month)} if current else set()
    out = []
    for b in bills:
        nxt = _day(b["next_due_date"])
        if current and _norm(b["vendor"]) in paid and b["cadence"] != "weekly":
            continue
        days = due_days(b, year, month)
        if current:
            late = nxt < today
            days = [d for d in days if d >= today.day] or ([today.day] if late else [])
        elif nxt > date(year, month, calendar.monthrange(year, month)[1]):
            days = []  # not due yet that far out (e.g. a monthly bill first due next year never happens earlier)
        out += [{"vendor": b["vendor"], "category": b.get("category"), "amount": float(b["typical_amount"]), "day": d}
                for d in days]
    return sorted(out, key=lambda b: (b["day"], b["vendor"]))
