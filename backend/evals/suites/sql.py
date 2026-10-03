"""Text-to-SQL suite: the current Ask Lumen SQL agent against the 50 gold questions (SPEC-EVAL, EVAL-03).

Runs `SQLAgent.query` end to end on a throwaway SQLite copy of the synthetic world, with the prompt's
"today" pinned to AS_OF so recorded prompts never change. A case passes when the agent's rows equal the
gold rows (strict: same columns, multiset, ordered only if the gold has ORDER BY) and no fallback was used.
Unanswerable questions are reported separately; they don't count towards execution accuracy.
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from unittest import mock

from sqlalchemy import create_engine, text

from evals.generator.db import load_world
from evals.generator.world import AS_OF, build_world
from evals.metrics import rate, result_sets_contain, result_sets_equal
from evals.suites.common import case, load_rows, ops_metrics
from llm.cassette import CassetteMiss
from llm.errors import LLMError

SUITE = "sql"


def _rows(result) -> list:
    return [tuple(r.values()) for r in (result or {}).get("data") or []]


def run(tier: str, split: str) -> dict:
    from ai.sql_agent import SQLAgent

    world = build_world(42)
    users = {u["key"]: u["id"] for u in world["users"]}
    db_path = Path(tempfile.mkdtemp(prefix="lumen-eval-sql-")) / "world.db"
    engine = create_engine(f"sqlite:///{db_path}")
    load_world(engine, world)
    agent = SQLAgent(db_path=str(db_path))

    cases, relaxed, fallbacks, errors, misses, calls = {}, 0, 0, [], [], {}
    unanswerable = {"total": 0, "fallback": 0, "answered": 0}
    with mock.patch.object(SQLAgent, "_today", staticmethod(lambda: AS_OF.isoformat())):
        for row in load_rows(SUITE, split):
            uid = users[row["user"]]
            try:
                with case(SUITE, row["id"]) as made:
                    result = agent.query(row["question"], uid)
            except CassetteMiss as miss:
                misses.append(f"cassette miss: {miss}")
                continue
            except LLMError as e:  # the provider failed for the whole chain: the user got an error
                result = None
                errors.append(f"{row['id']}: {e.kind}")
            calls[row["id"]] = made
            fallback = result is not None and "note" in result
            if not row["gold_sql"]:
                unanswerable["total"] += 1
                unanswerable["fallback" if fallback or result is None else "answered"] += 1
                continue
            with engine.connect() as conn:
                gold = [tuple(r) for r in conn.execute(text(row["gold_sql"].replace("{user_id}", uid)))]
            ordered = "ORDER BY" in row["gold_sql"].upper()
            pred = _rows(result)
            ok = result is not None and not fallback and result_sets_equal(gold, pred, ordered=ordered)
            cases[row["id"]] = ok
            fallbacks += fallback
            relaxed += result is not None and not fallback and result_sets_contain(gold, pred, ordered=ordered)
    engine.dispose()

    n = len(cases)
    return {
        "cases": cases,
        "metrics": {
            "execution_accuracy": rate(sum(cases.values()), n),
            "fallback_rate": rate(fallbacks, n),
            "relaxed_accuracy_diagnostic": rate(relaxed, n),
            "provider_errors": errors,
            "unanswerable": unanswerable,
            "ops": ops_metrics(calls),
            "as_of": AS_OF.isoformat(),
        },
        "hard_gate_failures": misses,
    }
