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


# ---- Task 2: everyday spending ----

def test_robust_ignores_a_one_off():
    level, low, high = fc.robust_level([20000, 21000, 100000, 19000], 1)
    assert level < 30000 and low <= level <= high


def test_levels_never_negative():
    for method in fc.METHODS.values():
        level, low, high = method([-500, 200], 1)
        assert level >= 0 and low >= 0 and high >= 0


def test_holt_follows_a_trend():
    level, low, high = fc.holt_level([10000, 12000, 14000, 16000], 1)
    assert 16000 <= level <= 20000 and low <= level <= high


def test_ranges_widen_further_out():
    for method in fc.METHODS.values():
        h = [20000, 23000, 19000, 22000, 21000]
        _, lo1, hi1 = method(h, 1)
        _, lo3, hi3 = method(h, 3)
        assert hi3 - lo3 > hi1 - lo1


def test_too_little_history_returns_none():
    assert fc.robust_level([5000], 1) is None and fc.holt_level([5000], 1) is None and fc.robust_level([], 1) is None


def test_monthly_everyday_excludes_bills_and_this_month():
    bills = fc.bill_items([item("Rent", "monthly", "2026-11-05", 25000, category="Housing")])
    txns = [t("2026-08-05", 25000, "Rent"), t("2026-08-10", 3000), t("2026-09-05", 25000, "Rent"), t("2026-09-11", 4000),
            t("2026-09-12", -500), t("2026-10-03", 9000)]  # October is this month: not history
    assert fc.monthly_everyday(txns, bills, TODAY) == [("2026-08", 3000.0), ("2026-09", 3500.0)]


# ---- Task 3: the forecast for one method ----

def history_txns():
    """Rent every month, groceries ~12k/month (Jul-Sep), and this month so far."""
    out = []
    for m, g in (("07", 12000), ("08", 11000), ("09", 13000)):
        out += [t(f"2026-{m}-05", 25000, "Rent", "Housing"), t(f"2026-{m}-10", g / 2), t(f"2026-{m}-20", g / 2, "Cafe", "Restaurant")]
    out += [t("2026-10-05", 25000, "Rent", "Housing"), t("2026-10-10", 4000)]
    return out


RENT = item("Rent", "monthly", "2026-11-05", 25000, category="Housing", last_charge_date="2026-10-05")
POWER = item("City Power", "monthly", "2026-10-28", 2000, category="Utilities")


def test_forecast_adds_up():
    f = fc.forecast_months(history_txns(), [RENT, POWER], TODAY, "bills_everyday")
    cur, months = f["current"], f["months"]
    assert [m["month"] for m in months] == ["2026-10", "2026-11", "2026-12", "2027-01"]
    assert cur["spent_so_far"] == 29000 and cur["bills_still_due"] == {"count": 1, "amount": 2000.0}
    assert cur["days_left"] == 9
    assert abs(months[0]["forecast"] - (29000 + 2000 + cur["everyday_rest"])) < 1
    for m in months[1:]:
        assert abs(m["forecast"] - (m["bills"] + m["everyday"])) < 1 and m["bills"] == 27000
        assert m["low"] <= m["forecast"] <= m["high"]


def test_no_history_no_forecast():
    assert fc.forecast_months([t("2026-10-03", 500)], [], TODAY, "bills_everyday") is None


def test_last_day_and_first_day():
    last = fc.forecast_months(history_txns(), [RENT], date(2026, 10, 31), "holt")
    assert last["current"]["days_left"] == 0 and last["current"]["everyday_rest"] == 0
    first = fc.forecast_months(history_txns()[:-2], [RENT], date(2026, 10, 1), "bills_everyday")
    assert first["current"]["spent_so_far"] == 0 and first["current"]["days_left"] == 30


def test_budget_and_income_fields():
    budgets = {"2026-10": {"total": 30000, "categories": {"Groceries": 5000}}}
    f = fc.forecast_months(history_txns(), [RENT, POWER], TODAY, "bills_everyday", budgets=budgets, income=50000)
    oct_, nov = f["months"][0], f["months"][1]
    assert oct_["budget"] == 30000 and oct_["over_budget"] is True and oct_["left"] == round(50000 - oct_["forecast"], 2)
    assert nov["budget"] is None and nov["over_budget"] is None
    plain = fc.forecast_months(history_txns(), [RENT], TODAY, "bills_everyday")
    assert plain["months"][0]["left"] is None and plain["months"][0]["income"] is None
    groceries = next(c for c in oct_["categories"] if c["category"] == "Groceries")
    assert groceries["budget"] == 5000 and groceries["spent"] == 4000


def test_categories_cover_bills_and_everyday():
    f = fc.forecast_months(history_txns(), [RENT, POWER], TODAY, "bills_everyday")
    for m in f["months"]:
        assert abs(sum(c["forecast"] for c in m["categories"]) - m["forecast"]) < 2
    nov = {c["category"]: c["forecast"] for c in f["months"][1]["categories"]}
    assert nov["Housing"] == 25000 and nov["Utilities"] == 2000 and nov["Groceries"] > 0 and nov["Restaurant"] > 0


def test_yearly_bill_lands_in_its_month():
    prime = item("Prime", "yearly", "2027-01-14", 1500, kind="subscription", category="Entertainment")
    f = fc.forecast_months(history_txns(), [RENT, prime], TODAY, "bills_everyday")
    assert [m["bills"] for m in f["months"][1:]] == [25000, 25000, 26500]


def test_daily_path_runs_from_today_to_month_end():
    f = fc.forecast_months(history_txns(), [RENT, POWER], TODAY, "bills_everyday")
    d = f["daily"]
    assert len(d["actual"]) == 22 and d["actual"][-1] == 29000
    assert len(d["path"]) == 10 and d["path"][0] == 29000 and abs(d["path"][-1] - f["months"][0]["forecast"]) < 1
