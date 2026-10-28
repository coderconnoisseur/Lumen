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


# ---- Task 4: backtest, choice, accuracy ----

def year_txns(groceries=12000):
    """A year of rent (a detectable bill) and steady groceries, Oct 2025 - Oct 2026."""
    out = []
    for n in range(13):
        y, m = divmod(2025 * 12 + 9 + n, 12)
        ym = f"{y}-{m + 1:02d}"
        if ym > "2026-10":
            break
        out += [t(f"{ym}-05", 25000, "Rent", "Housing"), t(f"{ym}-12", groceries / 2), t(f"{ym}-24", groceries / 2)]
    return [x for x in out if x["date"] <= "2026-10-22"]


def test_backtest_uses_only_the_past():
    base = fc.backtest(year_txns(), TODAY, "bills_everyday")
    spiked = year_txns() + [t("2026-09-15", 90000, "Laptop store", "Electronics")]
    after = fc.backtest(spiked, TODAY, "bills_everyday")
    sep_before = next(r for r in base if r["month"] == "2026-09")
    sep_after = next(r for r in after if r["month"] == "2026-09")
    assert sep_after["predicted"] == sep_before["predicted"]  # September's own spike can't inform September
    assert sep_after["actual"] == sep_before["actual"] + 90000
    assert [r["month"] for r in base] == ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]


def test_score_median_and_range():
    rows = [{"month": "a", "actual": 100, "predicted": 110, "low": 90, "high": 120},
            {"month": "b", "actual": 100, "predicted": 80, "low": 85, "high": 95},
            {"month": "c", "actual": 200, "predicted": 210, "low": 190, "high": 230}]
    assert fc.score(rows) == {"median_error_pct": 10.0, "in_range_pct": 66.7, "months_tested": 3}


def test_steady_spending_is_forecast_closely():
    s = fc.score(fc.backtest(year_txns(), TODAY, "bills_everyday"))
    assert s["months_tested"] == 6 and s["median_error_pct"] < 2


def test_choice_prefers_lower_error_and_ties_go_to_bills_everyday(monkeypatch):
    def fake(errs):
        return lambda txns, today, method, **kw: [
            {"month": str(i), "actual": 100, "predicted": 100 + errs[method], "low": 0, "high": 999} for i in range(4)]
    monkeypatch.setattr(fc, "backtest", fake({"bills_everyday": 8, "holt": 5}))
    c = fc.choose([], TODAY)
    assert c["method"] == "holt" and c["accuracy"]["median_error_pct"] == 5.0
    assert [x["method"] for x in c["accuracy"]["tried"]] == ["bills_everyday", "holt"]
    monkeypatch.setattr(fc, "backtest", fake({"bills_everyday": 5, "holt": 5}))
    assert fc.choose([], TODAY)["method"] == "bills_everyday"


def test_too_little_history_says_so():
    c = fc.choose(year_txns()[-9:], TODAY)  # three months of data: at most one month can be backtested
    assert c["method"] == "bills_everyday" and c["accuracy"]["months_tested"] < 3 and "median_error_pct" not in c["accuracy"]


def test_mid_month_cut_counts_spent_to_the_cut():
    rows = fc.backtest(year_txns(), TODAY, "bills_everyday", cut_day=15)
    sep = next(r for r in rows if r["month"] == "2026-09")
    assert sep["low"] >= 25000 + 6000  # rent and the 12th's groceries are already spent by the 15th


def test_forecast_carries_accuracy_and_what_if_items():
    weekly = item("Maid", "weekly", "2026-10-24", 1200)
    yearly = item("Prime", "yearly", "2027-01-14", 1200, kind="subscription")
    rent = item("Rent", "monthly", "2026-11-05", 25000, category="Housing")
    f = fc.forecast(year_txns(), [rent, weekly, yearly], TODAY)
    assert f["method"] in fc.METHODS and f["accuracy"]["months_tested"] == 6
    eq = {i["vendor"]: i["monthly_equivalent"] for i in f["items"]}
    assert eq == {"Rent": 25000, "Maid": 5200, "Prime": 100}


# ---- Task 5: the why line ----

def test_why_names_a_big_one_off_this_month():
    txns = history_txns() + [t("2026-10-17", 18514, "TechHub Electronics", "Shopping")]
    f = fc.forecast_months(txns, [RENT], TODAY, "bills_everyday")
    assert f["months"][0]["why"] == "Higher than usual: the ₹18,514 TechHub Electronics order on 17 Oct."


def test_why_names_a_yearly_renewal_and_widening_ranges():
    prime = item("Prime", "yearly", "2027-01-14", 1500, kind="subscription", category="Entertainment")
    f = fc.forecast_months(history_txns(), [RENT, prime], TODAY, "bills_everyday")
    assert f["months"][3]["why"] == "Includes the yearly ₹1,500 Prime renewal on 14 Jan. Ranges widen further out."


def test_why_says_a_cancelled_subscription_drops_out():
    flix = item("StreamFlix", "monthly", "2026-11-10", 766, kind="subscription", state="cancelled",
                last_charge_date="2026-10-10")
    f = fc.forecast_months(history_txns(), [RENT, flix], TODAY, "bills_everyday")
    assert f["months"][1]["why"] == "Lower: StreamFlix is cancelled."
    assert "StreamFlix" not in f["months"][2]["why"]


def test_why_default_is_the_usual_month():
    f = fc.forecast_months(history_txns(), [RENT], TODAY, "bills_everyday")
    assert f["months"][2]["why"] == "Your usual month: 1 bill and everyday spending like Jul–Sep."
    f2 = fc.forecast_months(history_txns(), [RENT, POWER], TODAY, "bills_everyday", currency="USD")
    assert f2["months"][1]["why"] == "Your usual month: 2 bills and everyday spending like Jul–Sep."


# ---- review fixes ----

def test_cancelling_a_subscription_lowers_the_months_after():
    """Review #1: its past charges must not slide into everyday history and come straight back."""
    txns = history_txns() + [t(f"2026-{m}-10", 766, "StreamFlix", "Entertainment") for m in ("07", "08", "09", "10")]
    flix = item("StreamFlix", "monthly", "2026-11-10", 766, kind="subscription", category="Entertainment",
                state="cancelled", last_charge_date="2026-10-10")
    active = {**flix, "state": "active"}
    kept = fc.forecast_months(txns, [RENT, active], TODAY, "bills_everyday")["months"][1]
    gone = fc.forecast_months(txns, [RENT, flix], TODAY, "bills_everyday")["months"][1]
    assert gone["forecast"] == kept["forecast"] - 766 and gone["everyday"] == kept["everyday"]
    assert gone["why"] == "Lower: StreamFlix is cancelled."


def test_a_long_missed_yearly_bill_isnt_due_every_month():
    """Review #2: late counts only within one period of its due date."""
    insurance = item("Insurance", "yearly", "2026-03-14", 12000)
    assert fc.bills_in_month(fc.bill_items([insurance]), 2026, 10, TODAY, []) == []
    power = item("City Power", "monthly", "2026-09-30", 2000)  # due last month, not seen: still late
    assert [b["day"] for b in fc.bills_in_month(fc.bill_items([power]), 2026, 10, TODAY, [])] == [22]
    old = item("Old", "monthly", "2026-08-15", 2000)  # two periods late: not due
    assert fc.bills_in_month(fc.bill_items([old]), 2026, 10, TODAY, []) == []


def test_a_weekly_bill_paid_today_isnt_due_again_today():
    """Review #3."""
    maid = item("Maid", "weekly", "2026-10-29", 1200)
    due = fc.bills_in_month(fc.bill_items([maid]), 2026, 10, TODAY, [t("2026-10-22", 1200, "Maid")])
    assert [b["day"] for b in due] == [29]


def test_higher_than_usual_only_when_the_month_is_higher():
    """Review #7: a big purchase in a quiet month doesn't make the month 'higher than usual'."""
    txns = history_txns()[:-1] + [t("2026-10-05", 6500, "Croma", "Shopping")]  # usual everyday ~12,000
    f = fc.forecast_months(txns, [RENT], date(2026, 10, 29), "bills_everyday")
    assert not f["months"][0]["why"].startswith("Higher than usual")


def test_a_cancelled_yearly_plan_doesnt_claim_this_month_is_lower():
    """Review F2: a yearly subscription last paid last month wouldn't have been charged this month anyway."""
    yearly = item("CloudVault", "yearly", "2027-09-14", 1500, kind="subscription", state="cancelled",
                  last_charge_date="2026-09-14")
    f = fc.forecast_months(history_txns(), [RENT, yearly], TODAY, "bills_everyday")
    assert all("CloudVault" not in m["why"] for m in f["months"])
