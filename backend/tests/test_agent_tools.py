"""AGT-01: the agent's tools on the synthetic world (no LLM). The user id always comes from the context."""
import json

import pytest
from sqlalchemy import create_engine, text


@pytest.fixture(scope="module")
def world():
    from evals.generator.world import build_world

    return build_world(42)


@pytest.fixture(scope="module")
def db(world, tmp_path_factory):
    import models  # noqa: F401
    from evals.generator.db import load_world
    from models.database import db as flask_db

    path = tmp_path_factory.mktemp("agent") / "world.db"
    engine = create_engine(f"sqlite:///{path}")
    load_world(engine, world)
    flask_db.metadata.create_all(engine, tables=[flask_db.metadata.tables[t] for t in ("proposals", "audit_events")])
    return path, engine


def _ctx(db, world, key="u1"):
    from agent.tools import ToolContext
    from ai.sql_agent import SQLAgent
    from evals.generator.world import AS_OF

    path, engine = db
    uid = {u["key"]: u["id"] for u in world["users"]}[key]
    return ToolContext(user_id=uid, engine=engine, sql_agent=SQLAgent(db_path=str(path)), today=AS_OF)


def test_no_tool_lets_the_model_choose_the_user():
    from agent.tools import tool_schemas

    for schema in tool_schemas():
        props = schema["function"]["parameters"].get("properties", {})
        assert not any("user" in p.lower() for p in props), schema["function"]["name"]
        assert "title" not in json.dumps(schema["function"]["parameters"])


def test_schema_is_generated_from_the_models(db, world):
    from agent.tools import run_tool

    out = run_tool(_ctx(db, world), "get_schema", "{}")
    assert "vendor_name" in out["tables"]["transactions"] and "item_name" in out["tables"]["transaction_items"]
    assert any("2026-06-30" in note for note in out["notes"])


def test_lookup_vendors_finds_the_electricity_vendor_by_what_was_bought(db, world):
    """The baseline's wrong answer: the model guessed '%electric%' for "City Power Ltd"."""
    from agent.tools import run_tool

    vendors = run_tool(_ctx(db, world), "lookup_vendors", {"hint": "electricity"})["vendors"]
    assert vendors[0]["vendor"] == "City Power Ltd" and vendors[0]["category"] == "Utilities"
    assert all("Lotus Yoga Studio" != v["vendor"] for v in run_tool(_ctx(db, world), "lookup_vendors", {})["vendors"])


def test_run_sql_is_scoped_to_the_context_user(db, world):
    from agent.tools import run_tool

    u2 = {u["key"]: u["id"] for u in world["users"]}["u2"]
    ok = run_tool(_ctx(db, world), "run_sql",
                  {"sql": "SELECT COUNT(*) AS n FROM transactions WHERE user_id = '{user_id}'"})
    assert ok["row_count"] == 1 and ok["rows"][0]["n"] > 100
    stolen = run_tool(_ctx(db, world), "run_sql", {"sql": f"SELECT vendor_name FROM transactions WHERE user_id = '{u2}'"})
    assert "error" in stolen or stolen["row_count"] == 0


def test_get_invoice_only_sees_the_users_own_invoices(db, world):
    from agent.tools import run_tool

    ids = {u["key"]: u["id"] for u in world["users"]}
    mine = next(t for t in world["transactions"] if t["user_id"] == ids["u1"])
    theirs = next(t for t in world["transactions"] if t["user_id"] == ids["u2"])
    found = run_tool(_ctx(db, world), "get_invoice", {"invoice_number": mine["invoice_number"].lower()})
    assert found["found"] and found["invoice"]["vendor_name"] == mine["vendor_name"] and found["items"]
    assert run_tool(_ctx(db, world), "get_invoice", {"invoice_number": theirs["invoice_number"]}) == {
        "found": False, "invoice_number": theirs["invoice_number"]}


def test_anomalies_and_forecast_use_the_pinned_today(db, world):
    from agent.tools import run_tool

    anomalies = run_tool(_ctx(db, world), "get_anomalies", {})
    assert anomalies["transactions_checked"] > 10 and isinstance(anomalies["anomalies"], list)
    fc = run_tool(_ctx(db, world), "forecast", {"months": 2})
    assert [h["month"] for h in fc["history"]] == ["2025-12", "2026-01", "2026-02", "2026-03", "2026-04", "2026-05"]
    assert [p["month"] for p in fc["projection"]] == ["2026-06", "2026-07"]
    assert all(h["total"] > 0 for h in fc["history"])


def test_propose_action_files_a_pending_proposal_and_changes_nothing_else(db, world):
    from agent.tools import run_tool

    ctx = _ctx(db, world)
    with ctx.engine.connect() as conn:
        before = conn.execute(text("SELECT COUNT(*), SUM(total_amount) FROM transactions")).one()
    out = run_tool(ctx, "propose_action", {"type": "flag_invoice", "target": "CP-202606-U1N18", "risk": "medium",
                                           "reason": "Total doesn't match line items.", "evidence": ["sql"]})
    assert out["status"] == "pending"
    with ctx.engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*), SUM(total_amount) FROM transactions")).one() == before
        row = conn.execute(text("SELECT user_id, status, risk FROM proposals WHERE id = :i"), {"i": out["proposal_id"]}).one()
        audit = conn.execute(text("SELECT actor, action FROM audit_events WHERE proposal_id = :i"), {"i": out["proposal_id"]}).one()
    assert tuple(row) == (ctx.user_id, "pending", "medium") and tuple(audit) == ("agent", "proposal_created")


def test_bad_arguments_and_unknown_tools_come_back_as_errors(db, world):
    from agent.tools import run_tool

    assert "invalid arguments" in run_tool(_ctx(db, world), "forecast", {"months": 99})["error"]
    assert "invalid arguments" in run_tool(_ctx(db, world), "run_sql", "{not json")["error"]
    assert "unknown tool" in run_tool(_ctx(db, world), "delete_everything", {})["error"]
    assert "unavailable" in run_tool(_ctx(db, world), "search_documents", {"query": "fees"})["error"]
