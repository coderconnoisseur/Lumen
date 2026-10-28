"""Forecast F2: GET /api/forecast — the forecast service over the user's own data, states, budgets and income."""
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


@pytest.fixture
def setup(tmp_path, monkeypatch):
    import models  # noqa: F401
    import utils.auth
    from api import forecast
    from asgi import create_app
    from models.database import db as flask_db
    from utils.limiter import limiter

    monkeypatch.setattr(utils.auth, "verify_token", lambda t: jwt.decode(t, options={"verify_signature": False}))
    monkeypatch.setattr(limiter, "enabled", False)
    engine = create_engine(f"sqlite:///{tmp_path / 'f.db'}")
    flask_db.metadata.create_all(engine)
    app = create_app(forecast.router)
    app.dependency_overrides[forecast.get_engine] = lambda: engine
    return TestClient(app), engine


def months_back(n, day):
    t = date.today()
    y, m = divmod(t.year * 12 + t.month - 1 - n, 12)
    return f"{y}-{m + 1:02d}-{day:02d}"


def seed_year(engine, user, groceries=12000, flix=True):
    from models import Transaction

    with Session(engine) as s, s.begin():
        for n in range(1, 13):
            rows = [("Rent", 25000, "Housing", 5), ("Shop", groceries / 2, "Groceries", 12), ("Shop", groceries / 2, "Groceries", 24)]
            if flix:
                rows.append(("StreamFlix", 766, "Entertainment", 10))
            for i, (v, a, c, d) in enumerate(rows):
                s.add(Transaction(user_id=user, vendor_name=v, invoice_number=f"{user}-{n}-{i}", date=months_back(n, d),
                                  total_amount=a, category=c))


def get(c, user=A, **params):
    r = c.get("/api/forecast", headers=bearer(user), params=params)
    assert r.status_code == 200, r.text
    return r.json()["forecast"]


def test_the_forecast_comes_from_the_users_own_data(setup):
    c, engine = setup
    seed_year(engine, A)
    f = get(c)
    assert len(f["months"]) == 4 and f["months"][0]["month"] == date.today().strftime("%Y-%m")
    assert {"current", "daily", "accuracy", "items", "method"} <= set(f)
    assert f["accuracy"]["months_tested"] == 6
    assert {i["vendor"] for i in f["items"]} == {"Rent", "StreamFlix"}
    assert get(c, B) is None  # another user has no data: nothing to forecast, nothing of A's


def test_too_little_history_is_null(setup):
    c, engine = setup
    from models import Transaction

    with Session(engine) as s, s.begin():
        s.add(Transaction(user_id=A, vendor_name="Shop", invoice_number="x", date=date.today().isoformat(), total_amount=50))
    assert get(c) is None


def test_today_must_be_near_the_servers_date(setup):
    c, engine = setup
    seed_year(engine, A)
    near = (date.today() + timedelta(days=1)).isoformat()
    assert get(c, today=near)["months"][0]["month"] == near[:7]
    for bad in ("2020-01-01", "not-a-date"):
        assert c.get("/api/forecast", headers=bearer(A), params={"today": bad}).status_code == 422


def test_a_cancelled_subscription_lowers_next_month(setup):
    c, engine = setup
    seed_year(engine, A)
    before = get(c)["months"][1]["forecast"]
    from models import RecurringState

    with Session(engine) as s, s.begin():
        s.add(RecurringState(user_id=A, vendor_key="streamflix", state="cancelled"))
    after = get(c)["months"]
    assert after[1]["forecast"] == pytest.approx(before - 766, abs=1)
    assert "Lower: StreamFlix is cancelled." in [m["why"] for m in after[:2]]  # the first month it would have been charged


def test_budget_and_income_are_carried_through(setup):
    c, engine = setup
    seed_year(engine, A)
    from models import Budget, User

    month = date.today().strftime("%Y-%m")
    with Session(engine) as s, s.begin():
        s.add(User(id=A, email="a@x.com", monthly_budget=40000, monthly_income=60000, currency="INR"))
        s.add(Budget(user_id=A, category="Groceries", monthly_limit=10000, effective_from=month))
    now = get(c)["months"][0]
    assert now["budget"] == 40000 and now["income"] == 60000 and now["left"] == pytest.approx(60000 - now["forecast"], abs=1)
    assert next(x for x in now["categories"] if x["category"] == "Groceries")["budget"] == 10000
