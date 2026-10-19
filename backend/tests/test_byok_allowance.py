"""SPEC-BYOK: the free allowance on the platform key (questions per day, lifetime invoice reads) for keyless users."""
import io

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from llm.client import LLMResult

AUTH = {"Authorization": "Bearer x.y.z"}
USER = "user-1"  # what `authed_client` signs in as


@pytest.fixture
def flask_db(authed_client, monkeypatch):
    """Signed-in Flask client, a real limiter, and no leftover keys or review rows for the user."""
    from app import app
    from models import ReviewItem, UserKey
    from models.database import db
    from utils.limiter import limiter

    monkeypatch.setenv("KEYS_ENCRYPTION_KEY", "k" * 32)
    monkeypatch.setattr(limiter, "enabled", True)
    limiter.reset()

    def clean():
        with app.app_context():
            db.session.query(UserKey).filter_by(user_id=USER).delete()
            db.session.query(ReviewItem).filter_by(user_id=USER).delete()
            db.session.commit()

    clean()
    yield authed_client
    clean()


def add_key(provider):
    from app import app
    from llm import keys
    from models import UserKey
    from models.database import db
    from utils.crypto import encrypt_secret

    with app.app_context():
        db.session.add(UserKey(user_id=USER, provider=provider, key_enc=encrypt_secret("sk-test-1234567890", key_env=keys.KEY_ENV)))
        db.session.commit()


def add_read():
    from app import app
    from models import ReviewItem
    from models.database import db

    with app.app_context():
        db.session.add(ReviewItem(user_id=USER, invoice="{}", flags="[]", confidence="high", status="approved"))
        db.session.commit()


def chat(client):
    return client.post("/chat", json={"query": "hi"}, headers=AUTH)


@pytest.fixture
def fake_ask(monkeypatch):
    import routes.chat as chat_routes

    monkeypatch.setattr(chat_routes, "_ask", lambda *a, **k: {"response": "ok"})
    monkeypatch.setattr(chat_routes, "_save_exchange", lambda *a: None)


def test_keyless_user_hits_question_allowance(flask_db, fake_ask, monkeypatch):
    from config import Config

    monkeypatch.setattr(Config, "PLATFORM_QUESTIONS_PER_DAY", 2)
    assert [chat(flask_db).status_code for _ in range(2)] == [200, 200]
    r = chat(flask_db)
    assert r.status_code == 402 and r.get_json()["code"] == "needs_key"
    assert "Add your own model key" in r.get_json()["error"]


def test_user_with_key_not_counted(flask_db, fake_ask, monkeypatch):
    from config import Config

    monkeypatch.setattr(Config, "PLATFORM_QUESTIONS_PER_DAY", 2)
    add_key("openai")
    assert [chat(flask_db).status_code for _ in range(5)] == [200] * 5


def test_demo_user_same_allowance(tmp_path, monkeypatch):
    import models  # noqa: F401
    import utils.auth
    from ai.sql_agent import SQLAgent
    from api import agent as agent_api
    from asgi import create_app
    from config import Config
    from models.database import db as flask_db
    from rag.embed import FakeEmbedder
    from rag.service import RagService
    from rag.store import ChunkStore
    from utils.limiter import limiter

    monkeypatch.setattr(utils.auth, "verify_token", lambda t: jwt.decode(t, options={"verify_signature": False}))
    monkeypatch.setattr(Config, "PLATFORM_QUESTIONS_PER_DAY", 2)
    path = tmp_path / "a.db"
    engine = create_engine(f"sqlite:///{path}")
    flask_db.metadata.create_all(engine)
    store = ChunkStore(engine)
    store.ensure_schema()
    deps = agent_api.AgentDeps(engine=engine, sql_agent=SQLAgent(db_path=str(path)),
                               rag=RagService(store, FakeEmbedder(), reranker=None),
                               complete=lambda *a, **k: LLMResult(text="Done.", tool_calls=None, provider="f", model="f"))
    app = create_app(agent_api.router)
    app.dependency_overrides[agent_api.get_agent_deps] = lambda: deps
    limiter.reset()
    c = TestClient(app)
    h = {"Authorization": "Bearer " + jwt.encode({"sub": "5b0c2d6e-0000-4000-8000-000000000001", "is_anonymous": True},
                                                 "k" * 32, algorithm="HS256")}
    ask = lambda: c.post("/api/agent/ask", headers=h, json={"question": "hi"})
    assert [ask().status_code for _ in range(2)] == [200, 200]
    r = ask()
    assert r.status_code == 402 and "Add your own model key" in r.text


def test_invoice_reads_capped_without_vision_key(flask_db, monkeypatch):
    from app import app
    from config import Config
    from extract import read
    from models.database import db
    from api.review import read_with_feedback
    from utils.llm import LLMError
    from llm import keys

    monkeypatch.setattr(Config, "PLATFORM_INVOICE_READS", 1)
    monkeypatch.setattr(read, "read_invoice", lambda *a, **k: {"vendor_name": None})
    add_read()

    def run():
        with app.app_context(), keys.for_user(USER, db.engine):
            return read_with_feedback(db.engine, USER, "aGk=", "image/png")

    with pytest.raises(LLMError) as e:
        run()
    assert e.value.kind == LLMError.NEEDS_KEY

    r = flask_db.post("/extract", data={"file": (io.BytesIO(b"x" * 20), "i.png")}, headers=AUTH,
                      content_type="multipart/form-data")
    assert r.status_code == 402 and r.get_json()["code"] == "needs_key"

    add_key("groq")  # no vision model on Groq: still the platform's
    with pytest.raises(LLMError):
        run()


def test_vision_key_is_not_capped(flask_db, monkeypatch):
    from app import app
    from api.review import read_with_feedback
    from config import Config
    from extract import read
    from llm import keys
    from models.database import db

    monkeypatch.setattr(Config, "PLATFORM_INVOICE_READS", 1)
    monkeypatch.setattr(read, "read_invoice", lambda *a, **k: {"vendor_name": None})
    add_read()
    add_key("gemini")
    with app.app_context(), keys.for_user(USER, db.engine):
        assert read_with_feedback(db.engine, USER, "aGk=", "image/png") == {"vendor_name": None}
