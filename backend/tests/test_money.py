"""SPEC-ONBOARD: amounts in the user's currency in AI insight text, and the profile budget in the risk check."""
from datetime import datetime

import pytest

from utils.money import fmt

USER = "9c2e0000-0000-4000-8000-000000000001"


def test_fmt_uses_symbols_for_common_codes_and_codes_otherwise():
    assert fmt(1234.4, "INR") == "₹1,234" and fmt(5, "USD") == "$5" and fmt(1234, "CHF") == "CHF 1,234"
    assert fmt(10, None) == "₹10"  # Config.DEFAULT_CURRENCY is INR


@pytest.fixture
def profile_row():
    """A finished onboarding in the app's test database (Flask context)."""
    from app import app as flask_app
    from models import User
    from models.database import db

    with flask_app.app_context():
        db.session.merge(User(id=USER, email=f"{USER}@t.test", currency="CHF", monthly_budget=4000.0,
                              monthly_income=9000.0, onboarded_at=datetime.utcnow()))
        db.session.commit()
        yield flask_app
        db.session.delete(db.session.get(User, USER))
        db.session.commit()


def test_user_currency_and_budget_come_from_the_profile(profile_row):
    from utils.money import user_budget, user_currency, user_income

    assert (user_currency(USER), user_budget(USER), user_income(USER)) == ("CHF", 4000.0, 9000.0)
    assert (user_currency("nobody"), user_budget("nobody"), user_income("nobody")) == ("INR", None, None)


def test_risk_score_uses_the_profile_budget_and_income(profile_row, monkeypatch):
    from ai.analytics_orchestrator import AnalyticsOrchestrator

    seen = {}
    orchestrator = AnalyticsOrchestrator()
    monkeypatch.setattr(orchestrator.risk_engine, "calculate_overall_risk",
                        lambda user_id, monthly_budget=None, monthly_income=None:
                        seen.update(budget=monthly_budget, income=monthly_income) or {})
    orchestrator.get_risk_score(USER)
    assert seen == {"budget": 4000.0, "income": 9000.0}


def test_forecast_fallback_text_uses_the_given_currency():
    from ai.forecasting_agent import ForecastingAgent

    text = ForecastingAgent()._fallback_insights(1200.0, "stable", 30, [], currency="CHF")
    assert any("CHF 1,200" in line for line in text) and not any("₹" in line for line in text)
