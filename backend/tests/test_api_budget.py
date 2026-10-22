"""UI revamp Phase 3: the budget API, set_budget proposals (draft -> approve -> budgets row) and the agent tool."""
from datetime import date

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, func, select
from sqlalchemy.orm import Session

A = "7a1c0000-0000-4000-8000-0000000000aa"
B = "7a1c0000-0000-4000-8000-0000000000bb"


def bearer(sub):
    return {"Authorization": "Bearer " + jwt.encode({"sub": sub, "email": f"{sub}@x.com"}, "k" * 32, algorithm="HS256")}


def months_back(n):
    """'YYYY-MM-10' for n complete months before the current one."""
    t = date.today()
    y, m = divmod(t.year * 12 + t.month - 1 - n, 12)
    return f"{y}-{m + 1:02d}-10"


@pytest.fixture
def setup(tmp_path, monkeypatch):
    import models  # noqa: F401
    import utils.auth
    from api import agent as agent_api
    from api import budget
    from asgi import create_app
    from models.database import db as flask_db
    from utils.limiter import limiter

    monkeypatch.setattr(utils.auth, "verify_token", lambda t: jwt.decode(t, options={"verify_signature": False}))
    monkeypatch.setattr(limiter, "enabled", False)
    engine = create_engine(f"sqlite:///{tmp_path / 'b.db'}")
    flask_db.metadata.create_all(engine)
    app = create_app(budget.router, agent_api.router)
    app.dependency_overrides[budget.get_engine] = lambda: engine
    app.dependency_overrides[agent_api.get_agent_deps] = lambda: agent_api.AgentDeps(engine=engine, sql_agent=None)
    return TestClient(app), engine


def seed(engine, user, rows):
    from models import Transaction

    with Session(engine) as s, s.begin():
        for i, (d, amount, category) in enumerate(rows):
            s.add(Transaction(user_id=user, vendor_name=f"V{i}", invoice_number=f"{user}-{i}", date=d,
                              total_amount=amount, category=category))


def history(engine, user):
    seed(engine, user, [(months_back(n), 4000, "Food") for n in (1, 2, 3)]
         + [(months_back(n), 1200, "Travel") for n in (1, 2, 3)])


def test_get_budget_empty(setup):
    c, _ = setup
    assert c.get("/api/budget", headers=bearer(A)).json() == {
        "success": True, "month": date.today().strftime("%Y-%m"), "monthly_budget": None, "spent": 0, "categories": []}


def test_put_then_get(setup):
    c, engine = setup
    seed(engine, A, [(date.today().strftime("%Y-%m-01"), 750, "food")])
    body = c.put("/api/budget", headers=bearer(A),
                 json={"monthly_budget": 28000, "categories": [{"category": "Food", "limit": 8000}]}).json()
    assert body["monthly_budget"] == 28000 and body["spent"] == 750
    assert body["categories"] == [{"category": "Food", "limit": 8000, "spent": 750}]
    assert c.get("/api/budget", headers=bearer(A)).json() == body


def test_put_null_deletes_category(setup):
    c, _ = setup
    c.put("/api/budget", headers=bearer(A), json={"categories": [{"category": "Food", "limit": 8000}]})
    body = c.put("/api/budget", headers=bearer(A), json={"categories": [{"category": "Food", "limit": None}]}).json()
    assert body["categories"] == []


def test_put_rejects_negative(setup):
    c, _ = setup
    assert c.put("/api/budget", headers=bearer(A), json={"monthly_budget": -1}).status_code == 422
    assert c.put("/api/budget", headers=bearer(A), json={"categories": [{"category": "Food", "limit": 0}]}).status_code == 422


def test_draft_creates_pending_set_budget_proposals(setup):
    c, engine = setup
    history(engine, A)
    proposals = c.post("/api/budget/draft", headers=bearer(A)).json()["proposals"]
    assert [(p["type"], p["target"], p["payload"]["limit"], p["status"]) for p in proposals] == [
        ("set_budget", "Food", 4000, "pending"), ("set_budget", "Travel", 1500, "pending")]


def test_draft_needs_history(setup):
    c, _ = setup
    assert c.post("/api/budget/draft", headers=bearer(A)).json()["proposals"] == []


def test_redraft_supersedes_pending(setup):
    c, engine = setup
    history(engine, A)
    first = {p["id"] for p in c.post("/api/budget/draft", headers=bearer(A)).json()["proposals"]}
    second = {p["id"] for p in c.post("/api/budget/draft", headers=bearer(A)).json()["proposals"]}
    pending = {p["id"] for p in c.get("/api/agent/proposals?status=pending", headers=bearer(A)).json()["proposals"]}
    assert pending == second and not first & second
    rejected = {p["id"] for p in c.get("/api/agent/proposals?status=rejected", headers=bearer(A)).json()["proposals"]}
    assert first <= rejected


def test_approve_set_budget_upserts_row(setup):
    c, engine = setup
    history(engine, A)
    c.put("/api/budget", headers=bearer(A), json={"categories": [{"category": "Food", "limit": 999}]})
    food = next(p for p in c.post("/api/budget/draft", headers=bearer(A)).json()["proposals"] if p["target"] == "Food")
    r = c.post(f"/api/agent/proposals/{food['id']}/approve", headers=bearer(A)).json()
    assert r["applied"] == {"category": "Food", "limit": 4000}
    assert c.get("/api/budget", headers=bearer(A)).json()["categories"][0]["limit"] == 4000


def test_set_budget_approve_twice(setup):
    from models import Budget

    c, engine = setup
    history(engine, A)
    pid = c.post("/api/budget/draft", headers=bearer(A)).json()["proposals"][0]["id"]
    assert c.post(f"/api/agent/proposals/{pid}/approve", headers=bearer(A)).status_code == 200
    assert c.post(f"/api/agent/proposals/{pid}/approve", headers=bearer(A)).status_code == 409
    with Session(engine) as s:
        assert s.scalar(select(func.count()).select_from(Budget)) == 1


def test_budget_is_per_user(setup):
    c, engine = setup
    history(engine, A)
    c.put("/api/budget", headers=bearer(A), json={"monthly_budget": 5000, "categories": [{"category": "Food", "limit": 1}]})
    pid = c.post("/api/budget/draft", headers=bearer(A)).json()["proposals"][0]["id"]
    b = c.get("/api/budget", headers=bearer(B)).json()
    assert b["monthly_budget"] is None and b["categories"] == [] and b["spent"] == 0
    assert c.post(f"/api/agent/proposals/{pid}/approve", headers=bearer(B)).status_code == 404
    assert c.post("/api/budget/draft", headers=bearer(B)).json()["proposals"] == []


def test_agent_tool_draft_budget(setup):
    from agent.tools import TOOLS, NoArgs, ToolContext

    c, engine = setup
    history(engine, A)
    out = TOOLS["draft_budget"].run(ToolContext(user_id=A, engine=engine, sql_agent=None), NoArgs())
    assert [p["target"] for p in out["proposals"]] == ["Food", "Travel"]
    pending = c.get("/api/agent/proposals?status=pending", headers=bearer(A)).json()["proposals"]
    assert {p["type"] for p in pending} == {"set_budget"} and len(pending) == 2


@pytest.mark.parametrize("payload", [{"amount": 5000}, {"limit": 0}, {"limit": -5}, {"limit": "lots"}, {"limit": float("inf")}])
def test_agent_set_budget_with_a_bad_limit_is_rejected_not_applied(setup, payload):
    """The LLM can file set_budget with any payload: approving a bad one must be a 422, never a broken budget."""
    from agent.tools import TOOLS, ProposeActionArgs, ToolContext

    c, _ = setup
    out = TOOLS["propose_action"].run(ToolContext(user_id=A, engine=setup[1], sql_agent=None), ProposeActionArgs(
        type="set_budget", target=" Food ", risk="low", reason="r", payload=payload))
    r = c.post(f"/api/agent/proposals/{out['proposal_id']}/approve", headers=bearer(A))
    assert r.status_code == 422
    assert c.get("/api/budget", headers=bearer(A)).status_code == 200
    assert c.get("/api/budget", headers=bearer(A)).json()["categories"] == []


def test_agent_set_budget_target_is_trimmed(setup):
    from agent.tools import TOOLS, ProposeActionArgs, ToolContext

    c, engine = setup
    out = TOOLS["propose_action"].run(ToolContext(user_id=A, engine=engine, sql_agent=None), ProposeActionArgs(
        type="set_budget", target=" Food ", risk="low", reason="r", payload={"limit": 5000}))
    c.post(f"/api/agent/proposals/{out['proposal_id']}/approve", headers=bearer(A))
    assert c.get("/api/budget", headers=bearer(A)).json()["categories"][0]["category"] == "Food"


def test_decide_claims_with_a_conditional_update(setup):
    """Approval claims the proposal (UPDATE ... WHERE status = 'pending') before applying anything, so two
    concurrent approvals can't both apply on Postgres; the loser gets 409 (as _save_invoice already does)."""
    from sqlalchemy import event

    c, engine = setup
    history(engine, A)
    pid = c.post("/api/budget/draft", headers=bearer(A)).json()["proposals"][0]["id"]
    statements = []
    listener = lambda conn, cur, stmt, params, ctx, many: statements.append(" ".join(stmt.split()).lower())
    event.listen(engine, "before_cursor_execute", listener)
    try:
        assert c.post(f"/api/agent/proposals/{pid}/approve", headers=bearer(A)).status_code == 200
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    claim = next(i for i, s in enumerate(statements) if s.startswith("update proposals") and "status = ?" in s.split("where", 1)[1])
    writes = [i for i, s in enumerate(statements) if s.startswith("insert into budgets") or s.startswith("insert into audit_events")]
    assert writes and claim < min(writes)


def ym(n):
    return months_back(n)[:7]


def put_row(engine, user, category, limit, month):
    from models import Budget

    with Session(engine) as s, s.begin():
        s.add(Budget(user_id=user, category=category, monthly_limit=limit, effective_from=month))


def test_editing_this_month_keeps_last_months_limits(setup):
    c, engine = setup
    put_row(engine, A, "Food", 3000, ym(1))
    seed(engine, A, [(months_back(1), 2500, "Food")])
    c.put("/api/budget", headers=bearer(A), json={"categories": [{"category": "Food", "limit": 5000}]})
    last = c.get(f"/api/budget?month={ym(1)}", headers=bearer(A)).json()
    assert last["month"] == ym(1) and last["spent"] == 2500
    assert last["categories"] == [{"category": "Food", "limit": 3000, "spent": 2500}]
    assert c.get("/api/budget", headers=bearer(A)).json()["categories"][0]["limit"] == 5000


def test_removing_a_category_only_applies_from_this_month(setup):
    c, engine = setup
    put_row(engine, A, "Food", 3000, ym(1))
    body = c.put("/api/budget", headers=bearer(A), json={"categories": [{"category": "food", "limit": None}]}).json()
    assert body["categories"] == []
    assert c.get(f"/api/budget?month={ym(1)}", headers=bearer(A)).json()["categories"][0]["limit"] == 3000


def test_a_bad_month_is_rejected(setup):
    c, _ = setup
    for bad in ("2026-13", "26-01", "2026-1", "x"):
        assert c.get(f"/api/budget?month={bad}", headers=bearer(A)).status_code == 422
    assert c.get("/api/budget/history?months=0", headers=bearer(A)).status_code == 422


def test_history_compares_each_month_with_the_limits_then(setup):
    c, engine = setup
    put_row(engine, A, "Food", 3000, ym(2))
    put_row(engine, A, "Food", 4000, ym(1))
    seed(engine, A, [(months_back(3), 900, "Food"), (months_back(2), 3500, "Food"), (months_back(1), 1000, "Food")])
    months = c.get("/api/budget/history?months=4", headers=bearer(A)).json()["months"]
    assert months == [
        {"month": ym(3), "budget": None, "spent": 900},  # before any budget: spend only
        {"month": ym(2), "budget": 3000, "spent": 3500},
        {"month": ym(1), "budget": 4000, "spent": 1000},
        {"month": ym(0), "budget": 4000, "spent": 0},
    ]
    c.put("/api/budget", headers=bearer(A), json={"monthly_budget": 50000})
    assert c.get("/api/budget/history?months=1", headers=bearer(A)).json()["months"][0]["budget"] == 50000


def test_approving_a_draft_writes_it_from_the_drafts_month(setup):
    from models import Budget

    c, engine = setup
    history(engine, A)
    food = next(p for p in c.post("/api/budget/draft", headers=bearer(A)).json()["proposals"] if p["target"] == "Food")
    assert food["payload"]["month"] == ym(0)
    c.post(f"/api/agent/proposals/{food['id']}/approve", headers=bearer(A))
    with Session(engine) as s:
        assert [(b.category, b.effective_from) for b in s.scalars(select(Budget))] == [("Food", ym(0))]
