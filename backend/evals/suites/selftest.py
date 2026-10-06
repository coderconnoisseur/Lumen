"""A suite with no model calls, so `pytest -m eval` exercises the harness end to
end (split, gate, results file) before the real datasets exist (EVAL-02)."""
from __future__ import annotations

from evals.metrics import rate, result_sets_equal

_CASES = {
    "dev": [("multiset-order", [(1,), (2,)], [(2,), (1,)]), ("money-2dp", [(650.0,)], [("650.00",)])],
    "test": [("ordered", [(1,), (2,)], [(1,), (2,)])],
}


def run(tier: str, split: str) -> dict:
    cases = {case_id: result_sets_equal(gold, pred, ordered=False) for case_id, gold, pred in _CASES[split]}
    return {
        "cases": cases,
        "metrics": {"accuracy": rate(sum(cases.values()), len(cases))},
        "hard_gate_failures": [],
    }
