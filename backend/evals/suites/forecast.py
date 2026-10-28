"""`forecast` suite (spec docs/superpowers/specs/2026-10-28-forecast-design.md §5): how right the forecast is. No LLM.

Users: the eval world's two users (a year each, "today" = AS_OF) and three demo accounts (the one-click demo's data:
world u1 shifted to end yesterday + a person's own bills, built here without a database). For each user both methods
are backtested over the last 6 complete months (whole month, and a mid-month cut on the 15th), the per-user choice
is made as the app makes it, and the old smoothing forecast (ai/forecasting_agent.py) is scored the same way as the
baseline. Hard gates (evals/gates.yaml `forecast`) apply to the chosen method pooled over users.
"""
from __future__ import annotations

import calendar
import re
import uuid
from datetime import date, timedelta
from pathlib import Path

import yaml

from ai import forecast as fc
from ai.recurring import find_recurring

DEMO_TODAY = date(2026, 10, 27)
DEMO_IDS = ("7a1c0000-0000-4000-8000-00000000d001", "7a1c0000-0000-4000-8000-00000000d002",
            "7a1c0000-0000-4000-8000-00000000d003")


def _demo_rows(user_id: str, today: date) -> list[dict]:
    """The one-click demo's transactions for `user_id` (scripts/seed_demo_data.seed, minus the database)."""
    from evals.generator.world import build_world
    from scripts.seed_demo_data import _life_rows

    world = build_world(42)
    source = next(u for u in world["users"] if u["key"] == "u1")
    txns = [t for t in world["transactions"] if t["user_id"] == source["id"]]
    remap = lambda old: str(uuid.uuid5(uuid.UUID(user_id), old))  # noqa: E731
    shift = today - timedelta(days=1) - max(date.fromisoformat(t["date"]) for t in txns)
    rows = [{**t, "id": remap(t["id"]), "user_id": user_id, "date": (date.fromisoformat(t["date"]) + shift).isoformat()}
            for t in txns]
    return rows + _life_rows(user_id, today - timedelta(days=1), remap)


def users() -> list[tuple[str, list[dict], date]]:
    from evals.generator.world import AS_OF, build_world

    world = build_world(42)
    out = [(u["key"], [t for t in world["transactions"] if t["user_id"] == u["id"]], AS_OF) for u in world["users"]]
    return out + [(f"demo{n + 1}", _demo_rows(uid, DEMO_TODAY), DEMO_TODAY) for n, uid in enumerate(DEMO_IDS)]


def _baseline(txns: list[dict], today: date) -> list[dict]:
    """The old forecast (daily exponential smoothing ± a fixed 5% trend) on the same months as the backtest."""
    import pandas as pd

    from ai.forecasting_agent import ForecastingAgent

    out = []
    for row in fc.backtest(txns, today, "bills_everyday"):
        y, m = int(row["month"][:4]), int(row["month"][5:])
        start = date(y, m, 1)
        past = [t for t in txns if (start - timedelta(days=90)).isoformat() <= str(t["date"])[:10] < start.isoformat()]
        df = pd.DataFrame([{"date": pd.to_datetime(str(t["date"])[:10]), "total_amount": float(t["total_amount"]),
                            "category": t.get("category")} for t in past])
        agent = ForecastingAgent()
        agent.get_historical_data = lambda *_a, **_k: df  # noqa: B023  (the same history, without the database)
        agent.forecast_by_category = lambda *_a, **_k: []  # per category isn't scored, and it would query the database
        res = agent.forecast_spending("eval", days_ahead=calendar.monthrange(y, m)[1], use_llm=False)
        values = (res.get("forecast") or {}).get("values") or []
        if values:
            total = round(sum(values), 2)
            out.append({"month": row["month"], "actual": row["actual"], "predicted": total, "low": total, "high": total})
    return out


_MONEY = re.compile(r"₹([\d,]+)")


def _why_mismatches(key: str, txns: list[dict], today: date) -> list[str]:
    """Every ₹ amount in a month's why line must be a transaction or bill amount of that month."""
    recurring = find_recurring(txns, today)
    f = fc.forecast(txns, recurring, today)
    if f is None:
        return []
    bills = fc.bill_items(recurring)
    bad = []
    for i, month in enumerate(f["months"]):
        y, m = int(month["month"][:4]), int(month["month"][5:])
        allowed = {round(float(t["total_amount"])) for t in txns if str(t.get("date", ""))[:7] == month["month"]}
        allowed |= {round(b["amount"]) for b in fc.bills_in_month(bills, y, m, today, txns)}
        for amount in _MONEY.findall(month["why"]):
            if int(amount.replace(",", "")) not in allowed:
                bad.append(f"{key} {month['month']}: {month['why']}")
    return bad


def _pool(rows: list[dict]) -> dict:
    return fc.score(rows)


def run(tier: str, split: str) -> dict:
    gates = (yaml.safe_load((Path(__file__).parents[1] / "gates.yaml").read_text(encoding="utf-8")) or {}).get("forecast", {})
    whole, base, cases, per_user, why_bad = {n: [] for n in fc.METHODS}, [], {}, {}, []
    chosen_whole, chosen_mid = [], []
    for key, txns, today in users():
        rows = {n: fc.backtest(txns, today, n) for n in fc.METHODS}
        pick = fc.choose(txns, today)["method"]
        for n in fc.METHODS:
            whole[n] += rows[n]
        chosen_whole += rows[pick]
        chosen_mid += fc.backtest(txns, today, pick, cut_day=15)
        base += _baseline(txns, today)
        per_user[key] = {"method": pick, **fc.score(rows[pick])}
        for r in rows[pick]:
            cases[f"{key}:{r['month']}"] = abs(r["predicted"] - r["actual"]) <= 0.10 * r["actual"]
        why_bad += _why_mismatches(key, txns, today)
    chosen, chosen_cut = _pool(chosen_whole), _pool(chosen_mid)
    metrics = {"users": len(per_user), "chosen": chosen, "chosen_mid_month": chosen_cut,
               "by_method": {n: _pool(whole[n]) for n in fc.METHODS}, "baseline": _pool(base),
               "per_user": per_user, "why_mismatches": why_bad}
    hard = []
    if chosen["median_error_pct"] is None or chosen["median_error_pct"] > gates.get("median_error_max", 10):
        hard.append(f"whole-month median error {chosen['median_error_pct']}% > {gates.get('median_error_max', 10)}%")
    if chosen_cut["median_error_pct"] is None or chosen_cut["median_error_pct"] > gates.get("median_error_mid_max", 12):
        hard.append(f"mid-month median error {chosen_cut['median_error_pct']}% > {gates.get('median_error_mid_max', 12)}%")
    if (chosen["in_range_pct"] or 0) < gates.get("in_range_min", 60):
        hard.append(f"in-range {chosen['in_range_pct']}% < {gates.get('in_range_min', 60)}%")
    ratio = gates.get("baseline_ratio_max")
    base_err = metrics["baseline"]["median_error_pct"]
    if ratio and base_err and chosen["median_error_pct"] is not None and chosen["median_error_pct"] > ratio * base_err:
        hard.append(f"chosen {chosen['median_error_pct']}% isn't under {ratio:.0%} of the old forecast's {base_err}%")
    if why_bad:
        hard.append(f"{len(why_bad)} why line(s) with numbers not in their month")
    return {"cases": cases, "metrics": metrics, "hard_gate_failures": hard}
