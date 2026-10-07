"""evals/metrics.py: every metric checked against a hand-computed value (SPEC-EVAL)."""
import math

import pytest


# --- confidence intervals and reporting -------------------------------------------


def test_wilson_interval_matches_the_textbook_value():
    from evals.metrics import wilson_interval

    # 41/50 at 95%: centre (p + z^2/2n)/(1 + z^2/n), half-width per Wilson.
    low, high = wilson_interval(41, 50)
    assert low == pytest.approx(0.6920, abs=1e-4)
    assert high == pytest.approx(0.9023, abs=1e-4)


def test_wilson_interval_edges():
    from evals.metrics import wilson_interval

    assert wilson_interval(0, 0) == (0.0, 1.0)
    low, high = wilson_interval(10, 10)
    assert high == 1.0 and low == pytest.approx(0.7225, abs=1e-4)


def test_rate_reports_counts_and_interval():
    from evals.metrics import rate

    r = rate(3, 4)
    assert (r["passed"], r["total"], r["value"]) == (3, 4, 0.75)
    assert r["ci95"][0] < 0.75 < r["ci95"][1]


# --- text-to-SQL ----------------------------------------------------------------------


def test_result_sets_compare_as_multisets_with_money_at_two_decimals():
    from evals.metrics import result_sets_equal

    gold = [("Starbucks", 650.0), ("Reliance Fresh", 2400.0)]
    pred = [("Reliance Fresh", 2400.004), ("Starbucks", 650)]
    assert result_sets_equal(gold, pred, ordered=False)
    assert not result_sets_equal(gold, pred, ordered=True)
    assert not result_sets_equal(gold, gold + gold, ordered=False)  # multiset, not set


def test_result_sets_accept_dict_rows():
    from evals.metrics import result_sets_equal

    gold = [{"total": 3050.0}]
    assert result_sets_equal(gold, [{"total_spent": "3050.00"}], ordered=False)


def test_sql_fallback_counts_as_a_failure():
    from evals.metrics import sql_execution_accuracy

    cases = [
        {"gold": [(1,)], "pred": [(1,)], "ordered": False, "fallback": False},
        {"gold": [(1,)], "pred": [(1,)], "ordered": False, "fallback": True},  # right rows, wrong path
        {"gold": [(2,)], "pred": [(3,)], "ordered": False, "fallback": False},
        {"gold": [], "pred": [], "ordered": False, "fallback": True},
    ]
    acc = sql_execution_accuracy(cases)
    assert (acc["accuracy"]["passed"], acc["accuracy"]["total"]) == (1, 4)
    assert (acc["fallback_rate"]["passed"], acc["fallback_rate"]["total"]) == (2, 4)


# --- extraction ---------------------------------------------------------------------


def test_field_normalisation():
    from evals.metrics import normalise_field

    assert normalise_field("date", "14/09/2026") == "2026-09-14"
    assert normalise_field("total_amount", "Rs 1,121.00") == "1121.00"
    assert normalise_field("vendor_name", "  Sharma   Office Supplies ") == "sharma office supplies"
    assert normalise_field("invoice_number", " INV-20931 ") == "INV-20931"
    assert normalise_field("anything", None) is None


def test_field_level_precision_recall_f1():
    from evals.metrics import extraction_prf

    docs = [
        # vendor right, total wrong (counts as one FP and one FN), date missing (FN)
        ({"vendor_name": "Sharma", "total_amount": "1121.00", "date": "2026-09-14"},
         {"vendor_name": "sharma", "total_amount": "1112.00", "date": None}),
        # invoice number right, a hallucinated tax amount (FP)
        ({"invoice_number": "INV-1", "tax_amount": None},
         {"invoice_number": "INV-1", "tax_amount": "10"}),
    ]
    prf = extraction_prf(docs)
    # TP=2 (vendor, invoice), FP=2 (total, tax), FN=2 (total, date)
    assert (prf["overall"]["tp"], prf["overall"]["fp"], prf["overall"]["fn"]) == (2, 2, 2)
    assert prf["overall"]["precision"] == pytest.approx(0.5)
    assert prf["overall"]["recall"] == pytest.approx(0.5)
    assert prf["overall"]["f1"] == pytest.approx(0.5)
    assert prf["per_field"]["total_amount"] == {"tp": 0, "fp": 1, "fn": 1, "precision": 0.0, "recall": 0.0, "f1": 0.0}


# --- retrieval ------------------------------------------------------------------------


def test_recall_mrr_and_ndcg_on_a_hand_worked_ranking():
    from evals.metrics import mrr, ndcg_at_k, recall_at_k

    ranked = ["c9", "c2", "c7", "c1", "c5"]
    relevant = {"c2", "c5", "c8"}
    assert recall_at_k(ranked, relevant, 5) == pytest.approx(2 / 3)
    assert recall_at_k(ranked, relevant, 1) == 0.0
    assert mrr(ranked, relevant) == pytest.approx(1 / 2)
    dcg = 1 / math.log2(3) + 1 / math.log2(6)
    idcg = 1 / math.log2(2) + 1 / math.log2(3) + 1 / math.log2(4)
    assert ndcg_at_k(ranked, relevant, 10) == pytest.approx(dcg / idcg)


def test_retrieval_with_nothing_relevant_found():
    from evals.metrics import mrr, ndcg_at_k, recall_at_k

    assert recall_at_k(["a"], {"b"}, 5) == 0.0
    assert mrr(["a"], {"b"}) == 0.0
    assert ndcg_at_k(["a"], {"b"}, 10) == 0.0


# --- agent ----------------------------------------------------------------------------


def test_tool_selection_and_abstention_accuracy():
    from evals.metrics import abstention_accuracy, tool_selection_accuracy

    tools = tool_selection_accuracy([("run_sql", "run_sql"), ("search_documents", "run_sql"), ("run_sql", None)])
    assert (tools["passed"], tools["total"]) == (1, 3)
    abst = abstention_accuracy([
        {"answerable": False, "abstained": True},   # correct abstention
        {"answerable": True, "abstained": False},   # correct answer
        {"answerable": True, "abstained": True},    # over-cautious
        {"answerable": False, "abstained": False},  # made something up
    ])
    assert (abst["passed"], abst["total"]) == (2, 4)


# --- ops, judge, gating -----------------------------------------------------------------


def test_nearest_rank_percentiles():
    from evals.metrics import percentile

    values = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
    assert percentile(values, 50) == 5.0
    assert percentile(values, 95) == 10.0
    assert percentile([], 95) is None


def test_cohens_kappa():
    from evals.metrics import cohens_kappa

    judge = [1, 1, 0, 0, 1, 0, 1, 1, 0, 1]
    human = [1, 1, 0, 1, 1, 0, 1, 0, 0, 1]
    # agreement 8/10; P(yes)=0.6*0.6, P(no)=0.4*0.4 -> pe=0.52; kappa=(0.8-0.52)/0.48
    assert cohens_kappa(judge, human) == pytest.approx(0.28 / 0.48)
    assert cohens_kappa([1, 1], [1, 1]) == 1.0


def test_paired_regressions_list_ids_and_gate_on_count():
    from evals.metrics import gate_regressions, paired_changes

    previous = {"q1": True, "q2": True, "q3": False, "q4": True}
    current = {"q1": False, "q2": True, "q3": True, "q4": False, "q5": False}
    changes = paired_changes(previous, current)
    assert changes == {"regressed": ["q1", "q4"], "fixed": ["q3"], "new": ["q5"]}
    assert gate_regressions(changes, min_regressed=2) is False
    assert gate_regressions({"regressed": ["q1"], "fixed": [], "new": []}, min_regressed=2) is True


def test_relaxed_compare_accepts_extra_columns_but_not_wrong_values():
    from evals.metrics import result_sets_contain

    gold = [(1200.0,)]
    assert result_sets_contain(gold, [("FreshMart", 1200.0)], ordered=False)  # extra column
    assert not result_sets_contain(gold, [("FreshMart", 1199.0)], ordered=False)  # wrong value
    assert not result_sets_contain(gold, [], ordered=False)
    # Two gold columns may come back in any column order, but rows must still match as a set.
    gold2 = [("Groceries", 10.0), ("Transport", 5.0)]
    assert result_sets_contain(gold2, [(5.0, "Transport", 2), (10.0, "Groceries", 3)], ordered=False)
    assert not result_sets_contain(gold2, [(5.0, "Transport", 2), (10.0, "Groceries", 3)], ordered=True)
    assert not result_sets_contain(gold2, [("Groceries", 10.0)], ordered=False)  # a row is missing


@pytest.mark.parametrize("gold, answer, ok", [
    ([(35400.0,)], "You've spent **₹35,400** on your yoga membership.", True),          # sql-014
    ([("Keyboard",), ("Monitor 24in",), ("Wireless Mouse",), ("USB-C Cable",)],
     "- Keyboard\n- Monitor 24in\n- USB‑C Cable\n- Wireless Mouse", True),              # sql-041 (non-ASCII hyphen)
    ([(58.59571428571429,)], "about ₹58.60 per litre", True),
    ([(58.59571428571429,)], "about ₹58.66 per litre", False),                        # a different number
    ([("Keyboard",), ("Mouse",)], "Keyboard only", False),                             # one value missing
    ([], "nothing", False),
])
def test_answer_contains_every_gold_value(gold, answer, ok):
    from evals.metrics import answer_contains

    assert answer_contains(gold, answer) is ok
