"""UI revamp Phase 3: deterministic budget drafts and per-category spend (ai/budget.py), and the budgets table."""
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ai.budget import draft_budget, month_spend_by_category

TODAY = date(2026, 10, 21)  # complete months: Jul, Aug, Sep 2026


def t(d, amount, category="Food"):
    return {"vendor_name": "V", "date": d, "total_amount": amount, "category": category}


def three_months(category, amounts):
    return [t(f"2026-{m:02d}-10", a, category) for m, a in zip((7, 8, 9), amounts)]


def test_draft_rounds_up_to_500():
    assert draft_budget(three_months("Food", [7000, 7160, 7200]), TODAY) == [
        {"category": "Food", "limit": 7500, "basis": {"months": ["2026-07", "2026-08", "2026-09"], "average": 7120.0}}
    ]


def test_draft_small_values_round_to_10():
    [line] = draft_budget(three_months("Coffee", [400, 404, 408]), TODAY)
    assert line["limit"] == 410


def test_draft_skips_under_300():
    assert draft_budget(three_months("Stamps", [250, 280, 290]), TODAY) == []


def test_draft_caps_at_8_largest_first():
    txns = []
    for i in range(10):
        txns += three_months(f"C{i}", [1000 * (i + 1)] * 3)
    lines = draft_budget(txns, TODAY)
    assert len(lines) == 8
    assert [l["category"] for l in lines] == [f"C{i}" for i in range(9, 1, -1)]


def test_draft_needs_history():
    assert draft_budget([t("2026-09-10", 5000)], TODAY) == []


def test_draft_ignores_current_month():
    txns = three_months("Food", [1000, 1000, 1000]) + [t("2026-10-05", 90000)]
    assert draft_budget(txns, TODAY)[0]["limit"] == 1000


def test_categories_normalise():
    txns = [t("2026-10-01", 100, "food"), t("2026-10-02", 100, "Food "), t("2026-10-03", 100, "FOOD"),
            t("2026-10-04", 100, "food"), t("2026-10-05", 50, None)]
    assert month_spend_by_category(txns, 2026, 10) == {"food": 400, "Uncategorised": 50}


def test_month_spend_nets_refunds():
    txns = [t("2026-10-01", 1000), t("2026-10-02", -400)]
    assert month_spend_by_category(txns, 2026, 10) == {"Food": 600}


def test_budget_unique_per_category(tmp_path):
    import models  # noqa: F401
    from models import Budget
    from models.database import db as flask_db

    engine = create_engine(f"sqlite:///{tmp_path / 'b.db'}")
    flask_db.metadata.create_all(engine)
    with pytest.raises(IntegrityError), Session(engine) as s, s.begin():
        s.add_all([Budget(user_id="u", category="Food", monthly_limit=1), Budget(user_id="u", category="Food", monthly_limit=2)])
