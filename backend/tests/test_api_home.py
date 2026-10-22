"""UI revamp Phase 3: GET /api/home/summary."""
from datetime import date, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

A = "7a1c0000-0000-4000-8000-0000000000aa"
B = "7a1c0000-0000-4000-8000-0000000000bb"


def bearer(sub):
    return {"Authorization": "Bearer " + jwt.encode({"sub": sub}, "k" * 32, algorithm="HS256")}


@pytest.fixture
def setup(tmp_path, monkeypatch):
    import models  # noqa: F401
    import utils.auth
    from api import home
    from asgi import create_app
    from models.database import db as flask_db
    from utils.limiter import limiter

    monkeypatch.setattr(utils.auth, "verify_token", lambda t: jwt.decode(t, options={"verify_signature": False}))
    monkeypatch.setattr(limiter, "enabled", False)
    engine = create_engine(f"sqlite:///{tmp_path / 'h.db'}")
    flask_db.metadata.create_all(engine)
    app = create_app(home.router)
    app.dependency_overrides[home.get_engine] = lambda: engine
    return TestClient(app), engine


def double_charge(engine, user):
    from models import Transaction

    d = (date.today() - timedelta(days=2)).isoformat()
    with Session(engine) as s, s.begin():
        for i in range(2):
            s.add(Transaction(user_id=user, vendor_name="Croma", invoice_number=f"{user}-{i}", date=d,
                              total_amount=2499, category="Electronics"))


def test_summary_empty_user(setup):
    c, _ = setup
    assert c.get("/api/home/summary", headers=bearer(A)).json() == {
        "success": True, "found": [], "more": 0, "worth_total": 0, "activity": []}


def test_summary_reports_duplicate_and_worth(setup):
    c, engine = setup
    double_charge(engine, A)
    body = c.get("/api/home/summary", headers=bearer(A)).json()
    assert [f["kind"] for f in body["found"]] == ["duplicate"] and body["worth_total"] == 2499
    assert [a["kind"] for a in body["activity"]] == ["receipt", "receipt"]
    assert body["activity"][0]["at"].endswith("Z")


def test_summary_counts_flagged_review_items(setup):
    from models import ReviewItem

    c, engine = setup
    with Session(engine) as s, s.begin():
        s.add(ReviewItem(user_id=A, status="flagged", confidence="low", invoice="{}", flags="[]"))
    assert c.get("/api/home/summary", headers=bearer(A)).json()["found"][0]["headline"] == "1 receipt needs a glance"


def test_summary_is_per_user(setup):
    c, engine = setup
    double_charge(engine, A)
    assert c.get("/api/home/summary", headers=bearer(B)).json()["found"] == []


def test_summary_requires_auth(setup):
    c, _ = setup
    assert c.get("/api/home/summary").status_code == 401
