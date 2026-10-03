"""Shared pieces for the real eval suites: dataset loading, per-case LLM calls, ops metrics."""
from __future__ import annotations

import json
from collections import Counter
from contextlib import contextmanager
from pathlib import Path

import yaml

from evals.metrics import percentile
from llm import cassette
from llm.client import collect_calls

EVALS_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = EVALS_DIR / "data"
PRICES = EVALS_DIR / "prices.yaml"


def load_rows(name: str, split: str) -> list[dict]:
    path = DATA_DIR / f"{name}.jsonl"
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    return [row for row in rows if row["split"] == split]


@contextmanager
def case(suite: str, case_id: str):
    """Route the case's LLM calls to the suite cassette and collect them."""
    with cassette.cassette_scope(suite, case=case_id), collect_calls() as calls:
        yield calls


def _prices() -> dict:
    return (yaml.safe_load(PRICES.read_text(encoding="utf-8")) or {}).get("models", {})


def _cost(result, prices) -> float | None:
    price = prices.get(result.model.removesuffix(":free"))
    if price is None:
        return None
    usage = result.usage or {}
    return ((usage.get("prompt") or 0) * price["prompt"] + (usage.get("completion") or 0) * price["completion"]) / 1e6


def ops_metrics(calls_per_case: dict[str, list]) -> dict:
    """Latency, tokens and list-price cost per question, from the recorded calls (labelled as recorded)."""
    prices = _prices()
    latencies, tokens, costs, models, unpriced = [], [], [], Counter(), set()
    for calls in calls_per_case.values():
        if not calls:
            continue
        latencies.append(round(sum(c.latency_s for c in calls), 3))
        tokens.append(sum((c.usage or {}).get("prompt") or 0 for c in calls)
                      + sum((c.usage or {}).get("completion") or 0 for c in calls))
        case_cost = 0.0
        for c in calls:
            models[c.model] += 1
            cost = _cost(c, prices)
            if cost is None:
                unpriced.add(c.model)
            else:
                case_cost += cost
        costs.append(case_cost)
    n = len(latencies)
    return {
        "questions_with_llm_calls": n,
        "llm_calls": sum(models.values()),
        "latency_s_recorded": {"p50": percentile(latencies, 50), "p95": percentile(latencies, 95)},
        "tokens_per_question_mean": round(sum(tokens) / n, 1) if n else None,
        "cost_usd_per_question_list_price": round(sum(costs) / n, 6) if n else None,
        "models": dict(sorted(models.items())),
        "unpriced_models": sorted(unpriced),
    }
