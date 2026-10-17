"""The agent's run_sql on SQLite (tests) and Postgres (production). Live, the first query often failed on Postgres
with a bare "Query execution failed", so the model couldn't tell what to fix (2026-10-16)."""
import os

import pytest
from sqlalchemy import create_engine

PG_URL = os.getenv("LUMEN_TEST_POSTGRES_URL")


@pytest.fixture(scope="module")
def world():
    from evals.generator.world import build_world

    return build_world(42)


@pytest.fixture(params=["sqlite", "postgresql"])
def ctx(request, world, tmp_path, monkeypatch):
    from agent.tools import ToolContext
    from ai.sql_agent import SQLAgent
    from config import Config
    from evals.generator.db import load_world
    from evals.generator.world import AS_OF

    if request.param == "postgresql":
        if not PG_URL:
            pytest.skip("set LUMEN_TEST_POSTGRES_URL to run the agent's SQL on Postgres")
        url, path = PG_URL, None
        monkeypatch.setattr(Config, "DATABASE_URI", PG_URL)
    else:
        path = tmp_path / "world.db"
        url = f"sqlite:///{path}"
    engine = create_engine(url)
    load_world(engine, world)
    agent = SQLAgent(db_path=str(path) if path else None)
    assert agent.dialect == request.param
    uid = {u["key"]: u["id"] for u in world["users"]}["u1"]
    yield ToolContext(user_id=uid, engine=engine, sql_agent=agent, today=AS_OF)
    agent.engine.dispose()
    engine.dispose()


@pytest.mark.parametrize("sql", [
    # Postgres has no ROUND(double precision, integer); every money column is double precision.
    "SELECT category, ROUND(SUM(total_amount), 2) AS spent FROM transactions GROUP BY category",
    "SELECT ti.item_name, ROUND(SUM(ti.total_price), 2) AS spent FROM transaction_items ti "
    "JOIN transactions t ON t.id = ti.transaction_id GROUP BY ti.item_name",
    # The textual table check read `FROM date` as a table.
    "SELECT SUBSTRING(date FROM 1 FOR 7) AS month, SUM(total_amount) AS spent FROM transactions GROUP BY 1",
])
def test_common_queries_run_on_both_databases(ctx, sql):
    from agent.tools import run_tool

    out = run_tool(ctx, "run_sql", {"sql": sql})
    assert "error" not in out, out
    assert out["row_count"] > 0 and all(v is not None for v in out["rows"][0].values())


def test_a_database_error_reaches_the_model_without_the_user_id(ctx):
    from agent.tools import run_tool

    out = run_tool(ctx, "run_sql", {"sql": "SELECT no_such_column FROM transactions"})
    assert "no_such_column" in out["error"], out
    assert ctx.user_id not in str(out) and "public." not in out["error"] and "main." not in out["error"]


@pytest.mark.parametrize("sql", [
    "SELECT status, COUNT(*) AS n FROM review_items GROUP BY status",
    "SELECT r.id, t.vendor_name FROM review_items r JOIN transactions t ON t.id = r.transaction_id",
    "SELECT title FROM insights WHERE is_read = false ORDER BY created_at DESC",
    "SELECT title, filename FROM documents WHERE id IN (SELECT id FROM documents)",
])
def test_the_review_queue_insights_and_documents_are_readable(ctx, sql):
    from agent.tools import run_tool
    from models.database import db

    db.metadata.create_all(ctx.engine, tables=[db.metadata.tables[t] for t in ("review_items", "insights", "documents")])
    out = run_tool(ctx, "run_sql", {"sql": sql})
    assert "error" not in out, out
