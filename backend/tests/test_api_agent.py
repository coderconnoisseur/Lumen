"""Agent API (SPEC-AGENT): ask, list proposals, approve/reject with audit. Scripted model, no LLM calls."""
import json

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from llm.client import LLMResult


def bearer(sub):
    return {"Authorization": "Bearer " + jwt.encode({"sub": sub}, "k" * 32, algorithm="HS256")}


def _call(name, args, cid):
    return {"id": cid, "type": "function", "function": {"name": name, "arguments": json.dumps(args)}}


@pytest.fixture
def setup(tmp_path, monkeypatch):
    import models  # noqa: F401
    import utils.auth
    from ai.sql_agent import SQLAgent
    from api import agent as agent_api
    from asgi import create_app
    from evals.generator.db import load_world
    from evals.generator.world import AS_OF, build_world
    from models.database import db as flask_db
    from utils.limiter import limiter

    world = build_world(42)
    path = tmp_path / "w.db"
    engine = create_engine(f"sqlite:///{path}")
    load_world(engine, world)
    flask_db.metadata.create_all(engine, tables=[flask_db.metadata.tables[t] for t in ("proposals", "audit_events")])
    u1, u2 = (u["id"] for u in world["users"])
    invoice = next(t for t in world["transactions"] if t["user_id"] == u1 and t["category"] == "Groceries")

    replies = []

    def complete(messages, **kwargs):
        return replies.pop(0)

    monkeypatch.setattr(utils.auth, "verify_token",
                        lambda token: {"sub": jwt.decode(token, options={"verify_signature": False})["sub"]})
    monkeypatch.setattr(limiter, "enabled", False)
    deps = agent_api.AgentDeps(engine=engine, sql_agent=SQLAgent(db_path=str(path)), complete=complete, today=AS_OF)
    app = create_app(agent_api.router)
    app.dependency_overrides[agent_api.get_agent_deps] = lambda: deps
    return TestClient(app), replies, engine, u1, u2, invoice


def test_ask_returns_the_answer_steps_and_sql(setup):
    client, replies, _, u1, _, _ = setup
    replies += [LLMResult(text="", tool_calls=[_call("run_sql", {"sql": "SELECT COUNT(*) AS n FROM transactions "
                                                                       "WHERE user_id = '{user_id}'"}, "a")],
                          provider="fake", model="fake"),
                LLMResult(text="You have 235 transactions.", tool_calls=None, provider="fake", model="fake")]
    out = client.post("/api/agent/ask", headers=bearer(u1), json={"question": "How many transactions?"}).json()
    assert out["success"] and out["answer"] == "You have 235 transactions."
    assert out["steps"][0]["tool"] == "run_sql" and out["sql"] and out["stopped"] == "answered"


def test_proposals_wait_for_a_human_and_approval_is_audited(setup):
    client, replies, engine, u1, u2, invoice = setup
    replies += [LLMResult(text="", tool_calls=[_call("propose_action", {
                    "type": "update_category", "target": invoice["invoice_number"], "risk": "low",
                    "reason": "This vendor sells household goods.", "payload": {"category": "Shopping"}}, "p")],
                          provider="fake", model="fake"),
                LLMResult(text="I've filed a proposal to change the category.", tool_calls=None,
                          provider="fake", model="fake")]
    out = client.post("/api/agent/ask", headers=bearer(u1), json={"question": "Recategorise it"}).json()
    pid = out["proposals"][0]

    def category():
        with engine.connect() as conn:
            return conn.execute(text("SELECT category FROM transactions WHERE id = :i"), {"i": invoice["id"]}).scalar()

    assert category() == "Groceries"  # proposing changes nothing
    pending = client.get("/api/agent/proposals?status=pending", headers=bearer(u1)).json()["proposals"]
    assert [p["id"] for p in pending] == [pid]
    assert client.get("/api/agent/proposals", headers=bearer(u2)).json()["proposals"] == []
    assert client.post(f"/api/agent/proposals/{pid}/approve", headers=bearer(u2)).status_code == 404

    approved = client.post(f"/api/agent/proposals/{pid}/approve", headers=bearer(u1)).json()
    assert approved["proposal"]["status"] == "approved" and approved["applied"]["transactions_updated"] == 1
    assert category() == "Shopping"
    assert client.post(f"/api/agent/proposals/{pid}/reject", headers=bearer(u1)).status_code == 409
    with engine.connect() as conn:
        actions = [r[0] for r in conn.execute(text(
            "SELECT action FROM audit_events WHERE proposal_id = :p ORDER BY id"), {"p": pid})]
    assert actions == ["proposal_created", "proposal_approved"]


def test_rejecting_changes_nothing(setup):
    client, replies, engine, u1, _, invoice = setup
    replies += [LLMResult(text="", tool_calls=[_call("propose_action", {
                    "type": "update_category", "target": invoice["invoice_number"], "risk": "low",
                    "reason": "test", "payload": {"category": "Other"}}, "p")], provider="fake", model="fake"),
                LLMResult(text="Filed.", tool_calls=None, provider="fake", model="fake")]
    pid = client.post("/api/agent/ask", headers=bearer(u1), json={"question": "x"}).json()["proposals"][0]
    assert client.post(f"/api/agent/proposals/{pid}/reject", headers=bearer(u1)).json()["proposal"]["status"] == "rejected"
    with engine.connect() as conn:
        assert conn.execute(text("SELECT category FROM transactions WHERE id = :i"), {"i": invoice["id"]}).scalar() == "Groceries"


def test_ask_requires_auth(setup):
    client = setup[0]
    r = client.post("/api/agent/ask", json={"question": "hi"})
    assert r.status_code == 401 and r.json()["code"] == "missing_token"
