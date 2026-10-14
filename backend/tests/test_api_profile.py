"""SPEC-ONBOARD: the profile API."""
import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text

USER = "7a1c0000-0000-4000-8000-000000000001"
OTHER = "7a1c0000-0000-4000-8000-000000000002"


def bearer(sub, anonymous=False, email="me@example.com"):
    claims = {"sub": sub, "is_anonymous": anonymous, "email": email}
    return {"Authorization": "Bearer " + jwt.encode(claims, "k" * 32, algorithm="HS256")}


@pytest.fixture
def client(tmp_path, monkeypatch):
    import models  # noqa: F401
    import utils.auth
    from api import profile
    from asgi import create_app
    from models.database import db as flask_db
    from utils.limiter import limiter

    monkeypatch.setattr(utils.auth, "verify_token", lambda t: jwt.decode(t, options={"verify_signature": False}))
    engine = create_engine(f"sqlite:///{tmp_path / 'p.db'}")
    flask_db.metadata.create_all(engine)
    app = create_app(profile.router)
    app.dependency_overrides[profile.get_engine] = lambda: engine
    limiter.reset()
    return TestClient(app), engine


def test_get_without_a_row_is_not_onboarded(client):
    c, _ = client
    body = c.get("/api/profile", headers=bearer(USER)).json()
    assert body["profile"]["onboarded"] is False and body["profile"]["goals"] == []


def test_put_saves_fields_and_complete_marks_onboarded(client):
    c, engine = client
    r = c.put("/api/profile", headers=bearer(USER), json={
        "display_name": "Nishant", "currency": "INR", "monthly_budget": 40000, "use_case": "personal",
        "goals": ["save_more", "cut_subscriptions"], "complete": True})
    p = r.json()["profile"]
    assert r.status_code == 200 and p["onboarded"] is True and p["display_name"] == "Nishant"
    assert c.get("/api/profile", headers=bearer(USER)).json()["profile"]["goals"] == ["save_more", "cut_subscriptions"]


def test_partial_put_keeps_other_fields(client):
    c, _ = client
    c.put("/api/profile", headers=bearer(USER), json={"display_name": "A", "currency": "CHF"})
    p = c.put("/api/profile", headers=bearer(USER), json={"monthly_income": 5000}).json()["profile"]
    assert (p["display_name"], p["currency"], p["monthly_income"], p["onboarded"]) == ("A", "CHF", 5000, False)


@pytest.mark.parametrize("bad", [
    {"display_name": ""}, {"display_name": "x" * 61}, {"currency": "rupees"}, {"monthly_budget": -1},
    {"monthly_income": 1e13}, {"use_case": "company"}, {"goals": ["get_rich"]},
])
def test_put_rejects_invalid_values(client, bad):
    c, _ = client
    assert c.put("/api/profile", headers=bearer(USER), json=bad).status_code == 422


def test_put_creates_row_when_email_taken(client):
    c, engine = client
    with engine.begin() as conn:
        conn.execute(text("INSERT INTO users (id, email) VALUES (:i, 'me@example.com')"), {"i": OTHER})
    r = c.put("/api/profile", headers=bearer(USER), json={"display_name": "Me"})
    assert r.status_code == 200
    with engine.connect() as conn:
        assert conn.execute(text("SELECT email FROM users WHERE id = :i"), {"i": USER}).scalar() \
            == f"{USER}@users.lumen.local"


def test_demo_accounts_get_the_demo_profile_and_cannot_write(client):
    c, _ = client
    p = c.get("/api/profile", headers=bearer(USER, anonymous=True)).json()["profile"]
    assert p["demo"] is True and p["onboarded"] is True and p["currency"] == "INR"
    assert c.put("/api/profile", headers=bearer(USER, anonymous=True), json={"display_name": "x"}).status_code == 403


def test_load_profile_is_none_until_onboarded(client):
    from sqlalchemy.orm import Session

    from api.profile import load_profile

    c, engine = client
    c.put("/api/profile", headers=bearer(USER), json={"display_name": "A", "currency": "USD"})
    with Session(engine) as s:
        assert load_profile(s, USER) is None
    c.put("/api/profile", headers=bearer(USER), json={"complete": True})
    with Session(engine) as s:
        assert load_profile(s, USER)["currency"] == "USD"


def test_profile_columns_are_added_to_an_existing_users_table(tmp_path):
    """Production already has a users table without the profile columns; startup must add them."""
    from flask import Flask
    from sqlalchemy import inspect

    from models.database import _add_missing_columns, db

    path = tmp_path / "old.db"
    with create_engine(f"sqlite:///{path}").begin() as conn:
        conn.execute(text("CREATE TABLE users (id VARCHAR(36) PRIMARY KEY, email VARCHAR NOT NULL, created_at DATETIME)"))
    app = Flask(__name__)
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{path}"
    db.init_app(app)
    with app.app_context():
        _add_missing_columns()
        have = {c["name"] for c in inspect(db.engine).get_columns("users")}
    assert {"display_name", "avatar_key", "currency", "monthly_income", "monthly_budget", "use_case", "goals",
            "onboarded_at"} <= have
