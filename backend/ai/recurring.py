"""Recurring charges: subscriptions, bills and other regular payments, with the next due date.

Pure function over transaction dicts (vendor_name, date 'YYYY-MM-DD', total_amount, category), no DB, no LLM.
A vendor is recurring when it has 3+ charges at a regular cadence (weekly / monthly / yearly, a few days'
jitter) and similar amounts. Frequent shopping at a vendor fails the cadence check, so it isn't reported.
"""
from __future__ import annotations

import calendar
import re
from datetime import date, timedelta
from statistics import median

# name, period in days, allowed jitter in days, months to add for the next due date (0 = use days)
_CADENCES = (("weekly", 7, 2, 0), ("monthly", 30.44, 5, 1), ("yearly", 365.25, 15, 12))
_SUBSCRIPTION = {"subscriptions", "subscription", "entertainment", "software", "streaming", "digital services"}
_BILL = {"utilities", "utility", "bills", "rent", "housing", "phone", "mobile", "broadband", "internet", "telecom",
         "insurance"}
MIN_CHARGES = 3


def _norm(vendor: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", vendor.lower()).strip()


def _add_months(d: date, months: int) -> date:
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def _kind(category: str | None) -> str:
    c = (category or "").strip().lower()
    return "subscription" if c in _SUBSCRIPTION else "bill" if c in _BILL else "recurring"


def find_recurring(transactions: list[dict], today: date) -> list[dict]:
    groups: dict[str, list[tuple[date, float, dict]]] = {}
    for t in transactions:
        try:
            d, amount = date.fromisoformat(str(t["date"])[:10]), float(t["total_amount"])
        except (KeyError, TypeError, ValueError):
            continue
        if amount > 0 and t.get("vendor_name") and d <= today:
            groups.setdefault(_norm(t["vendor_name"]), []).append((d, amount, t))

    found = []
    for charges in groups.values():
        if len(charges) < MIN_CHARGES:
            continue
        charges.sort(key=lambda c: c[0])
        gaps = [(b[0] - a[0]).days for a, b in zip(charges, charges[1:])]
        cadence = next((c for c in _CADENCES if abs(median(gaps) - c[1]) <= c[2]), None)
        if cadence is None or any(abs(g - cadence[1]) > cadence[2] for g in gaps):
            continue  # irregular: shopping, not a recurring charge
        name, period, _, months = cadence
        last_date, last_amount, last = charges[-1]
        kind = _kind(last.get("category"))
        amounts = [c[1] for c in charges]
        typical = median(amounts)
        # ponytail: bills (electricity, water) swing with usage, so they get a looser band than fixed-price plans
        tolerance = 0.5 if kind == "bill" else 0.25
        if sum(abs(a - typical) <= tolerance * typical for a in amounts) < len(amounts) * 2 / 3:
            continue  # amounts all over the place: not one regular charge
        earlier = median(amounts[:-1])
        percent = round((last_amount - earlier) / earlier * 100, 1)
        next_due = _add_months(last_date, months) if months else last_date + timedelta(days=period)
        found.append({
            "vendor": last["vendor_name"],
            "category": last.get("category"),
            "cadence": name,
            "typical_amount": round(typical, 2),
            "last_charge_date": last_date.isoformat(),
            "next_due_date": next_due.isoformat(),
            "charges_count": len(charges),
            "price_change": ({"previous": round(earlier, 2), "latest": round(last_amount, 2), "percent": percent}
                             if abs(percent) >= 5 else None),
            "kind": kind,
            "possibly_stopped": (today - last_date).days > 2 * period + cadence[2],
        })
    return sorted(found, key=lambda r: (r["possibly_stopped"], r["next_due_date"], r["vendor"]))
