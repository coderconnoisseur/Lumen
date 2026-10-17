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
    assert any("SQLite" in note for note in out["notes"]) and not any("PostgreSQL" in note for note in out["notes"])


def test_system_prompt_lists_every_queryable_column():
    """The model guessed `amount`, `vendor` and a `vendors` table before calling get_schema; the prompt now
    carries the real columns, generated from the models. user_id is left out: the server scopes every query."""
    from agent.prompts import _NOT_IN_PROMPT, system_prompt
    from evals.generator.world import AS_OF
    from models import Transaction, TransactionItem

    prompt = system_prompt(AS_OF)
    for model in (Transaction, TransactionItem):
        for col in model.__table__.columns:
            assert (col.name in prompt) == (col.name not in _NOT_IN_PROMPT), col.name
    assert AS_OF.isoformat() in prompt


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
    assert "other than the authenticated" in stolen["error"]  # the reason goes back to the model


def test_run_sql_needs_no_user_filter_because_the_server_scopes_it(db, world):
    """The model never sees the user id; unfiltered queries still only see the context user's rows."""
    from agent.tools import run_tool

    u1 = {u["key"]: u["id"] for u in world["users"]}["u1"]
    out = run_tool(_ctx(db, world), "run_sql", {"sql": "SELECT COUNT(*) AS n FROM transactions"})
    assert out["rows"][0]["n"] == sum(t["user_id"] == u1 for t in world["transactions"]) < len(world["transactions"])
    names = run_tool(_ctx(db, world), "run_sql", {"sql": "SELECT DISTINCT vendor_name FROM transactions"})
    assert "Lotus Yoga Studio" not in {r["vendor_name"] for r in names["rows"]}  # u2-only vendor


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


def test_anomalies_name_the_transaction_and_use_the_app_currency(db, world):
    """The detector returns transaction ids; the tool showed vendor/date/amount as null and amounts in euros."""
    from agent.tools import run_tool

    found = run_tool(_ctx(db, world, "u2"), "get_anomalies", "{}")["anomalies"]
    assert found
    for a in found:
        assert a["vendor"] and a["date"] and a["amount"] is not None
        assert "€" not in " ".join(a["reasons"])


def test_system_prompt_without_a_profile_is_unchanged():
    """The recorded agent evals run without a profile, so their prompt must stay byte-for-byte the same."""
    from datetime import date

    from agent.prompts import SYSTEM_PROMPT, _schema, system_prompt

    assert system_prompt(date(2026, 10, 14)) == SYSTEM_PROMPT.format(today="2026-10-14", schema=_schema())


def test_system_prompt_has_the_honesty_rules():
    from datetime import date

    from agent.prompts import system_prompt

    text = system_prompt(date(2026, 10, 16))
    assert "can't remember" in text and "may be out of date" in text
    assert "where the user's data starts and ends" in text and "currency" not in text
    assert "doesn't track account balances or savings pots yet" in text


def test_system_prompt_with_a_profile_uses_its_currency_and_context():
    from datetime import date

    from agent.prompts import system_prompt

    text = system_prompt(date(2026, 10, 14), {"display_name": "Asha", "currency": "CHF", "use_case": "household",
                                              "goals": ["stay_on_budget"], "monthly_budget": 4000,
                                              "monthly_income": None})
    assert "Amounts are in CHF unless" in text and "INR" not in text
    assert "Asha" in text and "household" in text and "stay on budget" in text and "4000" in text


def test_exchange_rate_ok(db, world, monkeypatch):
    from agent import tools
    from agent.tools import run_tool

    class R:
        def json(self): return {"amount": 1.0, "base": "USD", "date": "2026-10-13", "rates": {"INR": 83.1}}
        def raise_for_status(self): pass
    monkeypatch.setattr(tools.requests, "get", lambda *a, **k: R())
    out = run_tool(_ctx(db, world), "exchange_rate", {"base": "usd", "quote": "inr"})
    assert out == {"base": "USD", "quote": "INR", "rate": 83.1, "date": "2026-10-13",
                   "source": "ECB reference rate (Frankfurter)"}


def test_exchange_rate_service_down(db, world, monkeypatch):
    from agent import tools
    from agent.tools import run_tool

    def boom(*a, **k): raise tools.requests.RequestException("down")
    monkeypatch.setattr(tools.requests, "get", boom)
    assert "error" in run_tool(_ctx(db, world), "exchange_rate", {"base": "USD", "quote": "INR"})


def test_exchange_rate_bad_code_rejected(db, world):
    from agent.tools import run_tool
    assert "error" in run_tool(_ctx(db, world), "exchange_rate", {"base": "DOLLARS", "quote": "INR"})


def test_split_follow_up():
    from agent.graph import split_follow_up
    assert split_follow_up("You spent 500.\nNext: Which vendor was it?") == ("You spent 500.", "Which vendor was it?")
    assert split_follow_up("No suggestion here.") == ("No suggestion here.", None)
    assert split_follow_up("Next: a\nmore\nnext:  b ") == ("Next: a\nmore", "b")
    assert split_follow_up("A.\n**Next:** Which?") == ("A.", "Which?")
    assert split_follow_up("A.\n**Next: Which?**") == ("A.", "Which?")
    assert split_follow_up("We do this next: tomorrow.") == ("We do this next: tomorrow.", None)
    # seen in production: a bare "Next:", and Lumen asking the user (a chip would send its own question back to it)
    assert split_follow_up("Which period?\nNext:") == ("Which period?", None)
    # seen live after release #84: more ways Lumen talks to the user in a "Next:" line
    for lumen in ("you could ask me to show duplicates", "tell me which subscription to cancel",
                  "If you'd like a breakdown, ask", "You can ask for last month"):
        assert split_follow_up(f"Done.\nNext: {lumen}")[1] is None
    assert split_follow_up("Done.\nNext: Tell me my top vendors")[1] == "Tell me my top vendors"
    assert split_follow_up("Here it is.\nNext: Would you like last month or the last three?") == (
        "Here it is.\n\nWould you like last month or the last three?", None)
    assert split_follow_up("Done.\nNext: Can I afford a trip in December?") == (
        "Done.", "Can I afford a trip in December?")  # the user's own voice stays a chip
    assert split_follow_up("Here.\n\nNext:\n\n*“Show the old regime too”*") == ("Here.", "Show the old regime too")
    assert split_follow_up("Here.\nNext: “Show my phone spending”") == ("Here.", "Show my phone spending")
    # seen in production: the model put it on the answer's line
    assert split_follow_up("I don't have that information. Next: Which vendor?") == (
        "I don't have that information.", "Which vendor?")


def test_exchange_rate_malformed_reply_is_an_error(db, world, monkeypatch):
    from agent import tools
    from agent.tools import run_tool

    class R:
        def json(self): return {"date": "2026-10-13", "rates": None}
        def raise_for_status(self): pass
    monkeypatch.setattr(tools.requests, "get", lambda *a, **k: R())
    assert "error" in run_tool(_ctx(db, world), "exchange_rate", {"base": "USD", "quote": "INR"})


def test_run_tool_turns_unexpected_errors_into_data_but_lets_llm_errors_through(db, world, monkeypatch):
    from dataclasses import replace

    from agent import tools
    from agent.tools import run_tool
    from llm.errors import LLMError

    def boom(exc):
        def run(ctx, args): raise exc
        return run
    ctx = _ctx(db, world)
    monkeypatch.setitem(tools.TOOLS, "lookup_vendors", replace(tools.TOOLS["lookup_vendors"], run=boom(RuntimeError("db down"))))
    assert run_tool(ctx, "lookup_vendors", {})["error"].startswith("lookup_vendors failed: db down")
    monkeypatch.setitem(tools.TOOLS, "lookup_vendors", replace(tools.TOOLS["lookup_vendors"], run=boom(LLMError(LLMError.AUTH, "x"))))
    with pytest.raises(LLMError):
        run_tool(ctx, "lookup_vendors", {})


def test_get_recurring_finds_the_users_bills_and_subscriptions_but_not_shopping(db, world):
    from agent.tools import run_tool

    out = run_tool(_ctx(db, world), "get_recurring", "{}")
    by_vendor = {r["vendor"]: r for r in out["recurring"]}
    assert by_vendor["City Power Ltd"]["kind"] == "bill" and by_vendor["City Power Ltd"]["cadence"] == "monthly"
    assert by_vendor["City Power Ltd"]["next_due_date"] > "2026-06-30"
    assert by_vendor["StreamFlix"]["kind"] == "subscription"
    assert "Lotus Yoga Studio" not in by_vendor  # u2's vendor: the tool only sees the context user's rows
    assert not any(r["category"] == "Groceries" for r in out["recurring"])


# --- get_overview: a fresh database per test, rows relative to a fixed today ---------------------------------

def _overview(rows, profile=None, uid="me"):
    """rows: (user_id, date, vendor, category, amount). Runs get_overview with today = 2026-10-17."""
    from datetime import date

    from agent.tools import ToolContext, run_tool
    from models.database import db as flask_db

    engine = create_engine("sqlite://")
    flask_db.metadata.create_all(engine, tables=[flask_db.metadata.tables["transactions"]])
    with engine.begin() as conn:
        for i, (u, d, v, c, a) in enumerate(rows):
            conn.execute(text("INSERT INTO transactions (id, user_id, date, vendor_name, category, total_amount) "
                              "VALUES (:i, :u, :d, :v, :c, :a)"), {"i": str(i), "u": u, "d": d, "v": v, "c": c, "a": a})
    ctx = ToolContext(user_id=uid, engine=engine, sql_agent=None, today=date(2026, 10, 17), profile=profile)
    return run_tool(ctx, "get_overview", "{}")


def test_overview_shows_empty_months_and_where_data_ends():
    out = _overview([("me", "2026-05-03", "Shop", "Groceries", 100), ("me", "2026-07-20", "Shop", "Groceries", 200)])
    months = out["months"]
    assert [m["month"] for m in months] == ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]
    assert [m["has_data"] for m in months] == [True, False, True, False, False, False]
    assert months[2]["spend"] == 200 and months[2]["transactions"] == 1
    assert out["data"]["last_date"] == "2026-07-20" and "2026-07-20" in out["data"]["note"]
    assert out["missing"] == ["account balances (Lumen does not track them)"]


def test_overview_savings_null_without_income():
    rows = [("me", "2026-10-05", "Rent Co", "Rent", 50000)]
    out = _overview(rows, profile={"monthly_budget": 60000})
    assert out["income"] is None and all(m["savings"] is None for m in out["months"])
    assert out["months"][-1]["budget_left"] == 10000
    out = _overview(rows, profile={"monthly_income": 120000})
    assert out["months"][-1]["savings"] == 70000 and "estimate" in out["income"]["source"]


def test_overview_fits_the_tool_limit():
    rows = [("me", f"2026-{m:02d}-{(v % 17) + 1:02d}", f"Vendor {v}", f"Category {v % 30}", 100 + v)
            for m in range(1, 11) for v in range(60)]
    out = _overview(rows, profile={"monthly_income": 120000, "monthly_budget": 60000})
    assert len(json.dumps(out)) < 3000, len(json.dumps(out))
    assert all(len(m["by_category"]) <= 6 for m in out["months"])
    huge = [("me", f"2026-{m:02d}-{(v % 17) + 1:02d}", f"Vendor with a long long name {v}",
             f"Category {v % 30} with a long long name", 1_000_000.5 + v * 137.3) for m in range(1, 11) for v in range(60)]
    assert len(json.dumps(_overview(huge, profile={"monthly_income": 1200000.75, "monthly_budget": 600000.3}))) < 3000


def test_overview_for_a_user_with_no_data():
    out = _overview([])
    assert out["data"]["transactions"] == 0 and out["data"]["first_date"] is None
    assert len(out["months"]) == 6 and not any(m["has_data"] for m in out["months"])
    assert out["this_month_vs_last"]["change_pct"] is None


def test_overview_is_user_scoped():
    mine = [("me", "2026-10-02", "Shop", "Groceries", 300)]
    assert _overview(mine) == _overview(mine + [("other", "2026-10-03", "Shop", "Groceries", 999)])


def test_system_prompt_honesty_rules_v2():
    from datetime import date

    from agent.prompts import system_prompt

    text = system_prompt(date(2026, 10, 17))
    assert "get_overview" in text and "Cite only" in text and "[web:n]" in text and "income you entered" in text
    assert "currency" not in text
