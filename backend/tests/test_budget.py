"""UI revamp Phase 3: deterministic budget drafts and per-category spend (ai/budget.py), and the budgets table."""
from datetime import date

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ai.budget import draft_budget, draft_reason, month_spend_by_category, one_offs, usual_month_totals

TODAY = date(2026, 10, 21)  # complete months: Jul, Aug, Sep 2026


def t(d, amount, category="Food"):
    return {"vendor_name": "V", "date": d, "total_amount": amount, "category": category}


def three_months(category, amounts):
    return [t(f"2026-{m:02d}-10", a, category) for m, a in zip((7, 8, 9), amounts)]


def test_draft_rounds_up_to_500():
    assert draft_budget(three_months("Food", [7000, 7160, 7200]), TODAY) == [
        {"category": "Food", "limit": 7500, "basis": {"months": ["2026-07", "2026-08", "2026-09"], "average": 7120.0, "usual": 7160.0, "one_offs": []}}
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


# ---- one-offs (spec 2026-11-04 §4.1) ----

def row(d, amount, vendor="Shop", category="Shopping"):
    return {"vendor_name": vendor, "date": d, "total_amount": amount, "category": category}


def small(n=5, amount=1000, vendor="Shop", start=4):
    return [row(f"2026-{start + i:02d}-10", amount, vendor) for i in range(n)]


def test_a_big_purchase_is_a_one_off():
    big = row("2026-09-17", 34746, "TechHub")
    assert one_offs(small() + [big]) == [big]


def test_too_few_purchases_leave_nothing_out():
    assert one_offs(small(2) + [row("2026-09-17", 34746, "TechHub")]) == []


def test_under_the_floor_isnt_a_one_off():
    assert one_offs(small(amount=100) + [row("2026-09-17", 1500, "TechHub")]) == []


def test_a_recurring_vendor_is_never_a_one_off():
    assert one_offs(small() + [row("2026-09-17", 34746, "TechHub")], {"techhub"}) == []


def test_a_similar_charge_in_another_month_protects_it():
    rows = small() + [row("2026-08-01", 22000, "New Landlord"), row("2026-09-01", 22000, "New Landlord")]
    assert one_offs(rows) == []
    far = row("2026-09-01", 40000, "New Landlord")
    assert far in one_offs(small() + [row("2026-08-01", 22000, "New Landlord"), far])


def test_a_big_buy_at_a_shop_used_for_small_things_is_a_one_off():
    big = row("2026-09-17", 30000)
    assert one_offs(small(amount=500) + [big]) == [big]


def test_rent_with_no_vendor_name_isnt_left_out():
    rent = [row(f"2026-{m:02d}-01", 25000, None, "Housing") for m in range(4, 10)]
    others = [row(f"2026-{m:02d}-{d:02d}", 500, "Key cutter", "Housing") for m in range(4, 10) for d in (9, 12, 15)]
    assert one_offs(rent + others) == []


def test_one_big_purchase_with_no_vendor_name_is_still_a_one_off():
    big = row("2026-09-17", 30000, None)
    assert one_offs(small() + [big]) == [big]


MONTHS6 = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]


def test_a_refunded_one_off_leaves_usual_months_alone():
    rows = small(6, 5000) + [row("2026-08-17", 80000, "TechHub"), row("2026-09-02", -80000, "TechHub")]
    totals, out = usual_month_totals(rows, MONTHS6)
    assert [o["total_amount"] for o in out] == [80000]
    assert totals == {m: 5000 for m in MONTHS6}


def test_another_refund_still_nets_in():
    totals, _ = usual_month_totals(small(6, 5000) + [row("2026-09-02", -500, "Other")], MONTHS6)
    assert totals["2026-09"] == 4500


def test_a_usual_month_is_never_negative():
    totals, _ = usual_month_totals(small(5, 1000) + [row("2026-09-02", -9000, "Other")], MONTHS6)
    assert totals["2026-09"] == 0


def test_draft_limit_ignores_a_laptop():
    base = [row(f"2026-{m:02d}-{d}", 2500) for m in range(4, 10) for d in (5, 20)]
    laptop = row("2026-08-17", 80000, "TechHub")
    [plain], [with_it] = draft_budget(base, TODAY), draft_budget(base + [laptop], TODAY)
    assert with_it["limit"] == plain["limit"] == 5000
    assert with_it["basis"]["one_offs"] == [{"vendor": "TechHub", "amount": 80000, "date": "2026-08-17"}]


def test_draft_uses_75th_percentile_of_six_months():
    txns = [row(f"2026-{m:02d}-10", (m - 3) * 1000) for m in range(4, 10)]
    [line] = draft_budget(txns, TODAY)
    assert line["basis"]["usual"] == 4750
    assert line["limit"] == 5000
    assert len(line["basis"]["months"]) == 6


def test_a_month_without_this_category_counts_as_zero():
    food = [row(f"2026-{m:02d}-11", 9000, category="Food") for m in (6, 7, 8, 9)]
    line = next(l for l in draft_budget(food + [row("2026-09-10", 4000)], TODAY) if l["category"] == "Shopping")
    assert line["basis"]["usual"] == 1000  # 0, 0, 0, 4000 at the 75th percentile


def reason_line(*left_out):
    return {"category": "Shopping", "limit": 7500, "basis": {
        "months": ["2026-05", "2026-10"], "average": 9000.0, "usual": 7180.0,
        "one_offs": [{"vendor": v, "amount": a, "date": "2026-09-17"} for v, a in left_out]}}


def test_reason_says_what_its_based_on():
    assert draft_reason(reason_line(), "INR") == "Usually up to ₹7,180 a month over May–Oct, rounded up."


def test_reason_names_one_one_off():
    assert draft_reason(reason_line(("TechHub", 34746.0)), "INR").endswith(" Left out the ₹34,746 TechHub order.")


def test_reason_counts_several_one_offs():
    out = draft_reason(reason_line(("A", 30000.0), ("B", 21200.0), ("C", 10000.0)), "INR")
    assert out.endswith(" Left out 3 big one-off purchases (₹61,200).")


def test_a_refund_earlier_in_the_month_than_its_purchase_goes_with_it():
    rows = small(6, 5000) + [row("2026-09-20", 80000, "TechHub"), row("2026-09-02", -80000, "TechHub")]
    assert usual_month_totals(rows, MONTHS6)[0]["2026-09"] == 5000


def test_a_short_history_uses_the_median_so_a_laptop_cant_outrun_the_old_rule():
    three = [row("2026-07-10", 1000), row("2026-08-10", 1000), row("2026-09-10", 81000)]  # too few purchases to judge a one-off
    assert draft_budget(three, TODAY)[0]["limit"] == 1000
    two = [row("2026-08-10", 1000), row("2026-09-10", 1000), row("2026-09-17", 80000, "TechHub")]
    assert draft_budget(two, TODAY)[0]["limit"] <= 41000  # the old rule's mean
