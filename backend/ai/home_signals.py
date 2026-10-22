"""Home's "Lumen found" signals and activity feed (UI revamp Phase 3). Pure functions, no DB, no LLM.

Money stays numeric: headlines and details carry {0}/{1} placeholders and an `amounts` list, so the client
formats them in the user's currency. A ₹ "worth" is only given where money can plausibly come back (duplicates).
ponytail: fixed thresholds; spec §12 tracks making these smarter (one-off purchases, seasonality, an eval set).
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import date, datetime, timedelta

from ai.budget import _display_names, _key
from ai.recurring import _norm

DUP_WINDOW_DAYS = 30
HABIT_CHARGES = 3  # this many charges from one vendor in the window = a habit, not a duplicate
SPIKE_RATIO = 1.3
SPIKE_FLOOR = 1000
PRICE_RISE_PCT = 5
PRICE_RISE_RECENT_DAYS = 45
ACTIVITY_LIMIT = 6
_CADENCE = {"weekly": "week", "monthly": "month", "yearly": "year"}
_LABEL = {"set_budget": "a {target} budget", "update_category": "a category change"}


def _day(d) -> date | None:
    try:
        return date.fromisoformat(str(d)[:10])
    except ValueError:
        return None


def _short(d: date) -> str:
    return f"{d.day} {d:%b}"


def _duplicates(txns: list[dict], today: date) -> list[dict]:
    recent = []
    for t in txns:
        d, amount = _day(t.get("date")), t.get("total_amount")
        if d and amount and amount > 0 and today - timedelta(days=DUP_WINDOW_DAYS) <= d <= today and t.get("vendor_name"):
            recent.append((_norm(t["vendor_name"]), d, float(amount), t))
    # a vendor you pay most days (coffee, metro) isn't double-charging you
    per_vendor = defaultdict(int)
    for v, *_ in recent:
        per_vendor[v] += 1
    recent = [r for r in recent if per_vendor[r[0]] < HABIT_CHARGES]
    recent.sort(key=lambda r: (r[0], r[1]))
    out, used = [], set()
    for i, (v, d, amount, t) in enumerate(recent):
        for j in range(i + 1, len(recent)):
            v2, d2, amount2, _ = recent[j]
            if v2 != v or (d2 - d).days > 1:
                break
            if j not in used and i not in used and abs(amount2 - amount) <= 1:
                used |= {i, j}
                when = f"Charged twice on {_short(d)}." if d == d2 else f"Charged on {_short(d)} and {_short(d2)}."
                rounded = round(amount)
                out.append({"kind": "duplicate", "tag": "DUPLICATES", "subject": t["vendor_name"].strip(), "headline": f"Possible double charge: "
                            f"{t['vendor_name'].strip()} {{0}}", "detail": when, "amounts": [rounded],
                            "worth": rounded, "href": None})
                break
    return out


def _spikes(txns: list[dict], today: date) -> list[dict]:
    first = today.replace(day=1)
    prev_end = first - timedelta(days=1)
    prev_first = prev_end.replace(day=1)
    same_day = prev_first.replace(day=min(today.day, prev_end.day))
    # spending only: a refund in either month would shrink the base and fake a huge percentage
    now, then, prev_total = defaultdict(float), defaultdict(float), 0.0
    for t in txns:
        d, amount = _day(t.get("date")), t.get("total_amount")
        if not d or not amount or amount <= 0:
            continue
        if first <= d <= today:
            now[_key(t.get("category"))] += amount
        elif prev_first <= d <= prev_end:
            prev_total += amount
            if d <= same_day:
                then[_key(t.get("category"))] += amount
    names = _display_names(txns)
    floor = max(SPIKE_FLOOR, 0.05 * prev_total)
    out = []
    for k, n in now.items():
        p = then.get(k, 0.0)
        if p > 0 and n >= p * SPIKE_RATIO and n - p >= floor:
            pct = round((n - p) / p * 100)
            out.append((pct, {"kind": "spike", "tag": "SPENDING", "subject": names[k], "headline": f"{names[k]} is up {pct}%",
                              "detail": "{0} so far vs {1} by this point last month.",
                              "amounts": [round(n), round(p)], "worth": None, "href": "/spending"}))
    return [s for _, s in sorted(out, key=lambda x: -x[0])]


def _price_rises(recurring: list[dict], today: date) -> list[dict]:
    out = []
    for r in recurring:
        change, last = r.get("price_change"), _day(r.get("last_charge_date"))
        if change and change.get("percent", 0) >= PRICE_RISE_PCT and last and (today - last).days <= PRICE_RISE_RECENT_DAYS:
            out.append({"kind": "price_rise", "tag": "SUBSCRIPTIONS", "subject": r["vendor"],
                        "headline": f"{r['vendor']} went up {round(change['percent'])}%",
                        "detail": f"{{0}} → {{1}} a {_CADENCE.get(r.get('cadence'), 'charge')}.",
                        "amounts": [change["previous"], change["latest"]], "worth": None, "href": "/bills"})
    return out


def find_signals(txns: list[dict], today: date, review_count: int, recurring: list[dict]) -> list[dict]:
    """Everything worth a look, most actionable first: duplicates, receipts to review, spikes, price rises."""
    review = []
    if review_count > 0:
        review = [{"kind": "review", "tag": "RECEIPTS", "subject": None,
                   "headline": f"{review_count} {'receipt needs' if review_count == 1 else 'receipts need'} a glance",
                   "detail": "Lumen wasn't sure about these. Nothing is saved until you approve.",
                   "amounts": [], "worth": None, "href": "/receipts?tab=review"}]
    return _duplicates(txns, today) + review + _spikes(txns, today) + _price_rises(recurring, today)


def _at(value) -> datetime | None:
    if isinstance(value, datetime):
        return value
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def _iso(d: datetime) -> str:
    return d.replace(microsecond=0).isoformat() + "Z"  # stored as naive UTC (datetime.utcnow)


def activity(txns: list[dict], events: list[dict], now: datetime) -> list[dict]:
    """The newest things that happened: statement imports (one line per import), receipts read, your decisions."""
    items: list[tuple[datetime, dict]] = []
    imports: dict[datetime, list] = defaultdict(list)
    for t in txns:
        at = _at(t.get("created_at"))
        if at is None or at > now + timedelta(minutes=5):
            continue
        if t.get("source") == "statement":
            imports[at.replace(second=0, microsecond=0)].append(t)
        else:
            items.append((at, {"kind": "receipt", "text": f"Read a receipt: {t.get('vendor_name') or 'a vendor'} {{0}}",
                               "amounts": [t.get("total_amount") or 0], "at": _iso(at)}))
    for minute, rows in imports.items():
        n = len(rows)
        items.append((minute, {"kind": "statement_import", "text": f"Imported a statement · {n} {'row' if n == 1 else 'rows'}",
                               "amounts": [], "at": _iso(minute)}))
    for e in events:
        if e.get("actor") != "user" or e.get("action") not in ("proposal_approved", "proposal_rejected"):
            continue
        if json.loads(e.get("detail") or "{}").get("superseded"):
            continue
        at = _at(e.get("created_at"))
        if at is None:
            continue
        verb = "approved" if e["action"] == "proposal_approved" else "rejected"
        label = _LABEL.get(e.get("type"), "a suggestion").format(target=e.get("target") or "")
        items.append((at, {"kind": "decision", "text": f"You {verb} {label}", "amounts": [], "at": _iso(at)}))
    items.sort(key=lambda x: x[0], reverse=True)
    return [i for _, i in items[:ACTIVITY_LIMIT]]
