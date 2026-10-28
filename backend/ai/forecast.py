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


# ---- everyday spending ----

def _ym(d: date) -> str:
    return f"{d.year}-{d.month:02d}"


def monthly_everyday(txns: list[dict], bills: list[dict], today: date, months: int = 6) -> list[tuple[str, float]]:
    """Net everyday spend (everything that isn't a bill; refunds net out) per complete month before today's, oldest
    first, for months that had any transactions, at most the last `months`."""
    this = _ym(today)
    seen: set[str] = set()
    totals: dict[str, float] = {}
    for t in txns:
        d = _day(t.get("date"))
        if d is None or _ym(d) >= this or t.get("total_amount") is None:
            continue
        m = _ym(d)
        seen.add(m)
        if not is_bill(t, bills):
            totals[m] = totals.get(m, 0.0) + float(t["total_amount"])
    return [(m, round(totals.get(m, 0.0), 2)) for m in sorted(seen)][-months:]


def _clamp(level: float, low: float, high: float) -> tuple[float, float, float]:
    level = max(level, 0.0)
    return round(level, 2), round(max(min(low, level), 0.0), 2), round(max(high, level, 0.0), 2)


def robust_level(history: list[float], ahead: int) -> tuple[float, float, float] | None:
    """Method A's everyday month: the median of past months (one big one-off doesn't drag it), with the 20th-80th
    percentile spread as the range, widened by 5% of the level per month ahead."""
    if len(history) < 2:
        return None
    import numpy as np

    level = float(np.median(history))
    low, high = (float(v) for v in np.percentile(history, [20, 80]))
    widen = 0.05 * abs(level) * ahead
    return _clamp(level, low - widen, high + widen)


HOLT_ALPHA, HOLT_BETA = 0.5, 0.2


def holt_level(history: list[float], ahead: int) -> tuple[float, float, float] | None:
    """Method B's everyday month: Holt's linear trend (level + trend, exponentially smoothed) `ahead` months past the
    last one, with ±1.28 × the one-step residual spread × sqrt(ahead) as the range (an 80% band if errors were normal).
    numpy only."""
    if len(history) < 2:
        return None
    import numpy as np

    level, trend = float(history[0]), float(history[1] - history[0])
    errors = []
    for value in history[1:]:
        errors.append(value - (level + trend))
        prev = level
        level = HOLT_ALPHA * value + (1 - HOLT_ALPHA) * (level + trend)
        trend = HOLT_BETA * (level - prev) + (1 - HOLT_BETA) * trend
    forecast = level + ahead * trend
    spread = max(float(np.std(errors)), 0.05 * abs(forecast)) * 1.28 * ahead ** 0.5
    return _clamp(forecast, forecast - spread, forecast + spread)


METHODS = {"bills_everyday": robust_level, "holt": holt_level}
LABELS = {"bills_everyday": "Bills + everyday", "holt": "Statistical (Holt)"}


# ---- the forecast for one method ----

HORIZON = 4  # this month + the next three


def _next(year: int, month: int, n: int) -> tuple[int, int]:
    y, m = divmod(year * 12 + month - 1 + n, 12)
    return y, m + 1


def _shares(txns: list[dict], bills: list[dict], today: date, hist_months: set[str]) -> dict[str, float]:
    """Each category's share of everyday spending over the history months (what an everyday level splits into)."""
    by_cat: dict[str, float] = {}
    for t in txns:
        d = _day(t.get("date"))
        if d and _ym(d) in hist_months and t.get("total_amount") is not None and not is_bill(t, bills):
            cat = (t.get("category") or "").strip() or "Uncategorised"
            by_cat[cat] = by_cat.get(cat, 0.0) + float(t["total_amount"])
    total = sum(v for v in by_cat.values() if v > 0)
    return {c: v / total for c, v in by_cat.items() if v > 0} if total else {}


def why(i: int, y: int, m: int, *, due: list[dict], bills: list[dict], recurring: list[dict], hist: list[tuple[str, float]],
        txns: list[dict], today: date, currency: str | None) -> str:
    """One plain sentence on what shapes month `i` (0 = this month), built only from its own numbers (spec §3.5): the
    first rule that applies, plus "Ranges widen further out." for the last month."""
    from utils.money import fmt

    def on(d: date) -> str:
        return f"{d.day} {d:%b}"

    text = None
    usual = sorted(v for _, v in hist)[len(hist) // 2] if hist else 0.0
    if i == 0 and usual > 0:
        mine = [t for t in txns if (d := _day(t.get("date"))) and (d.year, d.month) == (y, m) and d <= today
                and t.get("total_amount") and not is_bill(t, bills)]
        big = max(mine, key=lambda t: float(t["total_amount"]), default=None)
        if big is not None and float(big["total_amount"]) > usual / 2:
            text = (f"Higher than usual: the {fmt(float(big['total_amount']), currency)} {big['vendor_name']} order "
                    f"on {on(_day(big['date']))}.")
    if text is None:
        cadence = {b["vendor"]: b["cadence"] for b in bills}
        yearly = next((b for b in due if cadence.get(b["vendor"]) == "yearly"), None)
        if yearly:
            text = f"Includes the yearly {fmt(yearly['amount'], currency)} {yearly['vendor']} renewal on {on(date(y, m, yearly['day']))}."
    if text is None:
        py, pm = _next(y, m, -1)
        gone = next((r for r in recurring if r.get("state") == "cancelled"
                     and str(r.get("last_charge_date", ""))[:7] == f"{py}-{pm:02d}"), None)
        if gone and i > 0:
            text = f"Lower: {gone['vendor']} is cancelled."
    if text is None:
        n = len({b["vendor"] for b in due})
        span = "–".join(dict.fromkeys(f"{date(int(k[:4]), int(k[5:]), 1):%b}" for k in (hist[0][0], hist[-1][0])))
        text = f"Your usual month: {n} bill{'' if n == 1 else 's'} and everyday spending like {span}."
    return text + (" Ranges widen further out." if i == HORIZON - 1 else "")


def forecast_months(txns: list[dict], recurring: list[dict], today: date, method: str, *,
                    budgets: dict[str, dict] | None = None, income: float | None = None,
                    currency: str | None = None) -> dict | None:
    """This month and the next three with one everyday method: bills on their due days + the method's everyday level.
    None when the method has too little history. Every total is the sum of its parts (spec §3)."""
    bills = bill_items(recurring)
    hist = monthly_everyday(txns, bills, today)
    levels = [METHODS[method]([v for _, v in hist], ahead) for ahead in range(1, HORIZON + 1)]
    if levels[0] is None:
        return None
    shares = _shares(txns, bills, today, {m for m, _ in hist})
    days_in = calendar.monthrange(today.year, today.month)[1]
    days_left = days_in - today.day
    this = _ym(today)

    # this month so far, per day and per category
    daily_spent = [0.0] * today.day
    spent_cat: dict[str, float] = {}
    for t in txns:
        d = _day(t.get("date"))
        if d and _ym(d) == this and d <= today and t.get("total_amount") is not None:
            daily_spent[d.day - 1] += float(t["total_amount"])
            cat = (t.get("category") or "").strip() or "Uncategorised"
            spent_cat[cat] = spent_cat.get(cat, 0.0) + float(t["total_amount"])
    spent = round(sum(daily_spent), 2)

    months, current = [], None
    for i in range(HORIZON):
        y, m = _next(today.year, today.month, i)
        key = f"{y}-{m:02d}"
        level, low, high = levels[i]
        due = bills_in_month(bills, y, m, today, txns)
        bills_total = round(sum(b["amount"] for b in due), 2)
        if i == 0:
            frac = days_left / days_in
            everyday = round(level * frac, 2)
            base = spent + bills_total
            forecast, lo, hi = base + everyday, base + low * frac, base + high * frac
            current = {"spent_so_far": spent, "bills_still_due": {"count": len(due), "amount": bills_total},
                       "everyday_rest": everyday, "days_left": days_left}
        else:
            everyday = level
            forecast, lo, hi = bills_total + level, bills_total + low, bills_total + high
        cats: dict[str, float] = dict(spent_cat) if i == 0 else {}
        for b in due:
            c = (b.get("category") or "").strip() or "Uncategorised"
            cats[c] = cats.get(c, 0.0) + b["amount"]
        for c, s in shares.items():
            cats[c] = cats.get(c, 0.0) + everyday * s
        plan = (budgets or {}).get(key) or {}
        total_budget = plan.get("total")
        limits = plan.get("categories") or {}
        forecast = round(forecast, 2)
        months.append({
            "month": key, "forecast": forecast, "low": round(lo, 2), "high": round(hi, 2),
            "bills": bills_total, "everyday": round(everyday, 2),
            "budget": total_budget, "over_budget": (forecast > total_budget) if total_budget else None,
            "income": income, "left": round(income - forecast, 2) if income else None,
            "why": why(i, y, m, due=due, bills=bills, recurring=recurring, hist=hist, txns=txns, today=today,
                       currency=currency),
            "categories": sorted(({"category": c, "spent": round(spent_cat.get(c, 0.0), 2) if i == 0 else None,
                                   "forecast": round(v, 2), "budget": limits.get(c)} for c, v in cats.items()),
                                 key=lambda x: -x["forecast"]),
        })

    actual, run = [], 0.0
    for v in daily_spent:
        run += v
        actual.append(round(run, 2))
    rate = months[0]["everyday"] / days_left if days_left else 0.0
    due_by_day: dict[int, float] = {}
    for b in bills_in_month(bills, today.year, today.month, today, txns):
        due_by_day[b["day"]] = due_by_day.get(b["day"], 0.0) + b["amount"]
    path, run = [round(spent, 2)], spent + due_by_day.get(today.day, 0.0)
    for day in range(today.day + 1, days_in + 1):
        run += rate + due_by_day.get(day, 0.0)
        path.append(round(run, 2))
    if days_left == 0:
        path = [round(spent + due_by_day.get(today.day, 0.0), 2)]
    return {"months": months, "current": current,
            "daily": {"actual": actual, "path": path, "low": months[0]["low"], "high": months[0]["high"]}}


# ---- backtest, choice, the forecast ----

BACKTEST_MONTHS = 6
MIN_TESTED = 3  # fewer backtestable months than this: no accuracy claim


def _month_total(txns: list[dict], key: str) -> float:
    return round(sum(float(t["total_amount"]) for t in txns
                     if t.get("total_amount") is not None and str(t.get("date", ""))[:7] == key), 2)


def backtest(txns: list[dict], today: date, method: str, *, cut_day: int | None = None,
             months: int = BACKTEST_MONTHS) -> list[dict]:
    """For each of the last `months` complete months M that had spend, predict M's total from what was known then
    (transactions before M, or up to M's `cut_day` for the mid-month cut; the recurring detection re-run on that
    history) and compare with what M really came to. `{month, actual, predicted, low, high}`, oldest first."""
    from datetime import timedelta

    from ai.recurring import find_recurring

    this = _ym(today)
    with_spend = sorted({str(t.get("date", ""))[:7] for t in txns if t.get("date") and str(t["date"])[:7] < this})
    out = []
    for key in with_spend[-months:]:
        y, m = int(key[:4]), int(key[5:])
        start = date(y, m, 1)
        as_of = date(y, m, min(cut_day, calendar.monthrange(y, m)[1])) if cut_day else start
        known = [t for t in txns if (d := _day(t.get("date"))) and (d < start or (cut_day and d <= as_of))]
        recurring = find_recurring(known, as_of if cut_day else start - timedelta(days=1))
        if cut_day:
            f = forecast_months(known, recurring, as_of, method)
            if f is None:
                continue
            first = f["months"][0]
            predicted, low, high = first["forecast"], first["low"], first["high"]
        else:
            bills = bill_items(recurring)
            got = METHODS[method]([v for _, v in monthly_everyday(known, bills, start)], 1)
            if got is None:
                continue
            due = sum(b["amount"] for b in bills_in_month(bills, y, m, start, known))
            predicted, low, high = (round(due + v, 2) for v in got)
        out.append({"month": key, "actual": _month_total(txns, key), "predicted": predicted, "low": low, "high": high})
    return out


def score(rows: list[dict]) -> dict:
    """Median absolute % error of the predicted totals, and how often the actual landed inside the range."""
    import numpy as np

    rows = [r for r in rows if r["actual"] > 0]
    if not rows:
        return {"median_error_pct": None, "in_range_pct": None, "months_tested": 0}
    errors = [abs(r["predicted"] - r["actual"]) / r["actual"] * 100 for r in rows]
    inside = sum(r["low"] <= r["actual"] <= r["high"] for r in rows)
    return {"median_error_pct": round(float(np.median(errors)), 1), "in_range_pct": round(inside / len(rows) * 100, 1),
            "months_tested": len(rows)}


def choose(txns: list[dict], today: date) -> dict:
    """Backtest both methods on the user's own months and keep the one with the lower median error (ties: bills +
    everyday, the more explainable). Too little history: bills + everyday, and no accuracy claim."""
    scores = {name: score(backtest(txns, today, name)) for name in METHODS}
    tested = max(s["months_tested"] for s in scores.values())
    if tested < MIN_TESTED:
        return {"method": "bills_everyday", "accuracy": {"months_tested": tested}}
    best = min(METHODS, key=lambda n: (scores[n]["median_error_pct"], n != "bills_everyday"))
    return {"method": best, "accuracy": {
        "method": best, "label": LABELS[best], **scores[best],
        "tried": [{"method": n, "label": LABELS[n], "median_error_pct": scores[n]["median_error_pct"]} for n in METHODS]}}


def monthly_equivalent(b: dict) -> float:
    a = float(b["typical_amount"])
    return round(a * 52 / 12, 2) if b["cadence"] == "weekly" else round(a / 12, 2) if b["cadence"] == "yearly" else a


def forecast(txns: list[dict], recurring: list[dict], today: date, *, budgets: dict[str, dict] | None = None,
             income: float | None = None, currency: str | None = None) -> dict | None:
    """The forecast the app shows: the better method for this user, its months, its measured accuracy, and the bills
    a what-if can switch off. None when there's too little history to forecast at all."""
    picked = choose(txns, today)
    f = forecast_months(txns, recurring, today, picked["method"], budgets=budgets, income=income, currency=currency)
    if f is None:
        return None
    return {**f, "method": picked["method"], "accuracy": picked["accuracy"],
            "items": [{"vendor": b["vendor"], "kind": b["kind"], "monthly_equivalent": monthly_equivalent(b)}
                      for b in bill_items(recurring)]}
