"""SPEC-BYOK: the keys API (add, list, test and remove a user's model keys)."""
import logging

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session

USER = "7a1c0000-0000-4000-8000-000000000001"
OTHER = "7a1c0000-0000-4000-8000-000000000002"
KEY = "sk-test-1234567890abcd"


def bearer(sub):
    return {"Authorization": "Bearer " + jwt.encode({"sub": sub, "email": "me@example.com"}, "k" * 32,
                                                    algorithm="HS256")}


class _Resp:
    def __init__(self, status, body):
        self.status_code, self._body, self.text = status, body, str(body)

    def json(self):
        return self._body


@pytest.fixture
def status(monkeypatch):
    """The HTTP status every provider key check gets; 401 replies echo the key, as OpenAI's do."""
    import llm.providers

    s = {"code": 200}

    def get(url, headers=None, timeout=None):
        if s["code"] == 200:
            return _Resp(200, {"data": [{"id": "m"}]})
        return _Resp(s["code"], {"error": {"message": f"Incorrect API key provided: {KEY}"}})

    monkeypatch.setattr(llm.providers.requests, "get", get)
    return s


@pytest.fixture
def client(tmp_path, monkeypatch, status):
    import models  # noqa: F401
    import utils.auth
    from api import keys as keys_api
    from api import profile
    from asgi import create_app
    from models.database import db as flask_db
    from utils.limiter import limiter

    monkeypatch.setenv("KEYS_ENCRYPTION_KEY", "k" * 32)
    monkeypatch.setattr(utils.auth, "verify_token", lambda t: jwt.decode(t, options={"verify_signature": False}))
    monkeypatch.setattr(limiter, "enabled", False)
    engine = create_engine(f"sqlite:///{tmp_path / 'k.db'}")
    flask_db.metadata.create_all(engine)
    app = create_app(keys_api.router)
    app.dependency_overrides[profile.get_engine] = lambda: engine
    limiter.reset()
    return TestClient(app), engine


def rows(engine):
    from models import UserKey

    with Session(engine) as s:
        return s.scalars(select(UserKey)).all()


def test_put_validates_encrypts_and_masks(client):
    c, engine = client
    r = c.put("/api/keys/openai", headers=bearer(USER), json={"key": f"  {KEY} "})
    assert r.status_code == 200 and r.json()["key"]["last4"] == "abcd"
    (row,) = rows(engine)
    assert row.key_enc.startswith("enc:") and KEY not in row.key_enc
    g = c.get("/api/keys", headers=bearer(USER))
    openai = next(p for p in g.json()["providers"] if p["provider"] == "openai")
    assert openai["key"]["last4"] == "abcd" and openai["name"] == "OpenAI" and "gpt-6-luna" in openai["models"]["text"]
    assert g.json()["in_use"]["agent"] == "openai:gpt-6.1-sol"
    assert "sk-test" not in g.text and "sk-test" not in r.text


def test_put_rejected_key_not_saved(client, status):
    c, engine = client
    status["code"] = 401
    r = c.put("/api/keys/openai", headers=bearer(USER), json={"key": KEY})
    assert r.status_code == 400 and r.json()["code"] == "key_invalid" and "1234567890" not in r.text
    assert rows(engine) == []


def test_put_unknown_provider_or_unlisted_model(client):
    c, engine = client
    assert c.put("/api/keys/mistral", headers=bearer(USER), json={"key": KEY}).status_code == 404
    r = c.put("/api/keys/openai", headers=bearer(USER), json={"key": KEY, "models": {"agent": "gpt-4o"}})
    assert r.status_code == 422 and rows(engine) == []


def test_put_again_replaces_key_and_models(client):
    c, engine = client
    c.put("/api/keys/openai", headers=bearer(USER), json={"key": KEY})
    r = c.put("/api/keys/openai", headers=bearer(USER),
              json={"key": "sk-other-key-9999", "models": {"agent": "gpt-5.6-sol"}})
    assert r.json()["key"]["last4"] == "9999" and r.json()["key"]["models"] == {"agent": "gpt-5.6-sol"}
    assert len(rows(engine)) == 1
    assert c.get("/api/keys", headers=bearer(USER)).json()["in_use"]["agent"] == "openai:gpt-5.6-sol"


def test_test_endpoint_updates_status(client, status):
    c, engine = client
    c.put("/api/keys/openai", headers=bearer(USER), json={"key": KEY})
    status["code"] = 401
    r = c.post("/api/keys/openai/test", headers=bearer(USER)).json()
    assert r["success"] is False and "1234567890" not in r["message"]
    assert rows(engine)[0].last_error and "1234567890" not in rows(engine)[0].last_error
    status["code"] = 200
    r = c.post("/api/keys/openai/test", headers=bearer(USER)).json()
    (row,) = rows(engine)
    assert r["success"] is True and row.last_ok_at is not None and row.last_error is None


def test_delete_and_isolation(client):
    c, engine = client
    c.put("/api/keys/openai", headers=bearer(USER), json={"key": KEY})
    other = c.get("/api/keys", headers=bearer(OTHER)).json()
    assert all(p["key"] is None for p in other["providers"]) and other["in_use"]["agent"] == "platform"
    assert c.post("/api/keys/openai/test", headers=bearer(OTHER)).status_code == 404
    assert c.delete("/api/keys/openai", headers=bearer(OTHER)).status_code == 404
    assert len(rows(engine)) == 1
    assert c.delete("/api/keys/openai", headers=bearer(USER)).json() == {"success": True}
    assert rows(engine) == []


def test_key_never_in_logs_or_responses(client, status, caplog):
    c, _ = client
    caplog.set_level(logging.DEBUG)
    bodies = [c.put("/api/keys/openai", headers=bearer(USER), json={"key": KEY}).text,
              c.put("/api/keys/openai", headers=bearer(USER), json={"key": KEY + "x" * 400}).text,  # 422
              c.post("/api/keys/openai/test", headers=bearer(USER)).text]
    status["code"] = 401
    bodies.append(c.post("/api/keys/openai/test", headers=bearer(USER)).text)
    bodies.append(c.get("/api/keys", headers=bearer(USER)).text)
    for secret in (KEY, KEY[:12], KEY[-12:]):
        assert not any(secret in b for b in bodies)
        assert not any(secret in r.getMessage() for r in caplog.records)


def test_validation_is_rate_limited(client, monkeypatch):
    from utils.limiter import limiter

    c, _ = client
    monkeypatch.setattr(limiter, "enabled", True)
    codes = [c.put("/api/keys/openai", headers=bearer(USER), json={"key": KEY}).status_code for _ in range(6)]
    assert codes == [200] * 5 + [429]


def test_no_encryption_key_refuses(client, monkeypatch):
    c, engine = client
    monkeypatch.delenv("KEYS_ENCRYPTION_KEY")
    monkeypatch.delenv("SECRET_KEY", raising=False)
    r = c.put("/api/keys/openai", headers=bearer(USER), json={"key": KEY})
    assert r.status_code == 503 and r.json()["code"] == "keys_unavailable"
    assert rows(engine) == []


def test_chat_with_rejected_key_says_so(authed_client, monkeypatch):
    import json as _json

    import llm.client
    import routes.chat as chat
    from app import app
    from llm import keys
    from models import UserKey
    from models.database import db
    from utils.crypto import encrypt_secret

    monkeypatch.setenv("KEYS_ENCRYPTION_KEY", "k" * 32)
    monkeypatch.setattr(chat, "_save_exchange", lambda *a: None)
    monkeypatch.setattr(llm.client, "_sleep", lambda s: None)
    monkeypatch.setattr(llm.client.requests, "post",
                        lambda *a, **k: type("R", (_Resp,), {"headers": {}})(401, {"error": {"message": "bad key"}}))
    with app.app_context():
        db.create_all()
        db.session.query(UserKey).filter_by(user_id="user-1").delete()
        db.session.add(UserKey(user_id="user-1", provider="openai", key_enc=encrypt_secret(KEY, key_env=keys.KEY_ENV),
                               models=_json.dumps({})))
        db.session.commit()
    try:
        r = authed_client.post("/chat", json={"query": "hi"}, headers={"Authorization": "Bearer x.y.z"})
        assert r.status_code == 400 and r.get_json()["code"] == "key_rejected"
        assert "OpenAI" in r.get_json()["error"]
    finally:
        with app.app_context():
            db.session.query(UserKey).filter_by(user_id="user-1").delete()
            db.session.commit()
