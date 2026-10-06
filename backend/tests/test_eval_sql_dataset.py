"""EVAL-02: the text-to-SQL questions, their split, and the gold-SQL dialect check (SPEC-EVAL)."""
import os
import re
from collections import Counter

import pytest
from sqlalchemy import create_engine, text

PG_URL = os.getenv("LUMEN_TEST_POSTGRES_URL")
TAGS = {"agg", "filter", "date", "join", "unanswerable"}
NOT_NEUTRAL = re.compile(
    r"strftime|::|\bilike\b|\bround\s*\(|\bdate\s*\(|\bnow\s*\(|current_date|extract\s*\(|date_trunc|julianday"
    r"|\binterval\b|\bto_char\b",
    re.IGNORECASE,
)


@pytest.fixture(scope="module")
def world():
    from evals.generator.world import build_world

    return build_world(seed=42)


@pytest.fixture(scope="module")
def rows():
    from evals.generator.sql_questions import rows

    return rows()


def _answerable(rows):
    return [r for r in rows if r["gold_sql"]]


def _gold(row, world):
    uid = {u["key"]: u["id"] for u in world["users"]}[row["user"]]
    return row["gold_sql"].replace("{user_id}", uid), uid


def _run(engine, sql):
    with engine.connect() as conn:
        return [tuple(r) for r in conn.execute(text(sql))]


@pytest.fixture(scope="module")
def sqlite_engine(world, tmp_path_factory):
    from evals.generator.db import load_world

    engine = create_engine(f"sqlite:///{tmp_path_factory.mktemp('sql') / 'eval.db'}")
    load_world(engine, world)
    return engine


def test_fifty_questions_with_the_spec_schema(rows):
    assert len(rows) == 50
    assert len({r["id"] for r in rows}) == 50
    for r in rows:
        assert set(r) == {"id", "question", "gold_sql", "tags", "user"}
        assert set(r["tags"]) <= TAGS and r["tags"]
        assert r["user"] in {"u1", "u2"}
        assert (r["gold_sql"] is None) == ("unanswerable" in r["tags"])
    assert {r["tags"][0] for r in rows} == TAGS


def test_gold_sql_is_dialect_neutral(rows):
    for r in _answerable(rows):
        assert not NOT_NEUTRAL.search(r["gold_sql"]), r["id"]
        assert "user_id = '{user_id}'" in r["gold_sql"], r["id"]


def test_gold_sql_returns_rows_on_the_generated_world(rows, world, sqlite_engine):
    for r in _answerable(rows):
        result = _run(sqlite_engine, _gold(r, world)[0])
        assert result and all(v is not None for v in result[0]), r["id"]


def test_gold_sql_passes_the_apps_own_checks_unchanged(rows, world, sqlite_engine):
    """A model that wrote the gold query would get the gold result through the real guardrails."""
    from ai.sql_agent import _scope_to_user, _validate_sql
    from evals.metrics import result_sets_equal

    for r in _answerable(rows):
        sql, uid = _gold(r, world)
        scoped = _scope_to_user(_validate_sql(sql, uid), uid, "sqlite")
        ordered = "ORDER BY" in sql.upper()
        assert result_sets_equal(_run(sqlite_engine, sql), _run(sqlite_engine, scoped), ordered=ordered), r["id"]


def test_split_is_seeded_stratified_and_about_thirty_percent(rows):
    from evals.generator.splits import assign_splits

    split = assign_splits(rows, lambda r: r["tags"][0], seed=42, name="sql")
    assert split == assign_splits(rows, lambda r: r["tags"][0], seed=42, name="sql")
    assert split != assign_splits(rows, lambda r: r["tags"][0], seed=7, name="sql")
    counts = Counter((r["tags"][0], r["split"]) for r in split)
    for tag in TAGS:
        n = counts[(tag, "dev")] + counts[(tag, "test")]
        assert counts[(tag, "test")] == round(n * 0.3), tag
    assert 13 <= sum(r["split"] == "test" for r in split) <= 17


@pytest.mark.skipif(not PG_URL, reason="set LUMEN_TEST_POSTGRES_URL to run the gold SQL on Postgres")
def test_gold_sql_gives_identical_results_on_sqlite_and_postgres(rows, world, sqlite_engine):
    from evals.generator.db import load_world
    from evals.metrics import result_sets_equal

    pg = create_engine(PG_URL)
    load_world(pg, world)
    for r in _answerable(rows):
        sql = _gold(r, world)[0]
        ordered = "ORDER BY" in sql.upper()
        assert result_sets_equal(_run(sqlite_engine, sql), _run(pg, sql), ordered=ordered), r["id"]
