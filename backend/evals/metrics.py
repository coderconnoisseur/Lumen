"""Pure metric functions for the eval harness (SPEC-EVAL). No I/O, no LLM calls.

Every rate is reported with its counts and a 95% Wilson interval, never as a
bare percentage: with 20-50 cases per suite, the interval is the honest part.
"""
from __future__ import annotations

import itertools
import math
import re
from collections import Counter
from decimal import Decimal, InvalidOperation
from typing import Iterable, Mapping, Sequence

from utils.normalize import clean_amount, parse_date

Z_95 = 1.959963984540054


# --- reporting -------------------------------------------------------------------------


def wilson_interval(successes: int, total: int, z: float = Z_95) -> tuple[float, float]:
    if total == 0:
        return (0.0, 1.0)
    p = successes / total
    denom = 1 + z * z / total
    centre = (p + z * z / (2 * total)) / denom
    half = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denom
    low = 0.0 if successes == 0 else max(0.0, centre - half)
    high = 1.0 if successes == total else min(1.0, centre + half)  # exact at the edges
    return (low, high)


def rate(passed: int, total: int) -> dict:
    return {
        "passed": passed,
        "total": total,
        "value": passed / total if total else 0.0,
        "ci95": list(wilson_interval(passed, total)),
    }


# --- text-to-SQL -----------------------------------------------------------------------


def _cell(value):
    if value is None or isinstance(value, bool):
        return value
    if isinstance(value, (int, float, Decimal)):
        return f"{float(value):.2f}"
    text = str(value).strip()
    try:
        return f"{float(Decimal(text)):.2f}"
    except (InvalidOperation, ValueError):
        return text


def _row(row) -> tuple:
    values = row.values() if isinstance(row, Mapping) else row
    return tuple(_cell(v) for v in values)


def result_sets_equal(gold: Iterable, pred: Iterable, *, ordered: bool) -> bool:
    """Compare query results, not SQL text (6b #14).

    Rows are compared by their values in column order (aliases don't matter);
    numbers at 2 decimal places. A multiset compare unless the gold query is ordered.
    """
    gold_rows = [_row(r) for r in gold]
    pred_rows = [_row(r) for r in pred]
    if ordered:
        return gold_rows == pred_rows
    return Counter(gold_rows) == Counter(pred_rows)


def sql_execution_accuracy(cases: Sequence[Mapping]) -> dict:
    """`cases`: {gold, pred, ordered, fallback}. A fallback is a failure (6b #12)."""
    passed = sum(
        1 for c in cases
        if not c["fallback"] and result_sets_equal(c["gold"], c["pred"], ordered=c["ordered"])
    )
    fallbacks = sum(1 for c in cases if c["fallback"])
    return {"accuracy": rate(passed, len(cases)), "fallback_rate": rate(fallbacks, len(cases))}


# --- extraction --------------------------------------------------------------------------

_AMOUNT_FIELDS = {"total_amount", "tax_amount", "unit_price", "total_price", "amount", "subtotal"}
_NAME_FIELDS = {"vendor_name", "customer_name", "payment_method", "category", "currency"}


def normalise_field(name: str, value):
    """Put a gold or predicted field value in a comparable form."""
    if value is None:
        return None
    if name == "date" or name.endswith("_date"):
        return parse_date(value)
    if name in _AMOUNT_FIELDS:
        amount = clean_amount(value)
        return None if amount is None else f"{amount:.2f}"
    text = str(value).strip()
    if not text:
        return None
    if name in _NAME_FIELDS:
        return re.sub(r"\s+", " ", text).casefold()
    return text


def _prf(tp: int, fp: int, fn: int) -> dict:
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "precision": precision, "recall": recall, "f1": f1}


def extraction_prf(docs: Iterable[tuple[Mapping, Mapping]]) -> dict:
    """Field-level P/R/F1 over (gold, predicted) pairs.

    Per field: equal non-null values are a TP; a wrong value is both an FP and
    an FN; a value where gold is null is an FP; a missing value is an FN.
    """
    counts: dict[str, list[int]] = {}
    for gold, pred in docs:
        for field in set(gold) | set(pred):
            g = normalise_field(field, gold.get(field))
            p = normalise_field(field, pred.get(field))
            tp_fp_fn = counts.setdefault(field, [0, 0, 0])
            if g is not None and p is not None and g == p:
                tp_fp_fn[0] += 1
                continue
            if p is not None:
                tp_fp_fn[1] += 1
            if g is not None:
                tp_fp_fn[2] += 1
    per_field = {field: _prf(*c) for field, c in sorted(counts.items())}
    total = [sum(c[i] for c in counts.values()) for i in range(3)]
    return {"overall": _prf(*total), "per_field": per_field}


# --- retrieval ------------------------------------------------------------------------------


def recall_at_k(ranked: Sequence[str], relevant: set, k: int) -> float:
    if not relevant:
        return 0.0
    return len(set(ranked[:k]) & set(relevant)) / len(relevant)


def mrr(ranked: Sequence[str], relevant: set) -> float:
    for i, doc in enumerate(ranked, start=1):
        if doc in relevant:
            return 1 / i
    return 0.0


def ndcg_at_k(ranked: Sequence[str], relevant: set, k: int) -> float:
    dcg = sum(1 / math.log2(i + 2) for i, doc in enumerate(ranked[:k]) if doc in relevant)
    ideal = sum(1 / math.log2(i + 2) for i in range(min(len(relevant), k)))
    return dcg / ideal if ideal else 0.0


# --- agent ----------------------------------------------------------------------------------


def tool_selection_accuracy(pairs: Iterable[tuple[str, str | None]]) -> dict:
    """(expected first tool, actual first tool) pairs."""
    pairs = list(pairs)
    return rate(sum(1 for expected, actual in pairs if expected == actual), len(pairs))


def abstention_accuracy(cases: Sequence[Mapping]) -> dict:
    """Correct = abstained on unanswerable questions and answered answerable ones."""
    return rate(sum(1 for c in cases if c["abstained"] != c["answerable"]), len(cases))


# --- ops, judge, gating --------------------------------------------------------------------


def percentile(values: Sequence[float], p: float) -> float | None:
    """Nearest-rank percentile (no interpolation)."""
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(p / 100 * len(ordered)))
    return ordered[rank - 1]


def cohens_kappa(a: Sequence, b: Sequence) -> float:
    """Agreement between two raters beyond chance (judge vs human labels)."""
    if len(a) != len(b) or not a:
        raise ValueError("kappa needs two equally long, non-empty label lists")
    n = len(a)
    observed = sum(1 for x, y in zip(a, b) if x == y) / n
    count_a, count_b = Counter(a), Counter(b)
    expected = sum(count_a[c] * count_b[c] for c in set(a) | set(b)) / (n * n)
    if expected == 1:
        return 1.0
    return (observed - expected) / (1 - expected)


def paired_changes(previous: Mapping[str, bool], current: Mapping[str, bool]) -> dict:
    """Case ids that went pass->fail (regressed), fail->pass (fixed), or are new."""
    return {
        "regressed": sorted(k for k, ok in current.items() if previous.get(k) is True and not ok),
        "fixed": sorted(k for k, ok in current.items() if previous.get(k) is False and ok),
        "new": sorted(k for k in current if k not in previous),
    }


def gate_regressions(changes: Mapping, *, min_regressed: int) -> bool:
    """True if the suite passes the gate: fewer than `min_regressed` regressed cases."""
    return len(changes["regressed"]) < min_regressed


def result_sets_contain(gold: Iterable, pred: Iterable, *, ordered: bool) -> bool:
    """Diagnostic, never gated: the prediction equals the gold once extra columns are dropped.

    Tells "right numbers, extra columns" apart from "wrong numbers". Gold columns may map to any
    distinct predicted columns; the row multiset (or order) must still match exactly.
    """
    gold_rows = [_row(r) for r in gold]
    pred_rows = [_row(r) for r in pred]
    if len(gold_rows) != len(pred_rows) or not gold_rows:
        return gold_rows == pred_rows
    width, pred_width = len(gold_rows[0]), len(pred_rows[0])
    for columns in itertools.permutations(range(pred_width), width):
        projected = [tuple(row[i] for i in columns) for row in pred_rows]
        if (projected == gold_rows) if ordered else (Counter(projected) == Counter(gold_rows)):
            return True
    return False
