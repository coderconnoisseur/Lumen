"""One-click demo (SPEC-DEPLOY): an anonymous visitor gets their own copy of the demo data, and a daily question cap."""
import os

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

from llm.client import LLMResult


def bearer(sub, anonymous=True):
    return {"Authorization": "Bearer " + jwt.encode({"sub": sub, "is_anonymous": anonymous}, "k" * 32, algorithm="HS256")}


VISITOR = "5b0c2d6e-0000-4000-8000-000000000001"
MEMBER = "5b0c2d6e-0000-4000-8000-000000000002"


@pytest.fixture
def app(tmp_path, monkeypatch):
    import models  # noqa: F401
    import utils.auth
    from ai.sql_agent import SQLAgent
    from api import agent as agent_api, demo
    from asgi import create_app
    from rag.embed import FakeEmbedder
    from rag.service import RagService, get_service
    from rag.store import ChunkStore
    from utils.limiter import limiter

    monkeypatch.setattr(utils.auth, "verify_token",
                        lambda token: jwt.decode(token, options={"verify_signature": False}))
    path = tmp_path / "demo.db"
    engine = create_engine(f"sqlite:///{path}")
    from models.database import db as flask_db

    flask_db.metadata.create_all(engine)  # the app's tables, as init_db makes them in production
    store = ChunkStore(engine)
    store.ensure_schema()
    rag = RagService(store, FakeEmbedder(), reranker=None)
    deps = agent_api.AgentDeps(engine=engine, sql_agent=SQLAgent(db_path=str(path)), rag=rag,
                               complete=lambda *a, **k: LLMResult(text="Done.", tool_calls=None, provider="f", model="f"))
    a = create_app(demo.router, agent_api.router)
    a.dependency_overrides[get_service] = lambda: rag
    a.dependency_overrides[agent_api.get_agent_deps] = lambda: deps
    limiter.reset()
    return TestClient(a), engine, store


def _count(engine, user):
    with engine.connect() as c:
        return c.execute(text("SELECT COUNT(*) FROM transactions WHERE user_id = :u"), {"u": user}).scalar()


def test_a_visitor_gets_their_own_demo_data_once(app):
    client, engine, store = app
    first = client.post("/api/demo/start", headers=bearer(VISITOR)).json()
    assert first == {"success": True, "seeded": True}
    n, docs = _count(engine, VISITOR), len(store.list_documents(VISITOR))
    assert n > 100 and docs > 0
    again = client.post("/api/demo/start", headers=bearer(VISITOR)).json()
    assert again == {"success": True, "seeded": False}
    assert _count(engine, VISITOR) == n and len(store.list_documents(VISITOR)) == docs


def test_real_accounts_never_get_demo_data(app):
    client, engine, _ = app
    r = client.post("/api/demo/start", headers=bearer(MEMBER, anonymous=False))
    assert r.status_code == 403
    assert _count(engine, MEMBER) == 0


def test_visitors_have_a_daily_question_cap_members_do_not(app, monkeypatch):
    from api import agent as agent_api

    assert agent_api.DEMO_QUESTIONS_PER_DAY == 20
    monkeypatch.setattr(agent_api, "DEMO_QUESTIONS_PER_DAY", 3)  # stay under the 10-per-minute limit
    client, _, _ = app
    ask = lambda who, anon: client.post("/api/agent/ask", headers=bearer(who, anon), json={"question": "hi"}).status_code
    assert [ask(VISITOR, True) for _ in range(4)] == [200, 200, 200, 429]
    assert [ask(MEMBER, False) for _ in range(5)] == [200] * 5


@pytest.mark.skipif(not os.getenv("LUMEN_TEST_POSTGRES_URL"),
                    reason="set LUMEN_TEST_POSTGRES_URL to seed on Postgres (production's database)")
def test_seeding_works_on_postgres():
    import uuid

    import models  # noqa: F401
    from models.database import db as flask_db
    from rag.embed import FakeEmbedder
    from rag.store import ChunkStore
    from scripts.seed_demo_data import seed

    engine = create_engine(os.environ["LUMEN_TEST_POSTGRES_URL"])
    store = ChunkStore(engine)
    store.ensure_schema()
    flask_db.metadata.create_all(engine)
    user = str(uuid.uuid4())
    counts = seed(engine, store, FakeEmbedder(), user)
    assert _count(engine, user) == counts["transactions"] > 100
    assert len(store.list_documents(user)) == counts["documents"] > 0


def test_the_demo_includes_purchase_orders(app):
    client, engine, _ = app
    client.post("/api/demo/start", headers=bearer(VISITOR))
    with engine.connect() as c:
        n = c.execute(text("SELECT COUNT(*) FROM purchase_orders WHERE user_id = :u"), {"u": VISITOR}).scalar()
    assert n > 0
