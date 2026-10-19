"""SPEC-BYOK: stored user keys build the user's chain in llm.client; key failures are flagged and masked."""
import json
import logging

import pytest
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

import models  # noqa: F401
from llm import client, keys
from llm.errors import LLMError
from models import UserKey
from models.database import db
from utils.crypto import encrypt_secret

U = "b0b00000-0000-4000-8000-000000000001"
OK = {"model": "served/m", "choices": [{"message": {"content": "hello"}, "finish_reason": "stop"}]}
MSGS = [{"role": "user", "content": "hi"}]


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body, self.text, self.headers = status, body, str(body), {}

    def json(self):
        return self._body


@pytest.fixture
def engine(tmp_path, monkeypatch):
    monkeypatch.setenv("KEYS_ENCRYPTION_KEY", "k" * 32)
    e = create_engine(f"sqlite:///{tmp_path / 'k.db'}")
    db.metadata.create_all(e, tables=[db.metadata.tables["user_keys"]])
    return e


@pytest.fixture
def posts(monkeypatch):
    """Every POST is recorded; replies come from `script` (a status/body pair repeated when only one is left)."""
    calls, script = [], []

    def post(url, headers, json, timeout):
        calls.append({"url": url, "headers": headers, "json": json})
        return script.pop(0) if len(script) > 1 else script[0]

    monkeypatch.setattr(client.requests, "post", post)
    monkeypatch.setattr(client, "_sleep", lambda s: None)
    return calls, script


def add_key(engine, user, provider, key, models=None):
    with Session(engine) as s, s.begin():
        s.add(UserKey(user_id=user, provider=provider, key_enc=encrypt_secret(key, key_env=keys.KEY_ENV),
                      models=json.dumps(models) if models else None))


def row(engine, provider):
    with Session(engine) as s:
        return s.scalars(select(UserKey).where(UserKey.provider == provider)).one()


def test_no_user_context_uses_platform_chain(posts, monkeypatch):
    calls, script = posts
    script.append(_Resp(200, OK))
    monkeypatch.setenv("LUMEN_LLM_TIER", "ollama")
    client.complete(MSGS, role="text")
    assert calls[0]["url"].startswith("http://localhost:11434/v1") and calls[0]["json"]["model"] == "qwen2.5:3b"


def test_user_key_builds_user_chain(engine, posts):
    calls, script = posts
    script.append(_Resp(200, OK))
    add_key(engine, U, "openai", "sk-user-openai")
    with keys.for_user(U, engine):
        client.complete(MSGS, role="agent")
    assert calls[0]["url"].startswith("https://api.openai.com")
    assert calls[0]["json"]["model"] == "gpt-6.1-sol"
    assert calls[0]["headers"]["Authorization"] == "Bearer sk-user-openai"


def test_vision_falls_back_for_groq_only_user(engine, posts):
    calls, script = posts
    script.append(_Resp(200, OK))
    add_key(engine, U, "groq", "gsk-user")
    with keys.for_user(U, engine):
        client.complete(MSGS, role="vision")
        client.complete(MSGS, role="text")
    assert calls[0]["headers"].get("Authorization") != "Bearer gsk-user"
    assert calls[1]["url"].startswith("https://api.groq.com")
    assert calls[1]["json"]["model"] == "openai/gpt-oss-120b"
    assert calls[1]["headers"]["Authorization"] == "Bearer gsk-user"


def test_two_keys_split_roles(engine):
    add_key(engine, U, "groq", "gsk-user")
    add_key(engine, U, "gemini", "gem-user")
    with keys.for_user(U, engine):
        assert [e.model for e in keys.user_chain("agent")] == ["gemini-4-argon", "gemini-3.8-flash", "openai/gpt-oss-120b"]
        assert [e.model for e in keys.user_chain("vision")] == [e.model for e in client.registry().byok("gemini", "vision")]
        assert keys.has_key("vision")


@pytest.mark.parametrize("pick, first", [("gpt-4o", "gpt-6.1-sol"), ("gpt-5.6-sol", "gpt-5.6-sol")])
def test_retired_preference_uses_first(engine, pick, first):
    add_key(engine, U, "openai", "sk-user", models={"agent": pick})
    with keys.for_user(U, engine):
        assert keys.user_chain("agent")[0].model == first


def test_user_key_auth_error_is_flagged_and_not_failed_over(engine, posts):
    calls, script = posts
    script.append(_Resp(401, {"error": {"message": "bad key"}}))
    add_key(engine, U, "openai", "sk-user-openai")
    with keys.for_user(U, engine), pytest.raises(LLMError) as err:
        client.complete(MSGS, role="agent")
    assert err.value.kind == "auth" and err.value.user_key == "openai"
    assert len(calls) == 1
    r = row(engine, "openai")
    assert r.last_error and r.last_ok_at is None


def test_failed_call_detail_is_masked(engine, posts, caplog):
    calls, script = posts
    secret = "sk-live-ABCDEFGH1234"
    script.append(_Resp(401, {"error": {"message": f"Incorrect API key provided: {secret}"}}))
    add_key(engine, U, "openai", secret)
    caplog.set_level(logging.DEBUG)
    with keys.for_user(U, engine), pytest.raises(LLMError) as err:
        client.complete(MSGS, role="agent")
    assert "ABCDEFGH" not in str(err.value)
    assert "ABCDEFGH" not in row(engine, "openai").last_error
    assert not any("ABCDEFGH" in r.getMessage() for r in caplog.records)


def test_success_sets_last_ok(engine, posts):
    calls, script = posts
    script.append(_Resp(200, OK))
    add_key(engine, U, "openai", "sk-user")
    keys._set(engine, U, "openai", last_error="old")
    with keys.for_user(U, engine):
        client.complete(MSGS, role="agent")
    r = row(engine, "openai")
    assert r.last_ok_at is not None and r.last_error is None


def test_llm_error_status_codes():
    from utils.errors import llm_error_status

    e = LLMError(LLMError.AUTH, "x")
    e.user_key = "openai"
    assert llm_error_status(e) == (400, "key_rejected", "key_rejected")
    assert llm_error_status(LLMError("needs_key", "y")) == (402, "needs_key", "needs_key")
    assert LLMError.NEEDS_KEY in LLMError.FATAL


def test_require_auth_sets_context(monkeypatch):
    from flask import Flask

    import utils.auth as auth
    from models.database import db as flask_db

    monkeypatch.setattr(auth, "verify_token", lambda token: {"sub": U})
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite://"
    flask_db.init_app(app)

    @app.route("/who")
    @auth.require_auth
    def who():
        return keys.current()[0]

    resp = app.test_client().get("/who", headers={"Authorization": "Bearer t"})
    assert resp.get_data(as_text=True) == U
    assert keys.current() is None
