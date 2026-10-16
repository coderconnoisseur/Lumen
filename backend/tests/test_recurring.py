"""find_recurring: regular cadence + similar amounts = recurring; frequent shopping isn't."""
from datetime import date, timedelta

from ai.recurring import find_recurring

TODAY = date(2026, 6, 30)


def _t(vendor, day, amount, category="Utilities"):
    return {"vendor_name": vendor, "date": day.isoformat() if isinstance(day, date) else day,
            "total_amount": amount, "category": category}


def _monthly(vendor, amounts, category, day=5, start_month=1):
    return [_t(vendor, date(2026, start_month + i, day), a, category) for i, a in enumerate(amounts)]


def _one(txns, vendor):
    return next(r for r in find_recurring(txns, TODAY) if r["vendor"] == vendor)


def test_monthly_bill_has_next_due_date_and_is_a_bill():
    r = _one(_monthly("City Power Ltd", [2400, 2100, 2900, 2600, 2300, 2500], "Utilities"), "City Power Ltd")
    assert r["cadence"] == "monthly" and r["kind"] == "bill"
    assert r["last_charge_date"] == "2026-06-05" and r["next_due_date"] == "2026-07-05"
    assert r["charges_count"] == 6 and not r["possibly_stopped"]


def test_price_rise_is_reported_with_percent():
    r = _one(_monthly("StreamFlix", [499, 499, 499, 499, 599], "Entertainment", start_month=2), "StreamFlix")
    assert r["kind"] == "subscription"
    assert r["price_change"] == {"previous": 499, "latest": 599, "percent": 20.0}


def test_steady_price_has_no_price_change():
    assert _one(_monthly("NetLink", [999] * 4, "Utilities"), "NetLink")["price_change"] is None


def test_a_few_days_jitter_still_counts_and_vendor_names_are_normalised():
    days = ["2026-02-03", "2026-03-06", "2026-04-02", "2026-05-07", "2026-06-04"]
    txns = [_t("Lotus Yoga" if i % 2 else "LOTUS-YOGA.", d, 2500, "Healthcare") for i, d in enumerate(days)]
    r = _one(txns, "LOTUS-YOGA.")
    assert r["cadence"] == "monthly" and r["kind"] == "recurring" and r["charges_count"] == 5


def test_frequent_irregular_shopping_is_not_recurring():
    start, gaps, amounts = date(2026, 1, 2), [3, 9, 1, 6, 12, 2, 5, 8, 4, 7], [820, 340, 1500, 610, 95, 2200]
    txns, d = [], start
    for i, g in enumerate(gaps):
        d += timedelta(days=g)
        txns.append(_t("FreshMart", d, amounts[i % len(amounts)], "Groceries"))
    assert find_recurring(txns, TODAY) == []


def test_weekly_shopping_at_wildly_different_amounts_is_not_recurring():
    txns = [_t("FreshMart", date(2026, 5, 1) + timedelta(days=7 * i), a, "Groceries")
            for i, a in enumerate([200, 1800, 450, 3000, 90, 1200])]
    assert find_recurring(txns, TODAY) == []


def test_two_charges_are_too_few():
    assert find_recurring(_monthly("StreamFlix", [649, 649], "Entertainment", start_month=5), TODAY) == []


def test_yearly_charge():
    txns = [_t("DomainCo", f"{y}-03-14", 1200, "Software") for y in (2023, 2024, 2025, 2026)]
    r = _one(txns, "DomainCo")
    assert r["cadence"] == "yearly" and r["next_due_date"] == "2027-03-14" and r["kind"] == "subscription"


def test_weekly_charge():
    txns = [_t("Milkman", date(2026, 6, 2) + timedelta(days=7 * i), 140, "Groceries") for i in range(4)]
    r = _one(txns, "Milkman")
    assert r["cadence"] == "weekly" and r["next_due_date"] == "2026-06-30"


def test_cancelled_subscription_is_flagged_possibly_stopped():
    r = _one(_monthly("GymFlex", [999, 999, 999], "Subscriptions", start_month=1), "GymFlex")  # last 2026-03-05
    assert r["possibly_stopped"]
    assert find_recurring(_monthly("GymFlex", [999] * 3, "Subscriptions", start_month=4), TODAY)[0]["possibly_stopped"] is False


def test_rent_with_one_missed_month_is_still_found_and_next_due_follows():
    txns = [_t("Landlord", date(2026, m, 1), 15000, "Rent") for m in (1, 2, 3, 5, 6)]  # April missed
    r = _one(txns, "Landlord")
    assert r["cadence"] == "monthly" and r["next_due_date"] == "2026-07-01"


def test_rent_with_one_extra_charge_is_still_found():
    txns = [_t("Landlord", date(2026, m, 1), 15000, "Rent") for m in range(1, 7)]
    txns.append(_t("Landlord", date(2026, 3, 16), 15000, "Rent"))
    assert _one(txns, "Landlord")["cadence"] == "monthly"


def test_weekly_groceries_at_varying_amounts_are_excluded():
    txns = [_t("FreshMart", date(2026, 5, 1) + timedelta(days=7 * i), a, "Groceries")
            for i, a in enumerate([820, 340, 1500, 610, 95, 2200])]
    assert not [r for r in find_recurring(txns, TODAY) if r["vendor"] == "FreshMart"]


def test_utility_usage_swing_is_not_a_price_change():
    assert _one(_monthly("City Power", [2000, 2000, 2000, 2600], "Utilities"), "City Power")["price_change"] is None
