"""UI revamp Phase 5c: recurring charges for the Bills page, with the user's saved choices (cancelled / not a bill)."""
from datetime import date, timedelta

import jwt
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

A = "7a1c0000-0000-4000-8000-0000000000aa"
B = "7a1c0000-0000-4000-8000-0000000000bb"


def bearer(sub):
    return {"Authorization": "Bearer " + jwt.encode({"sub": sub, "email": f"{sub}@x.com"}, "k" * 32, algorithm="HS256")}


def ago(days):
    return (date.today() - timedelta(days=days)).isoformat()


@pytest.fixture
def setup(tmp_path, monkeypatch):
    import models  # noqa: F401
    import utils.auth
    from api import bills
    from asgi import create_app
    from models.database import db as flask_db
    from utils.limiter import limiter

    monkeypatch.setattr(utils.auth, "verify_token", lambda t: jwt.decode(t, options={"verify_signature": False}))
    monkeypatch.setattr(limiter, "enabled", False)
    engine = create_engine(f"sqlite:///{tmp_path / 'bills.db'}")
    flask_db.metadata.create_all(engine)
    app = create_app(bills.router)
    app.dependency_overrides[bills.get_engine] = lambda: engine
    return TestClient(app), engine


def charge(engine, user, vendor, when, amount=649.0, category="Entertainment"):
    from models import Transaction

    with Session(engine) as s, s.begin():
        s.add(Transaction(user_id=user, vendor_name=vendor, invoice_number=f"{user}-{vendor}-{when}", date=when,
                          total_amount=amount, category=category))


def monthly(engine, user, vendor, amount=649.0, category="Entertainment", latest=10):
    for n in (latest + 60, latest + 30, latest):
        charge(engine, user, vendor, ago(n), amount, category)


def items(c, user=A):
    r = c.get("/api/bills/recurring", headers=bearer(user))
    assert r.status_code == 200, r.text
    return r.json()


def test_recurring_lists_active_charges_per_user(setup):
    c, engine = setup
    monthly(engine, A, "Netflix")
    monthly(engine, B, "Spotify", 119)
    [item] = items(c)["items"]
    assert item["vendor"] == "Netflix" and item["cadence"] == "monthly" and item["state"] == "active"
    assert items(c)["hidden"] == []
    assert [i["vendor"] for i in items(c, B)["items"]] == ["Spotify"]


def test_cancel_then_charged_again(setup):
    c, engine = setup
    monthly(engine, A, "Netflix")
    r = c.post("/api/bills/recurring/state", json={"vendor": "Netflix", "state": "cancelled"}, headers=bearer(A))
    assert r.status_code == 200 and r.json()["items"][0]["state"] == "cancelled"
    # cancelled yesterday, charged again today: the user should know the cancel didn't stick
    from models import RecurringState

    charge(engine, A, "Netflix", date.today().isoformat())
    with Session(engine) as s, s.begin():
        row = s.query(RecurringState).one()
        row.changed_at = row.changed_at - timedelta(days=1)
    assert items(c)["items"][0]["state"] == "charged_again"


def test_not_a_bill_hides_and_active_restores(setup):
    c, engine = setup
    monthly(engine, A, "Netflix")
    r = c.post("/api/bills/recurring/state", json={"vendor": "NETFLIX", "state": "not_a_bill"}, headers=bearer(A))
    body = r.json()
    assert body["items"] == [] and [h["vendor"] for h in body["hidden"]] == ["Netflix"]
    r = c.post("/api/bills/recurring/state", json={"vendor": "Netflix", "state": "active"}, headers=bearer(A))
    assert [i["state"] for i in r.json()["items"]] == ["active"] and r.json()["hidden"] == []


def test_states_are_per_user_and_match_vendor_spelling(setup):
    c, engine = setup
    monthly(engine, A, "Netflix.com")
    monthly(engine, B, "Netflix.com")
    c.post("/api/bills/recurring/state", json={"vendor": "netflix com", "state": "cancelled"}, headers=bearer(A))
    assert items(c)["items"][0]["state"] == "cancelled"
    assert items(c, B)["items"][0]["state"] == "active"


def test_state_input_is_validated(setup):
    c, _ = setup
    assert c.post("/api/bills/recurring/state", json={"vendor": "X", "state": "deleted"}, headers=bearer(A)).status_code == 422
    assert c.post("/api/bills/recurring/state", json={"vendor": "", "state": "cancelled"}, headers=bearer(A)).status_code == 422
    assert c.get("/api/bills/recurring").status_code == 401
