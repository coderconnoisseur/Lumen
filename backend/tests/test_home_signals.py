"""UI revamp Phase 3: Home's "Lumen found" signals and activity feed (ai/home_signals.py), pure functions."""
from datetime import date, datetime

from ai.home_signals import _spikes, activity, find_signals

TODAY = date(2026, 10, 21)


def t(d, amount, vendor="Croma", category="Electronics", **kw):
    return {"vendor_name": vendor, "date": d, "total_amount": amount, "category": category, **kw}


def kinds(items):
    return [i["kind"] for i in items]


def test_duplicate_same_vendor_amount_within_a_day():
    [d] = find_signals([t("2026-10-14", 2499), t("2026-10-15", 2499.5, vendor="CROMA ")], TODAY, 0, [])
    assert d == {"kind": "duplicate", "tag": "DUPLICATES", "subject": "Croma", "headline": "Possible double charge: Croma {0}",
                 "detail": "Charged on 14 Oct and 15 Oct.", "amounts": [2499], "worth": 2499, "href": None}


def test_same_day_duplicate_wording():
    [d] = find_signals([t("2026-10-14", 300), t("2026-10-14", 300)], TODAY, 0, [])
    assert d["detail"] == "Charged twice on 14 Oct."


def test_no_duplicate_two_days_apart_or_old():
    assert find_signals([t("2026-10-14", 2499), t("2026-10-16", 2499)], TODAY, 0, []) == []
    assert find_signals([t("2026-08-01", 2499), t("2026-08-01", 2499)], TODAY, 0, []) == []


def test_spike_needs_30pct_and_floor():
    small = [t("2026-09-05", 600, "Swiggy", "Food"), t("2026-10-05", 810, "Swiggy", "Food")]  # +35%, +210
    assert find_signals(small, TODAY, 0, []) == []
    big = [t("2026-09-05", 5000, "Swiggy", "Food"), t("2026-10-05", 6750, "Swiggy", "Food")]  # +35%, +1750
    [s] = find_signals(big, TODAY, 0, [])
    assert s == {"kind": "spike", "tag": "SPENDING", "subject": "Food", "headline": "Food is up 35%",
                 "detail": "{0} so far vs {1} by this point last month.", "amounts": [6750, 5000], "worth": None,
                 "href": "/spending?category=Food"}


def test_spike_only_counts_days_up_to_today():
    late_last_month = [t("2026-09-28", 9000, "X", "Food"), t("2026-09-05", 2000, "X", "Food"), t("2026-10-05", 3500, "X", "Food")]
    assert kinds(find_signals(late_last_month, TODAY, 0, [])) == ["spike"]  # 3500 vs 2000 by the 21st


def test_spike_ignores_refund_month():
    refunds = [t("2026-09-05", -4000, "X", "Food"), t("2026-10-05", 3000, "X", "Food")]
    assert find_signals(refunds, TODAY, 0, []) == []


def test_price_rise_from_recurring():
    rec = [{"vendor": "Spotify", "cadence": "monthly", "last_charge_date": "2026-10-02",
            "price_change": {"previous": 119, "latest": 139, "percent": 16.8}},
           {"vendor": "Old", "cadence": "monthly", "last_charge_date": "2026-06-01",
            "price_change": {"previous": 100, "latest": 200, "percent": 100}},
           {"vendor": "Tiny", "cadence": "monthly", "last_charge_date": "2026-10-02",
            "price_change": {"previous": 100, "latest": 103, "percent": 3}}]
    [p] = find_signals([], TODAY, 0, rec)
    assert p == {"kind": "price_rise", "tag": "SUBSCRIPTIONS", "subject": "Spotify", "headline": "Spotify went up 17%",
                 "detail": "{0} → {1} a month.", "amounts": [119, 139], "worth": None, "href": "/bills"}


def test_order_and_review_item():
    rec = [{"vendor": "Spotify", "cadence": "monthly", "last_charge_date": "2026-10-02",
            "price_change": {"previous": 119, "latest": 139, "percent": 16.8}}]
    txns = [t("2026-10-14", 2499), t("2026-10-14", 2499),
            t("2026-09-05", 5000, "S", "Food"), t("2026-10-05", 6750, "S", "Food")]
    items = find_signals(txns, TODAY, 3, rec)
    assert kinds(items) == ["duplicate", "review", "spike", "price_rise"]
    assert items[1] == {"kind": "review", "tag": "RECEIPTS", "subject": None, "headline": "3 receipts need a glance",
                        "detail": "Lumen wasn't sure about these. Nothing is saved until you approve.",
                        "amounts": [], "worth": None, "href": "/receipts"}
    assert find_signals([], TODAY, 1, [])[0]["headline"] == "1 receipt needs a glance"


NOW = datetime(2026, 10, 21, 12, 0, 0)


def test_activity_groups_statement_rows():
    rows = [t("2026-10-01", 10, source="statement", created_at=datetime(2026, 10, 21, 10, 0, s)) for s in range(42)]
    assert activity(rows, [], NOW) == [{"kind": "statement_import", "text": "Imported a statement · 42 rows",
                                        "amounts": [], "at": "2026-10-21T10:00:00Z"}]


def test_activity_receipt_and_order():
    rows = [t("2026-10-14", 2499, created_at="2026-10-21 09:00:00"), t("2026-10-15", 99, vendor="Uber", created_at=datetime(2026, 10, 21, 11))]
    assert activity(rows, [], NOW) == [
        {"kind": "receipt", "text": "Read a receipt: Uber {0}", "amounts": [99], "at": "2026-10-21T11:00:00Z"},
        {"kind": "receipt", "text": "Read a receipt: Croma {0}", "amounts": [2499], "at": "2026-10-21T09:00:00Z"}]


def test_activity_labels_decisions_and_skips_superseded():
    events = [
        {"action": "proposal_approved", "actor": "user", "created_at": datetime(2026, 10, 21, 9), "type": "set_budget",
         "target": "Food", "detail": "{}"},
        {"action": "proposal_rejected", "actor": "user", "created_at": datetime(2026, 10, 21, 8), "type": "update_category",
         "target": "INV-1", "detail": "{}"},
        {"action": "proposal_rejected", "actor": "agent", "created_at": datetime(2026, 10, 21, 7), "type": "set_budget",
         "target": "Food", "detail": '{"superseded": true}'},
        {"action": "proposal_created", "actor": "agent", "created_at": datetime(2026, 10, 21, 6), "type": "set_budget",
         "target": "Food", "detail": "{}"},
    ]
    assert [a["text"] for a in activity([], events, NOW)] == ["You approved a Food budget", "You rejected a category change"]


def test_activity_keeps_newest_six():
    rows = [t("2026-10-01", i, vendor=f"V{i}", created_at=datetime(2026, 10, 21, i)) for i in range(10)]
    out = activity(rows, [], NOW)
    assert len(out) == 6 and out[0]["at"] == "2026-10-21T09:00:00Z"


def test_spike_ignores_partial_refund_month():
    rows = [t("2026-09-05", 2000, "X", "Food"), t("2026-09-06", -1800, "X", "Food"), t("2026-10-05", 1500, "X", "Food")]
    assert find_signals(rows, TODAY, 0, []) == []


def test_daily_habit_is_not_a_duplicate():
    coffee = [t(f"2026-10-{d:02d}", 180, "Blue Tokai", "Food") for d in range(10, 18)]
    assert find_signals(coffee, TODAY, 0, []) == []


def test_found_items_carry_their_subject():
    rec = [{"vendor": "Spotify", "cadence": "monthly", "last_charge_date": "2026-10-02",
            "price_change": {"previous": 119, "latest": 139, "percent": 16.8}}]
    txns = [t("2026-10-14", 2499), t("2026-10-14", 2499),
            t("2026-09-05", 5000, "S", "food"), t("2026-10-05", 6750, "S", "food")]
    assert [(i["kind"], i["subject"]) for i in find_signals(txns, TODAY, 2, rec)] == [
        ("duplicate", "Croma"), ("review", None), ("spike", "food"), ("price_rise", "Spotify")]


def test_spike_links_to_spending_filtered_to_its_category():
    # Spending opens filtered to the category (UI revamp Phase 5b); names are URL-encoded
    big = [t("2026-09-05", 5000, "X", "Food & Dining"), t("2026-10-05", 6750, "X", "Food & Dining")]
    [s] = find_signals(big, TODAY, 0, [])
    assert s["href"] == "/spending?category=Food%20%26%20Dining"


def test_a_same_day_double_charge_from_a_vendor_you_use_often_is_still_flagged():
    """Seen live: QuickBite (4 orders this month) charged 571 twice on 9 Oct, and Lumen found said nothing."""
    orders = [t("2026-10-04", 288, "QuickBite", "Food"), t("2026-10-08", 346, "QuickBite", "Food"),
              t("2026-10-09", 571, "QuickBite", "Food"), t("2026-10-09", 571, "QuickBite", "Food")]
    [d] = find_signals(orders, TODAY, 0, [])
    assert d["kind"] == "duplicate" and d["subject"] == "QuickBite" and d["detail"] == "Charged twice on 9 Oct."


def test_a_habit_vendor_on_neighbouring_days_is_still_not_a_duplicate():
    coffee = [t("2026-10-10", 180, "Blue Tokai", "Food"), t("2026-10-11", 180, "Blue Tokai", "Food"),
              t("2026-10-12", 180, "Blue Tokai", "Food")]
    assert find_signals(coffee, TODAY, 0, []) == []


# ---- naming the purchase behind a spike (spec 2026-11-04 §4.4) ----

SPIKE_TODAY = date(2026, 10, 21)


def buy(d, amount, vendor="Shop", category="Shopping"):
    return {"vendor_name": vendor, "date": d, "total_amount": amount, "category": category}


def spike(rows, recurring=None):
    return _spikes(rows, SPIKE_TODAY, recurring)[0]


def test_a_spike_from_one_purchase_names_it():
    s = spike([buy("2026-09-05", 5000), buy("2026-10-05", 5000), buy("2026-10-10", 20000, "TechHub")])
    assert s["headline"] == "{2} at TechHub pushed Shopping up 400%"
    assert s["amounts"] == [25000, 5000, 20000]
    assert s["detail"] == "{0} so far vs {1} by this point last month."


def test_a_broad_rise_names_nothing():
    rows = [buy("2026-09-05", 5000)] + [buy(f"2026-10-{d:02d}", 2000, f"V{d}") for d in range(1, 11)]
    s = spike(rows)
    assert s["headline"] == "Shopping is up 300%"
    assert s["amounts"] == [20000, 5000]


def test_two_similar_purchases_name_nothing():
    assert spike([buy("2026-09-05", 2000), buy("2026-10-05", 3000), buy("2026-10-06", 3000, "B")])["headline"] == "Shopping is up 200%"


def test_a_purchase_bigger_than_the_rise_is_still_named():
    assert spike([buy("2026-09-05", 2000), buy("2026-10-05", 80000, "TechHub")])["headline"] == "{2} at TechHub pushed Shopping up 3900%"


def test_a_usual_purchase_that_grew_names_nothing():
    assert spike([buy("2026-09-05", 5000), buy("2026-10-05", 7000)])["headline"] == "Shopping is up 40%"


def test_a_purchase_under_half_the_rise_names_nothing():
    rows = [buy("2026-09-05", 2000), buy("2026-10-05", 9000, "TechHub")] + [buy(f"2026-10-{d:02d}", 4000, f"V{d}") for d in (6, 7, 8)]
    assert spike(rows)["headline"] == "Shopping is up 950%"


def test_a_recurring_vendor_is_never_named():
    rows = [buy("2026-09-05", 5000, "City Power"), buy("2026-10-05", 5000, "City Power"), buy("2026-10-10", 20000, "City Power")]
    assert spike(rows, [{"vendor": "City Power"}])["headline"] == "Shopping is up 400%"


def test_a_blank_vendor_is_never_named():
    assert spike([buy("2026-09-05", 5000), buy("2026-10-05", 5000), buy("2026-10-10", 20000, None)])["headline"] == "Shopping is up 400%"
