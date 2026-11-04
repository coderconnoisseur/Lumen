"""Budget drafts and "Lumen found" (spec docs/superpowers/specs/2026-11-04-smarter-drafts-design.md §5). No LLM.

Each of the last 6 complete months: draft from what was known before it, with the new rule and with the old one (kept
here as the baseline), then see whether the month fit. Also: how far one laptop moves a limit, whether every reason's
amounts come from its own numbers, whether a regular bill was ever left out, and labelled "Lumen found" cases.
Users: the same three as the forecast suite. They're synthetic or built on synthetic data, so the numbers are indicative.
"""
from __future__ import annotations

import calendar
import random
import re
from collections import defaultdict
from datetime import date
from pathlib import Path
from statistics import median

import yaml

from ai.budget import (MAX_LINES, MIN_MONTHLY, _display_names, _key, _month, _norm, _round_up, _totals, draft_budget,
                       draft_reason, usual_month_totals)
from ai.home_signals import _spikes
from ai.recurring import find_recurring
from evals.suites.forecast import users
from utils.money import fmt

BACKTEST_MONTHS = 6
LAPTOP = 80000


def _baseline_draft(txns: list[dict], today: date) -> list[dict]:
    """The rule this replaces: the mean of the last 3 complete months, rounded up."""
    months, y, m = [], today.year, today.month
    for _ in range(3):
        y, m = (y, m - 1) if m > 1 else (y - 1, 12)
        months.append((y, m))
    totals = _totals(txns, set(months))
    spent = {mo for (_, mo), v in totals.items() if v}
    if len(spent) < 2:
        return []
    names = _display_names(txns)
    lines = []
    for key in {k for k, _ in totals}:
        avg = sum(totals.get((key, mo), 0.0) for mo in months) / len(spent)
        if avg >= MIN_MONTHLY:
            lines.append({"category": names[key], "limit": _round_up(avg)})
    lines.sort(key=lambda l: l["limit"], reverse=True)
    return lines[:MAX_LINES]


def _shift(y: int, m: int, back: int) -> tuple[int, int]:
    t = y * 12 + m - 1 - back
    return t // 12, t % 12 + 1


def _score(rows: list[dict]) -> dict:
    n = len(rows)
    room = [(r["limit"] - r["usual"]) / r["limit"] * 100 for r in rows if r["usual"] <= r["limit"] and r["limit"] > 0]
    miss = [abs(r["limit"] - r["all"]) / r["all"] * 100 for r in rows if r["all"] > 0]
    return {"lines": n,
            "fit_usual_pct": round(sum(r["usual"] <= r["limit"] for r in rows) / n * 100, 1) if n else None,
            "fit_all_pct": round(sum(r["all"] <= r["limit"] for r in rows) / n * 100, 1) if n else None,
            "unused_room_pct": round(median(room), 1) if room else None,
            "typical_miss_pct": round(median(miss), 1) if miss else None,
            "avg_limit": round(sum(r["limit"] for r in rows) / n) if n else None}


def _reason_mismatches(key: str, month: str, lines: list[dict]) -> list[str]:
    bad = []
    for line in lines:
        basis, text = line["basis"], draft_reason(line, "INR")
        left = [o["amount"] for o in basis["one_offs"]]
        allowed = {fmt(basis["usual"], "INR"), *(fmt(a, "INR") for a in left), fmt(sum(left), "INR")}
        bad += [f"{key} {month} {line['category']}: {a} not in its basis"
                for a in re.findall(r"₹[\d,]+", text) if a not in allowed]
    return bad


def _laptop_shifts(past: list[dict], start: date, recurring: list[dict], lines: list[dict], rng: random.Random,
                   window: tuple[int, int]) -> tuple[list[float], list[float]]:
    """Add one laptop to a month of the lookback, per line of a category with at least 4 purchases; how far did the limit move?"""
    new, base = [], []
    before = {_key(l["category"]): l["limit"] for l in _baseline_draft(past, start)}
    for line in lines:
        k = _key(line["category"])
        keys = set(line["basis"]["months"])
        if sum(_key(t.get("category")) == k and str(t["date"])[:7] in keys and float(t["total_amount"] or 0) > 0 for t in past) < 4:
            continue
        y, m = _shift(start.year, start.month, rng.randint(*window))
        if f"{y}-{m:02d}" not in keys:
            continue
        rows = past + [{"vendor_name": f"Laptop Store {rng.randint(1, 10**6)}", "date": f"{y}-{m:02d}-14",
                        "total_amount": LAPTOP, "category": line["category"]}]
        after = {_key(l["category"]): l["limit"] for l in draft_budget(rows, start, recurring)}
        if k in after:
            new.append(abs(after[k] - line["limit"]))
        after_base = {_key(l["category"]): l["limit"] for l in _baseline_draft(rows, start)}
        if k in before and k in after_base:
            base.append(abs(after_base[k] - before[k]))
    return new, base


def _found_failures(key: str, txns: list[dict], today: date) -> list[str]:
    """Labelled cases: an injected category on top of the user's real spending."""
    y, m = _shift(today.year, today.month, 1)
    py, pm = _shift(y, m, 1)
    now, prev = date(y, m, 21), f"{py}-{pm:02d}"
    this = f"{y}-{m:02d}"
    real = [t for t in txns if str(t["date"])[:10] <= now.isoformat()]
    row = lambda d, a, v: {"vendor_name": v, "date": d, "total_amount": a, "category": "Evalcat"}  # noqa: E731
    bills = [row(f"{yy}-{mm:02d}-05", 3000, "Eval Power") for yy, mm in (_shift(y, m, b) for b in range(1, 7))]
    cases = {
        "one purchase": ([row(f"{prev}-05", 5000, "A"), row(f"{this}-05", 5000, "A"), row(f"{this}-10", 40000, "TechHub")], "TechHub"),
        "broad rise": ([row(f"{prev}-05", 5000, "A")] + [row(f"{this}-{d:02d}", 4000, f"V{d}") for d in range(1, 11)], None),
        "similar purchases": ([row(f"{prev}-05", 2000, "A")] + [row(f"{this}-{d:02d}", 9000, f"V{d}") for d in (3, 6, 9)], None),
        "two similar": ([row(f"{prev}-05", 2000, "A"), row(f"{this}-05", 12000, "A"), row(f"{this}-06", 12000, "B")], None),
        "bill rises": (bills + [row(f"{this}-05", 30000, "Eval Power")], None),
    }
    bad = []
    for name, (extra, want) in cases.items():
        rows = real + extra
        spike = next((s for s in _spikes(rows, now, find_recurring(rows, now)) if s["subject"] == "Evalcat"), None)
        if spike is None:
            bad.append(f"{key} {name}: no alert")
        elif want and not spike["headline"].startswith(f"{{2}} at {want} pushed"):
            bad.append(f"{key} {name}: {spike['headline']!r} doesn't name {want}")
        elif not want and " at " in spike["headline"]:
            bad.append(f"{key} {name}: {spike['headline']!r} names a purchase")
    return bad


def run(tier: str, split: str) -> dict:
    gates = (yaml.safe_load((Path(__file__).parents[1] / "gates.yaml").read_text(encoding="utf-8")) or {}).get("drafts", {})
    rng = random.Random(42)
    new_rows, base_rows, shared_new, shared_base, per_user = [], [], [], [], {}
    cases, reasons, wrongly, shift_new, shift_base, shift_older, found = {}, [], [], [], [], [], []
    left_out_lines = 0
    all_users = users()[:3]
    for key, txns, today in all_users:
        truth = {_norm(r["vendor"]) for r in find_recurring(txns, today)}
        user_new = []
        for back in range(1, BACKTEST_MONTHS + 1):
            y, m = _shift(today.year, today.month, back)
            cut, start = f"{y}-{m:02d}", date(y, m, 1)
            past = [t for t in txns if str(t["date"])[:7] < cut]
            recurring = find_recurring(past, start)
            lines = draft_budget(past, start, recurring)
            base = _baseline_draft(past, start)
            month_end = date(y, m, calendar.monthrange(y, m)[1])
            known = {_norm(r["vendor"]) for r in find_recurring([t for t in txns if str(t["date"])[:10] <= month_end.isoformat()], month_end)}
            lookback = {f"{yy}-{mm:02d}" for yy, mm in (_shift(y, m, b) for b in range(0, 7))}
            by_cat: dict[str, list[dict]] = defaultdict(list)
            for t in txns:
                if str(t["date"])[:7] in lookback and t.get("total_amount") is not None:
                    by_cat[_key(t.get("category"))].append(t)
            # the same judgement of the target month for both rules
            usual = {c: usual_month_totals(rows, [cut], known)[0][cut] for c, rows in by_cat.items()}
            spent = {c: sum(float(t["total_amount"]) for t in rows if _month(t["date"]) == (y, m)) for c, rows in by_cat.items()}
            new_by = {_key(l["category"]): l for l in lines}
            base_by = {_key(l["category"]): l for l in base}
            for c, l in new_by.items():
                r = {"limit": l["limit"], "usual": usual.get(c, 0.0), "all": spent.get(c, 0.0)}
                new_rows.append(r)
                user_new.append(r)
                cases[f"{key}:{cut}:{c}"] = r["usual"] <= r["limit"]
                if c in base_by:
                    shared_new.append(r)
                    shared_base.append({**r, "limit": base_by[c]["limit"]})
                left_out_lines += bool(l["basis"]["one_offs"])
                for o in l["basis"]["one_offs"]:
                    earlier = sum(_norm(t.get("vendor_name") or "") == _norm(o["vendor"]) and str(t["date"])[:10] < o["date"] for t in past)
                    if _norm(o["vendor"]) in truth and earlier >= 2:
                        wrongly.append(f"{key} {cut} {l['category']}: {o['vendor']} {o['amount']}")
            base_rows += [{"limit": l["limit"], "usual": usual.get(c, 0.0), "all": spent.get(c, 0.0)} for c, l in base_by.items()]
            reasons += _reason_mismatches(key, cut, lines)
            n, b = _laptop_shifts(past, start, recurring, lines, rng, (1, 3))
            shift_new += n
            shift_base += b
            shift_older += _laptop_shifts(past, start, recurring, lines, rng, (4, 6))[0]
        per_user[key] = _score(user_new)
        found += _found_failures(key, txns, today)
    new, shared = _score(new_rows), {"new": _score(shared_new), "baseline": _score(shared_base)}
    laptop = {"new_median": median(shift_new) if shift_new else None, "baseline_median": median(shift_base) if shift_base else None,
              "older_months_new_median": median(shift_older) if shift_older else None, "tried": len(shift_new)}
    metrics = {"users": len(all_users), "new": new, "baseline": _score(base_rows), "shared": shared, "laptop_shift": laptop,
               "lines_with_one_offs": left_out_lines, "reason_mismatches": reasons, "left_out_wrongly": wrongly,
               "found_failures": found, "per_user": per_user}
    hard = []
    if (new["fit_usual_pct"] or 0) < gates.get("fit_usual_min", 70):
        hard.append(f"fit on usual months {new['fit_usual_pct']}% < {gates.get('fit_usual_min', 70)}%")
    drop = (shared["baseline"]["fit_usual_pct"] or 0) - (shared["new"]["fit_usual_pct"] or 0)
    if drop > gates.get("fit_usual_vs_baseline", 2):
        hard.append(f"fit on usual months is {drop:.1f} points below today's rule on shared lines")
    if (new["unused_room_pct"] or 0) > gates.get("unused_room_max", 25):
        hard.append(f"unused room {new['unused_room_pct']}% > {gates.get('unused_room_max', 25)}%")
    if laptop["new_median"] is None or laptop["new_median"] > gates.get("laptop_shift_max", 1000):
        hard.append(f"one laptop moves a limit by {laptop['new_median']}")
    hard += [f"reason: {r}" for r in reasons] + [f"left out a regular bill: {w}" for w in wrongly] + [f"found: {f}" for f in found]
    return {"cases": cases, "metrics": metrics, "hard_gate_failures": hard}
