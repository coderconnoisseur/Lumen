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


def test_budget_unique_per_category_and_month(tmp_path):
    import models  # noqa: F401
    from models import Budget
    from models.database import db as flask_db

    engine = create_engine(f"sqlite:///{tmp_path / 'b.db'}")
    flask_db.metadata.create_all(engine)
    with Session(engine) as s, s.begin():  # one row per month is how a budget changes over time
        s.add_all([Budget(user_id="u", category="Food", monthly_limit=1, effective_from="2026-09"),
                   Budget(user_id="u", category="Food", monthly_limit=2, effective_from="2026-10")])
    with pytest.raises(IntegrityError), Session(engine) as s, s.begin():
        s.add(Budget(user_id="u", category="Food", monthly_limit=3, effective_from="2026-10"))


def test_migration_versions_an_old_budgets_table(tmp_path):
    """A database from before Phase 5d: one row per (user, category), no effective_from. The migration keeps the rows,
    dates them by their last update, and lets a category have one row per month. Running it twice is harmless."""
    from sqlalchemy import text

    from models.database import _migrate_budget_versions

    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE budgets (id VARCHAR(36) PRIMARY KEY, user_id VARCHAR(36) NOT NULL, "
                          "category VARCHAR NOT NULL, monthly_limit FLOAT NOT NULL, updated_at DATETIME, "
                          "CONSTRAINT u_budget_user_category UNIQUE (user_id, category))"))
        conn.execute(text("INSERT INTO budgets VALUES ('1', 'u', 'Food', 4000, '2026-08-14 10:00:00')"))
    _migrate_budget_versions(engine)
    _migrate_budget_versions(engine)
    with engine.begin() as conn:
        assert conn.execute(text("SELECT category, monthly_limit, effective_from FROM budgets")).all() == [
            ("Food", 4000, "2026-08")]
        conn.execute(text("INSERT INTO budgets (id, user_id, category, monthly_limit, effective_from) "
                          "VALUES ('2', 'u', 'Food', 5000, '2026-10')"))
    with pytest.raises(IntegrityError), engine.begin() as conn:
        conn.execute(text("INSERT INTO budgets (id, user_id, category, monthly_limit, effective_from) "
                          "VALUES ('3', 'u', 'Food', 6000, '2026-10')"))


def test_basis_lists_only_months_with_spend():
    txns = [t("2026-08-10", 6000), t("2026-09-10", 6000)]  # nothing in July
    assert draft_budget(txns, TODAY)[0]["basis"]["months"] == ["2026-08", "2026-09"]


def test_draft_with_two_months_averages_over_two():
    txns = [t("2026-08-10", 6000), t("2026-09-10", 6000)]  # no July data
    assert draft_budget(txns, TODAY)[0]["limit"] == 6000


def test_a_failed_budget_migration_is_logged_as_an_error(monkeypatch, caplog):
    """If it's skipped, edits to an existing category in a new month hit the old constraint: that must not be quiet."""
    import logging

    from models import database

    def boom(engine):
        raise RuntimeError("no permission")

    monkeypatch.setattr(database, "_migrate_budget_versions", boom)
    with caplog.at_level(logging.WARNING, logger="models.database"):
        database.run_budget_migration(object())
    [record] = caplog.records
    assert record.levelno == logging.ERROR and "budget" in record.getMessage().lower()
