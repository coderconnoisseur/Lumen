"""AI analytics dashboard: risk assessment and pattern detection must run
through the app's SQLAlchemy session (not a raw sqlite3 connection) so the
same code works against Postgres in production and SQLite in tests, and must
never leak one user's data into another user's results."""

import json
import uuid
from datetime import date, datetime, timedelta

import pytest
from sqlalchemy import event

from models.database import db


@pytest.fixture
def clean_db():
    """App test DB via conftest. Refuse to touch anything that isn't the
    throwaway sqlite file conftest created, then wipe it so tests don't see
    rows left over from other test modules."""
    import conftest
    from app import app as flask_app
    from models import FraudAnomaly, SpendingPattern, Transaction, TransactionItem, User

    with flask_app.app_context():
        url = str(db.engine.url)
        assert url.startswith("sqlite"), f"refusing to wipe a non-sqlite database: {url}"
        assert conftest.TEST_DB_DIR.name in url, "refusing to wipe a database outside the test temp dir"

        TransactionItem.query.delete()
        FraudAnomaly.query.delete()
        SpendingPattern.query.delete()
        Transaction.query.delete()
        User.query.delete()
        db.session.commit()

        yield


def _iter_bind_values(parameters):
    """Flatten a `before_cursor_execute` `parameters` payload into scalars.

    Depending on the DBAPI and whether SQLAlchemy's insertmanyvalues path is
    used, this is a dict (named binds), a flat tuple (one row of positional
    binds), or a sequence of dicts/tuples (one per row) — the `executemany`
    flag doesn't reliably tell them apart across SQLAlchemy versions, so
    inspect the shape instead.
    """
    if not parameters:
        return
    if isinstance(parameters, dict):
        yield from parameters.values()
        return
    first = parameters[0]
    if isinstance(first, (dict, list, tuple)):
        for row in parameters:
            yield from _iter_bind_values(row)
    else:
        yield from parameters


def _months_ago_same_day(d: date, months: int, day: int) -> date:
    """`day` in the month `months` before `d`. `day` must be <= 28 so it's
    valid in every month regardless of length."""
    month = d.month - months
    year = d.year
    while month <= 0:
        month += 12
        year -= 1
    return date(year, month, day)


def _seed():
    """Two users, each with their own transactions:

    - user-1: a transaction today (current month), a vendor that recurs
      every ~30 days (Monthly Gym, 3 occurrences at 30/60/90 days back), and
      three one-off transactions in the same category on the same
      day-of-month, several months back (a day-of-month pattern).
    - user-2: a single high-amount transaction with a HIGH-risk anomaly.

    Returns the numbers user-1's risk assessment should reproduce, computed
    the same way the engine buckets dates, so the assertions hold no matter
    which day the suite runs on.
    """
    from models import FraudAnomaly, Transaction, User

    today = date.today()
    since_30 = today - timedelta(days=30)
    since_60 = today - timedelta(days=60)
    since_90 = today - timedelta(days=90)
    this_month = today.strftime("%Y-%m")

    gym_amounts = {"since_30": 999.00, "since_60": 1000.00, "since_90": 995.00}

    db.session.add_all([
        User(id="user-1", email="user1-analytics@example.com"),
        User(id="user-2", email="user2-analytics@example.com"),
    ])

    txns = [
        Transaction(id=str(uuid.uuid4()), user_id="user-1", vendor_name="Today Shop",
                    category="Shopping", date=today.isoformat(), total_amount=4242.00),
        Transaction(id=str(uuid.uuid4()), user_id="user-1", vendor_name="Monthly Gym",
                    category="Fitness", date=since_30.isoformat(), total_amount=gym_amounts["since_30"]),
        Transaction(id=str(uuid.uuid4()), user_id="user-1", vendor_name="Monthly Gym",
                    category="Fitness", date=since_60.isoformat(), total_amount=gym_amounts["since_60"]),
        Transaction(id=str(uuid.uuid4()), user_id="user-1", vendor_name="Monthly Gym",
                    category="Fitness", date=since_90.isoformat(), total_amount=gym_amounts["since_90"]),
    ]

    # Day-of-month pattern: distinct vendors so they don't also register as a
    # recurring vendor, same category and day-of-month, far enough back that
    # they never fall inside the 30/60/90-day windows above.
    dom_day = min(today.day, 28)
    for i, vendor in enumerate(["Grocery A", "Grocery B", "Grocery C"], start=4):
        d = _months_ago_same_day(today, i, dom_day)
        txns.append(Transaction(id=str(uuid.uuid4()), user_id="user-1", vendor_name=vendor,
                                 category="Groceries", date=d.isoformat(), total_amount=200.0 + i))

    user2_txn_id = str(uuid.uuid4())
    txns.append(Transaction(id=user2_txn_id, user_id="user-2", vendor_name="Sneaky Vendor",
                             category="Misc", date=today.isoformat(), total_amount=999999.99))

    db.session.add_all(txns)
    db.session.flush()

    db.session.add(FraudAnomaly(
        id=str(uuid.uuid4()), transaction_id=user2_txn_id, user_id="user-2",
        anomaly_type="amount", detection_method="statistical", risk_score=90,
        risk_level="HIGH", explanation="unusually large amount",
        created_at=datetime.utcnow(),
    ))
    db.session.commit()

    # since_30 only lands in "this month" on the rare day (the 31st) where
    # today - 30 days is still in the same calendar month.
    expected_current_month = 4242.00
    if since_30.strftime("%Y-%m") == this_month:
        expected_current_month += gym_amounts["since_30"]

    return {
        "last_30_days": 4242.00 + gym_amounts["since_30"],
        "previous_30_days": gym_amounts["since_60"],
        "current_month_spending": expected_current_month,
        # detect_recurring_transactions averages all but the earliest occurrence
        "gym_average_amount": (gym_amounts["since_60"] + gym_amounts["since_30"]) / 2,
    }


def test_risk_assessment_engine_scopes_to_single_user(clean_db):
    from ai.risk_assessment import RiskAssessmentEngine

    expected = _seed()

    risk = RiskAssessmentEngine().calculate_overall_risk("user-1")
    factors = {f["factor"]: f for f in risk["factors"]}

    assert factors["spending_velocity"]["last_30_days"] == pytest.approx(expected["last_30_days"])
    assert factors["spending_velocity"]["previous_30_days"] == pytest.approx(expected["previous_30_days"])
    assert factors["budget_deviation"]["current_month_spending"] == pytest.approx(expected["current_month_spending"])
    assert factors["liquidity_risk"]["current_spending"] == pytest.approx(expected["current_month_spending"])

    # user-2's anomaly must never count against user-1
    assert factors["anomaly_risk"]["anomaly_count"] == 0
    assert factors["anomaly_risk"]["high_risk"] == 0

    assert "Sneaky Vendor" not in json.dumps(risk)


def test_pattern_detection_agent_scopes_to_single_user(clean_db):
    from ai.pattern_detection import PatternDetectionAgent

    expected = _seed()
    agent = PatternDetectionAgent()

    recurring = agent.detect_recurring_transactions("user-1")
    vendors = {p["vendor_name"] for p in recurring}
    assert "Monthly Gym" in vendors
    assert "Sneaky Vendor" not in vendors

    gym = next(p for p in recurring if p["vendor_name"] == "Monthly Gym")
    assert gym["occurrence_count"] == 3
    assert gym["average_amount"] == pytest.approx(expected["gym_average_amount"])

    dom_patterns = agent.detect_day_of_month_patterns("user-1")
    categories = {p["category"] for p in dom_patterns}
    assert "Groceries" in categories
    assert "Misc" not in categories

    analysis = agent.analyze_user("user-1")
    reminder_titles = " ".join(r["title"] for r in analysis["reminders"])
    assert "Monthly Gym" in reminder_titles
    assert "Sneaky Vendor" not in reminder_titles

    assert "Sneaky Vendor" not in json.dumps(analysis)


def test_dashboard_route_returns_only_user1_data_with_safe_bind_params(clean_db, authed_client, monkeypatch):
    """GET /api/analytics/dashboard must return 200 with only user-1's data,
    and every query it runs must bind dates as strings/datetimes, never a
    bare `datetime.date` against the TEXT `date` column (that binds as a
    typed DATE parameter on Postgres, and `varchar >= date` has no implicit
    cast there even though SQLite tolerates it)."""
    monkeypatch.setattr("utils.llm.chat_completion", lambda *a, **kw: "mocked")

    _seed()

    bad_params = []

    def _record_params(conn, cursor, statement, parameters, context, executemany):
        for value in _iter_bind_values(parameters):
            if isinstance(value, date) and not isinstance(value, datetime):
                bad_params.append((statement, value))

    engine = db.engine
    event.listen(engine, "before_cursor_execute", _record_params)
    try:
        resp = authed_client.get(
            "/api/analytics/dashboard", headers={"Authorization": "Bearer x.y.z"}
        )
    finally:
        event.remove(engine, "before_cursor_execute", _record_params)

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert "Sneaky Vendor" not in json.dumps(body)
    assert bad_params == []
