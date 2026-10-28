"""Forecast (spec 2026-10-28): bills on their due days + everyday spending, two methods, backtested. Pure functions."""
from datetime import date

from ai import forecast as fc

TODAY = date(2026, 10, 22)


def item(vendor, cadence, next_due, amount, kind="bill", category="Bills", **kw):
    return {"vendor": vendor, "category": category, "cadence": cadence, "typical_amount": amount,
            "last_charge_date": "2026-09-24", "next_due_date": next_due, "charges_count": 3, "price_change": None,
            "kind": kind, "possibly_stopped": False, "state": "active", **kw}


def t(d, amount, vendor="Shop", category="Groceries"):
    return {"vendor_name": vendor, "date": d, "total_amount": amount, "category": category}


# ---- Task 1: bills ----

def test_bill_items_keep_bills_and_subscriptions_only():
    items = [item("Rent", "monthly", "2026-10-24", 25000), item("Netflix", "monthly", "2026-11-02", 649, kind="subscription"),
             item("Corner shop", "weekly", "2026-10-25", 300, kind="recurring"),
             item("Gym", "monthly", "2026-10-28", 1500, state="cancelled"),
             item("Old", "monthly", "2026-08-02", 99, possibly_stopped=True),
             item("Power", "monthly", "2026-10-30", 2000, state="charged_again")]
    assert [b["vendor"] for b in fc.bill_items(items)] == ["Rent", "Netflix", "Power"]


def test_due_days_monthly_weekly_yearly():
    assert fc.due_days(item("Gym", "monthly", "2026-10-31", 1), 2026, 11) == [30]  # November has 30 days
    assert fc.due_days(item("Maid", "weekly", "2026-10-24", 1), 2026, 10) == [3, 10, 17, 24, 31]
    assert fc.due_days(item("Prime", "yearly", "2026-11-14", 1), 2026, 11) == [14]
    assert fc.due_days(item("Prime", "yearly", "2026-11-14", 1), 2026, 12) == []


def test_bills_in_month_skips_charged_and_keeps_late():
    rent = item("Rent", "monthly", "2026-11-05", 25000)  # charged on 5 Oct already
    power = item("City Power", "monthly", "2026-10-18", 2000)  # expected 18 Oct, not seen yet: late
    phone = item("SkyTel", "monthly", "2026-10-28", 499)
    txns = [t("2026-10-05", 25000, "Rent", "Housing")]
    due = fc.bills_in_month(fc.bill_items([rent, power, phone]), 2026, 10, TODAY, txns)
    assert [(b["vendor"], b["day"]) for b in due] == [("City Power", 22), ("SkyTel", 28)]
    nov = fc.bills_in_month(fc.bill_items([rent, power, phone]), 2026, 11, TODAY, txns)
    assert sorted(b["vendor"] for b in nov) == ["City Power", "Rent", "SkyTel"]


def test_is_bill_matches_vendor_spelling():
    bills = fc.bill_items([item("Netflix.com", "monthly", "2026-11-02", 649, kind="subscription")])
    assert fc.is_bill(t("2026-10-02", 649, "NETFLIX com"), bills)
    assert not fc.is_bill(t("2026-10-02", 649, "Netmeds"), bills)


def test_a_weekly_bill_counts_once_per_week_and_a_yearly_one_in_its_month():
    maid = item("Maid", "weekly", "2026-10-24", 1200)
    prime = item("Prime", "yearly", "2027-01-14", 1500, kind="subscription")
    dec = fc.bills_in_month(fc.bill_items([maid, prime]), 2026, 12, TODAY, [])
    assert [b["vendor"] for b in dec].count("Maid") == 4 and "Prime" not in [b["vendor"] for b in dec]
    jan = fc.bills_in_month(fc.bill_items([maid, prime]), 2027, 1, TODAY, [])
    assert [b for b in jan if b["vendor"] == "Prime"] == [{"vendor": "Prime", "category": "Bills", "amount": 1500, "day": 14}]
