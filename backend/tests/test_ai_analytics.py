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


def test_save_insight_serializes_datetime_and_decimal_metadata(clean_db):
    """save_insight must survive metadata containing datetime/Decimal values,
    exactly what a raw `SELECT *` row looks like on Postgres: psycopg2 returns
    real datetime objects for DateTime columns (created_at/updated_at) where
    SQLite returns strings, so this only ever broke in production. A bill due
    in ~3 days generates a reminder insight whose metadata nests a
    spending_patterns row -- created_at and all -- and json.dumps must not
    choke on it."""
    from decimal import Decimal

    from ai.analytics_orchestrator import AnalyticsOrchestrator
    from models import AnalyticsInsight, User

    db.session.add(User(id="user-1", email="user1-analytics@example.com"))
    db.session.commit()

    orchestrator = AnalyticsOrchestrator()
    insight = {
        "type": "reminder",
        "title": "Upcoming: Monthly Gym",
        "description": "Your Monthly Gym payment is typically due in 3 days",
        "severity": "info",
        "confidence": 0.9,
        "is_actionable": True,
        "metadata": {
            "next_predicted_date": "2026-09-28",
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow(),
            "average_amount": Decimal("999.00"),
        },
    }

    orchestrator.save_insight("user-1", insight)

    saved = AnalyticsInsight.query.filter_by(user_id="user-1").one()
    meta = json.loads(saved.meta)
    assert meta["average_amount"] == "999.00"
    assert "created_at" in meta


def test_day_of_month_pattern_handles_day_31_in_short_month(clean_db, monkeypatch):
    """A day-of-month pattern anchored on the 31st must not crash when
    'today' falls in a shorter month: datetime(today.year, today.month, 31)
    raises ValueError for April, June, September, November and February, so
    the day must be clamped to the month's last day instead."""
    import ai.pattern_detection as pattern_detection
    from models import Transaction, User

    db.session.add(User(id="user-1", email="user1-analytics@example.com"))
    for i, (month, day) in enumerate([(1, 31), (3, 31), (5, 31)]):
        db.session.add(Transaction(
            id=str(uuid.uuid4()), user_id="user-1", vendor_name=f"Landlord{i}",
            category="Rent", date=f"2026-{month:02d}-{day:02d}", total_amount=1000.0,
        ))
    db.session.commit()

    class FakeDateTime(datetime):
        @classmethod
        def now(cls):
            return datetime(2026, 4, 15)  # April has only 30 days

    monkeypatch.setattr(pattern_detection, "datetime", FakeDateTime)

    agent = pattern_detection.PatternDetectionAgent()
    patterns = agent.detect_day_of_month_patterns("user-1")

    rent_pattern = next(p for p in patterns if p["category"] == "Rent")
    assert rent_pattern["next_predicted_date"] == "2026-04-30"


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


def test_forecast_insights_use_llm_response(monkeypatch):
    """generate_forecast_insights must use whatever chat_completion returns
    when the call succeeds, instead of the stats-only fallback."""
    import ai.forecasting_agent as forecasting_agent

    monkeypatch.setattr(
        forecasting_agent, "chat_completion",
        lambda *a, **kw: '["Insight A", "Insight B"]',
    )

    agent = forecasting_agent.ForecastingAgent()
    insights = agent.generate_forecast_insights(
        mean_daily=100.0, total_forecast=3000.0, trend="stable",
        days_ahead=30, category_forecast=[],
    )

    assert insights == ["Insight A", "Insight B"]


def test_forecast_insights_falls_back_when_llm_fails(monkeypatch):
    """A failed LLM call must not raise -- generate_forecast_insights falls
    back to its canned, stats-based insights, exactly as it did before this
    call went through utils.llm."""
    from utils.llm import LLMError
    import ai.forecasting_agent as forecasting_agent

    def _raise(*a, **kw):
        raise LLMError(LLMError.AUTH, "no key configured")

    monkeypatch.setattr(forecasting_agent, "chat_completion", _raise)

    agent = forecasting_agent.ForecastingAgent()
    insights = agent.generate_forecast_insights(
        mean_daily=100.0, total_forecast=3000.0, trend="stable",
        days_ahead=30, category_forecast=[],
    )

    assert insights == [
        "Based on your spending pattern, expect around ₹3000 in the next 30 days.",
        "Your spending trend is stable.",
        "Monitor your expenses.",
    ]


def test_forecast_spending_skips_llm_when_use_llm_false(clean_db, monkeypatch):
    """forecast_spending must not call chat_completion at all when the
    caller passes use_llm=False -- previously the forecast's insight step
    ignored the flag entirely and always spent an LLM call."""
    import ai.forecasting_agent as forecasting_agent
    from models import Transaction, User

    calls = []

    def _count(*a, **kw):
        calls.append(1)
        return '["mocked insight"]'

    monkeypatch.setattr(forecasting_agent, "chat_completion", _count)

    db.session.add(User(id="user-1", email="user1-analytics@example.com"))
    base = date.today()
    for i in range(15):
        db.session.add(Transaction(
            id=str(uuid.uuid4()), user_id="user-1", vendor_name=f"Vendor{i}",
            category="Shopping", date=(base - timedelta(days=i * 2)).isoformat(),
            total_amount=100.0 + i,
        ))
    db.session.commit()

    agent = forecasting_agent.ForecastingAgent()
    result = agent.forecast_spending("user-1", days_ahead=30, use_llm=False)

    assert result["success"] is True
    assert calls == []
    assert result["insights"][0].startswith("Based on your spending pattern")


def test_llm_reasoning_uses_llm_response(monkeypatch):
    """llm_reasoning must adopt the LLM's explanation/risk_level/recommendation
    when the call succeeds."""
    import ai.anomaly_detection as anomaly_detection

    llm_body = json.dumps({
        "is_suspicious": True,
        "confidence": 0.9,
        "explanation": "Looks risky",
        "recommendation": "ALERT",
        "risk_level": "HIGH",
    })
    monkeypatch.setattr(anomaly_detection, "chat_completion", lambda *a, **kw: llm_body)

    agent = anomaly_detection.FraudDetectionAgent()
    anomaly = {
        "transaction": {
            "total_amount": 500, "vendor_name": "Vendor", "category": "Misc",
            "date": "2024-01-01", "payment_method": "Cash",
        },
        "flags": ["amount_outside_iqr"],
        "risk_score": 0.5,
        "explanation": "stat explanation",
    }

    result = agent.llm_reasoning(anomaly)

    assert result["llm_explanation"] == "Looks risky"
    assert result["recommendation"] == "ALERT"
    assert result["risk_level"] == "HIGH"


def test_llm_reasoning_falls_back_when_llm_fails(monkeypatch):
    """A failed LLM call must not raise -- the anomaly keeps its statistical
    explanation and a risk level computed from the score, exactly as it did
    before this call went through utils.llm."""
    from utils.llm import LLMError
    import ai.anomaly_detection as anomaly_detection

    def _raise(*a, **kw):
        raise LLMError(LLMError.AUTH, "no key configured")

    monkeypatch.setattr(anomaly_detection, "chat_completion", _raise)

    agent = anomaly_detection.FraudDetectionAgent()
    anomaly = {
        "transaction": {
            "total_amount": 500, "vendor_name": "Vendor", "category": "Misc",
            "date": "2024-01-01", "payment_method": "Cash",
        },
        "flags": ["amount_outside_iqr"],
        "risk_score": 0.5,
        "explanation": "stat explanation",
    }

    result = agent.llm_reasoning(anomaly)

    assert result["llm_explanation"] == "stat explanation"
    assert result["risk_level"] == "MEDIUM"
    assert "recommendation" not in result


def _seed_anomaly_candidates(user_id="user-1", count=12):
    """`count` transactions for user_id, with five suspicious round amounts,
    so both the statistical layer (needs >= 10 txns) and the round-number
    rule flag several anomalies -- enough to prove a loop over them makes
    more than one call unless something stops it early."""
    from models import Transaction, User

    if db.session.get(User, user_id) is None:
        db.session.add(User(id=user_id, email=f"{user_id}-analytics@example.com"))

    base = date.today()
    round_amounts = [1000, 2000, 5000, 10000, 20000]
    amounts = round_amounts + [100 + i * 3 for i in range(count - len(round_amounts))]
    for i, amount in enumerate(amounts):
        db.session.add(Transaction(
            id=str(uuid.uuid4()), user_id=user_id, vendor_name=f"Vendor{i}",
            category="Shopping", date=(base - timedelta(days=i)).isoformat(),
            total_amount=float(amount),
        ))
    db.session.commit()


def test_anomaly_llm_loop_stops_after_fatal_error(clean_db, monkeypatch):
    """Once chat_completion raises a fatal LLMError (timeout/auth/rate-limit
    kinds), the loop must stop spending further calls on the remaining
    flagged anomalies -- each of those gets the statistical fallback."""
    from utils.llm import LLMError
    import ai.anomaly_detection as anomaly_detection

    calls = []

    def _raise(*a, **kw):
        calls.append(1)
        raise LLMError(LLMError.UNAVAILABLE, "boom")

    monkeypatch.setattr(anomaly_detection, "chat_completion", _raise)

    _seed_anomaly_candidates()

    agent = anomaly_detection.FraudDetectionAgent()
    result = agent.detect_anomalies("user-1", use_llm=True)

    assert len(calls) == 1
    assert result["anomalies_detected"] >= 2
    for anomaly in result["anomalies"][:5]:
        assert anomaly["llm_explanation"] == anomaly["explanation"]


def test_anomaly_llm_loop_stops_after_deadline(clean_db, monkeypatch):
    """A 60s wall-clock deadline (measured with time.monotonic() from the
    first LLM call) caps the whole anomaly LLM stage regardless of how many
    flagged items remain, so it can't eat into gunicorn's 120s budget: once
    the clock shows more than 60s have passed since the first call, no
    further calls are made."""
    import ai.anomaly_detection as anomaly_detection

    calls = []

    def _ok(*a, **kw):
        calls.append(1)
        return json.dumps({
            "is_suspicious": False, "confidence": 0.1, "explanation": "ok",
            "recommendation": "MONITOR", "risk_level": "LOW",
        })

    monkeypatch.setattr(anomaly_detection, "chat_completion", _ok)

    fake_time = [1000.0]

    def _monotonic():
        fake_time[0] += 61  # every check jumps well past the 60s deadline
        return fake_time[0]

    monkeypatch.setattr(anomaly_detection.time, "monotonic", _monotonic)

    _seed_anomaly_candidates()

    agent = anomaly_detection.FraudDetectionAgent()
    result = agent.detect_anomalies("user-1", use_llm=True)

    # The first call establishes the deadline's start time and always goes
    # through; every later item in this run must be skipped once the fake
    # clock shows the 60s budget is already spent.
    assert len(calls) == 1
    assert result["anomalies_detected"] >= 2


def test_analyze_route_returns_only_user1_data_with_llm_mocked(clean_db, authed_client, monkeypatch):
    """POST /api/analytics/analyze must return 200 for user-1, using only
    user-1's data, with every LLM call mocked so the run never reaches
    OpenRouter."""
    import ai.forecasting_agent as forecasting_agent
    import ai.anomaly_detection as anomaly_detection

    monkeypatch.setattr(forecasting_agent, "chat_completion", lambda *a, **kw: '["mocked insight"]')
    monkeypatch.setattr(
        anomaly_detection, "chat_completion",
        lambda *a, **kw: json.dumps({
            "is_suspicious": False,
            "confidence": 0.2,
            "explanation": "mocked",
            "recommendation": "MONITOR",
            "risk_level": "LOW",
        }),
    )

    _seed()

    resp = authed_client.post(
        "/api/analytics/analyze",
        json={"use_llm": True},
        headers={"Authorization": "Bearer x.y.z"},
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    assert "Sneaky Vendor" not in json.dumps(body)


AUTHENTICATED_GET_ROUTES = [
    "/api/analytics/dashboard",
    "/api/analytics/reminders",
    "/api/analytics/anomalies",
    "/api/analytics/forecast",
    "/api/analytics/risk-score",
    "/api/analytics/insights",
    "/api/analytics/patterns",
]


@pytest.mark.parametrize("path", AUTHENTICATED_GET_ROUTES)
def test_authenticated_get_routes_reject_missing_token(path, clean_db):
    """Every authenticated GET route in ai_analytics.py must 401 without an
    Authorization header. (This is a route-decorator regression too: a
    handler missing its `@ai_analytics_bp.route(...)` isn't reachable at
    all, so it can't be exercised here or in production.)"""
    from app import app as flask_app

    client = flask_app.test_client()
    resp = client.get(path)

    assert resp.status_code == 401


@pytest.mark.parametrize(
    "path",
    [
        "/api/analytics/dashboard",
        "/api/analytics/reminders",
        "/api/analytics/anomalies",
        "/api/analytics/forecast",
        "/api/analytics/risk-score",
    ],
)
def test_transaction_backed_get_routes_return_200_without_user2_data(
    path, clean_db, authed_client, monkeypatch
):
    """Dashboard/reminders/anomalies/forecast/risk-score all derive from the
    same two-user transaction+anomaly seed; none of them may leak user-2's
    'Sneaky Vendor' transaction into user-1's response."""
    monkeypatch.setattr("utils.llm.chat_completion", lambda *a, **kw: "mocked")
    monkeypatch.setattr(
        "ai.forecasting_agent.chat_completion", lambda *a, **kw: '["mocked insight"]'
    )

    _seed()

    resp = authed_client.get(path, headers={"Authorization": "Bearer x.y.z"})

    assert resp.status_code == 200
    assert "Sneaky Vendor" not in json.dumps(resp.get_json())


def test_insights_route_scopes_to_authenticated_user(clean_db, authed_client, monkeypatch):
    """GET /api/analytics/insights must scope its raw SQL to user_id and
    never return another user's insight."""
    monkeypatch.setattr("utils.llm.chat_completion", lambda *a, **kw: "mocked")

    from models import AnalyticsInsight

    _seed()
    db.session.add_all([
        AnalyticsInsight(user_id="user-1", insight_type="reminder",
                          title="User1 insight", description="d1", severity="info"),
        AnalyticsInsight(user_id="user-2", insight_type="reminder",
                          title="User2 insight", description="d2", severity="info"),
    ])
    db.session.commit()

    resp = authed_client.get(
        "/api/analytics/insights", headers={"Authorization": "Bearer x.y.z"}
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    titles = {row["title"] for row in body["insights"]}
    assert "User1 insight" in titles
    assert "User2 insight" not in titles
    assert "Sneaky Vendor" not in json.dumps(body)


def test_patterns_route_scopes_to_authenticated_user(clean_db, authed_client, monkeypatch):
    """GET /api/analytics/patterns must scope its raw SQL to user_id."""
    monkeypatch.setattr("utils.llm.chat_completion", lambda *a, **kw: "mocked")

    from models import SpendingPattern

    _seed()
    db.session.add_all([
        SpendingPattern(user_id="user-1", pattern_type="recurring",
                         vendor_name="User1 Vendor", category="Fitness", is_active=True),
        SpendingPattern(user_id="user-2", pattern_type="recurring",
                         vendor_name="User2 Vendor", category="Misc", is_active=True),
    ])
    db.session.commit()

    resp = authed_client.get(
        "/api/analytics/patterns", headers={"Authorization": "Bearer x.y.z"}
    )

    assert resp.status_code == 200
    body = resp.get_json()
    assert body["success"] is True
    vendors = {row["vendor_name"] for row in body["patterns"]}
    assert "User1 Vendor" in vendors
    assert "User2 Vendor" not in vendors


def test_mark_insight_read_marks_own_insight(clean_db, authed_client, monkeypatch):
    """POST /api/analytics/insights/<id>/read succeeds for the caller's own
    insight and actually flips is_read."""
    monkeypatch.setattr("utils.llm.chat_completion", lambda *a, **kw: "mocked")

    from models import AnalyticsInsight

    _seed()
    insight = AnalyticsInsight(user_id="user-1", insight_type="reminder",
                                title="User1 insight", description="d1",
                                severity="info", is_read=False)
    db.session.add(insight)
    db.session.commit()
    insight_id = insight.id

    resp = authed_client.post(
        f"/api/analytics/insights/{insight_id}/read",
        headers={"Authorization": "Bearer x.y.z"},
    )

    assert resp.status_code == 200
    assert resp.get_json()["success"] is True

    db.session.expire_all()
    refreshed = db.session.get(AnalyticsInsight, insight_id)
    assert refreshed.is_read is True


def test_mark_insight_read_cannot_flip_another_users_insight(
    clean_db, authed_client, monkeypatch
):
    """POST .../insights/<id>/read for another user's insight id must 404
    and must not flip that insight's is_read -- otherwise user-1 could mark
    user-2's insights as read simply by guessing ids."""
    monkeypatch.setattr("utils.llm.chat_completion", lambda *a, **kw: "mocked")

    from models import AnalyticsInsight

    _seed()
    other_insight = AnalyticsInsight(user_id="user-2", insight_type="reminder",
                                      title="User2 insight", description="d2",
                                      severity="info", is_read=False)
    db.session.add(other_insight)
    db.session.commit()
    other_id = other_insight.id

    resp = authed_client.post(
        f"/api/analytics/insights/{other_id}/read",
        headers={"Authorization": "Bearer x.y.z"},
    )

    assert resp.status_code == 404

    db.session.expire_all()
    refreshed = db.session.get(AnalyticsInsight, other_id)
    assert refreshed.is_read is False


def test_mark_insight_read_binds_is_read_as_boolean_not_integer_literal(
    clean_db, authed_client, monkeypatch
):
    """The UPDATE must bind is_read as a parameter, never inline a bare
    integer literal (`SET is_read = 1`). SQLite silently accepts assigning
    an int to any column, but Postgres's `insights.is_read` is a real
    boolean column: `column "is_read" is of type boolean but expression is
    of type integer` on `SET is_read = 1`. Bind a Python bool instead so
    the same query works on both."""
    monkeypatch.setattr("utils.llm.chat_completion", lambda *a, **kw: "mocked")

    from models import AnalyticsInsight

    _seed()
    insight = AnalyticsInsight(user_id="user-1", insight_type="reminder",
                                title="User1 insight", description="d1",
                                severity="info", is_read=False)
    db.session.add(insight)
    db.session.commit()
    insight_id = insight.id

    seen = []

    def _record(conn, cursor, statement, parameters, context, executemany):
        if "UPDATE insights" in statement:
            seen.append((statement, dict(context.compiled_parameters[0])))

    engine = db.engine
    event.listen(engine, "before_cursor_execute", _record)
    try:
        resp = authed_client.post(
            f"/api/analytics/insights/{insight_id}/read",
            headers={"Authorization": "Bearer x.y.z"},
        )
    finally:
        event.remove(engine, "before_cursor_execute", _record)

    assert resp.status_code == 200
    assert seen, "expected the UPDATE insights statement to be captured"
    statement, params = seen[0]

    assert "is_read = 1" not in statement, (
        f"is_read must be bound, not inlined as an integer literal: {statement!r}"
    )
    assert isinstance(params.get("is_read"), bool), (
        f"is_read must be bound as a Python bool, got {params.get('is_read')!r}"
    )


def test_patterns_route_binds_is_active_as_boolean_not_integer_literal(
    clean_db, authed_client, monkeypatch
):
    """GET /api/analytics/patterns must bind is_active as a parameter, never
    inline a bare integer literal (`AND is_active = 1`). SQLite tolerates
    that against its boolean-as-integer column, but Postgres's
    `spending_patterns.is_active` is a real boolean column and 500s on the
    inlined form. Bind a Python bool instead so the same query works on
    both."""
    monkeypatch.setattr("utils.llm.chat_completion", lambda *a, **kw: "mocked")

    from models import SpendingPattern

    _seed()
    db.session.add(SpendingPattern(user_id="user-1", pattern_type="recurring",
                                    vendor_name="User1 Vendor", category="Fitness",
                                    is_active=True))
    db.session.commit()

    seen = []

    def _record(conn, cursor, statement, parameters, context, executemany):
        if "FROM spending_patterns" in statement:
            seen.append((statement, dict(context.compiled_parameters[0])))

    engine = db.engine
    event.listen(engine, "before_cursor_execute", _record)
    try:
        resp = authed_client.get(
            "/api/analytics/patterns", headers={"Authorization": "Bearer x.y.z"}
        )
    finally:
        event.remove(engine, "before_cursor_execute", _record)

    assert resp.status_code == 200
    assert seen, "expected the SELECT spending_patterns statement to be captured"
    statement, params = seen[0]

    assert "is_active = 1" not in statement, (
        f"is_active must be bound, not inlined as an integer literal: {statement!r}"
    )
    assert isinstance(params.get("is_active"), bool), (
        f"is_active must be bound as a Python bool, got {params.get('is_active')!r}"
    )


def test_health_route_returns_200():
    """GET /api/analytics/health needs no authentication."""
    from app import app as flask_app

    client = flask_app.test_client()
    resp = client.get("/api/analytics/health")

    assert resp.status_code == 200
    assert resp.get_json()["status"] == "healthy"


def test_require_auth_routes_are_all_registered_as_views():
    """Regression guard for this file's bug: every function in
    routes/ai_analytics.py decorated with @require_auth must be registered
    as a Flask view. When a route's `@ai_analytics_bp.route(...)` decorator
    is dropped, the function still exists and is still wrapped by
    `@require_auth`, but Flask no longer dispatches any URL to it -- exactly
    what happened here and made every one of these endpoints 404."""
    import ast
    import inspect

    import routes.ai_analytics as ai_analytics
    from app import app as flask_app

    tree = ast.parse(inspect.getsource(ai_analytics))

    decorated_names = {
        node.name
        for node in ast.walk(tree)
        if isinstance(node, ast.FunctionDef)
        for dec in node.decorator_list
        if isinstance(dec, ast.Name) and dec.id == "require_auth"
    }
    assert decorated_names, "expected to find @require_auth-decorated functions"

    registered_names = {
        func.__name__
        for func in flask_app.view_functions.values()
        if getattr(func, "__module__", None) == ai_analytics.__name__
    }

    missing = decorated_names - registered_names
    assert not missing, f"@require_auth handlers not registered as routes: {missing}"
