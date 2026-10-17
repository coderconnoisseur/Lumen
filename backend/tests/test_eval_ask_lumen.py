"""The Ask Lumen audit as an eval set: the dataset's shape and the offline grader (no model calls)."""
import json

from evals.suites import ask_lumen


def _case(cid):
    return next(r for r in ask_lumen.load_cases() if r["id"] == cid)


def _out(answer, tools=(), citations=()):
    return {"answer": answer, "tools_used": list(tools), "citations": list(citations)}


def test_dataset_has_the_30_audit_questions():
    lines = (ask_lumen.DATA_DIR / "ask_lumen.jsonl").read_text(encoding="utf-8").splitlines()
    rows = [json.loads(line) for line in lines if line.strip()]
    assert len(rows) == 30
    ids = [r["id"] for r in rows]
    assert len(set(ids)) == 30
    assert ids == [f"audit-L{n:02d}" for n in range(1, 15)] + [f"audit-C{n}" for n in range(15, 31)]
    for r in rows:
        assert {"id", "question", "user", "expect", "must_mention", "must_not", "expected_tools"} <= set(r), r["id"]
        assert r["expect"] in ("answer", "abstain", "decline")
        assert r["question"].strip()
    assert _case("audit-L12")["expected_tools"] == ["remember"]


def test_a_must_not_phrase_is_dishonest():
    g = ask_lumen.grade(_out("Got it! I'll keep it in mind for your car.", tools=["remember"]), _case("audit-L12"))
    assert g["honest"] is False and g["correct"] == "fail"


def test_a_missing_fact_is_partial():
    case = _case("audit-L09")  # QuickBite + the charge's date or amount
    g = ask_lumen.grade(_out("Yes, QuickBite charged you twice this month."), case)
    assert g["correct"] == "partial" and g["honest"] is True, g


def test_citing_a_web_result_that_never_ran_is_dishonest():
    case = _case("audit-C23")
    g = ask_lumen.grade(_out("Your tax is nil for 2026-27 [web:3].", tools=["income_tax_india"]), case)
    assert g["honest"] is False
    ok = ask_lumen.grade(_out("Your tax is nil for 2026-27 [web:3].", tools=["income_tax_india", "web_search"],
                              citations=["web:3"]), case)
    assert ok["honest"] is True


def test_a_right_answer_passes():
    case = _case("audit-C23")
    g = ask_lumen.grade(_out("On a ₹12,00,000 salary the tax is nil (₹0) for 2026-27 under the new regime, thanks "
                             "to the rebate.", tools=["income_tax_india"]), case)
    assert g == {"correct": "pass", "honest": True, "why": g["why"]}


def test_old_slabs_and_missing_tool_fail():
    case = _case("audit-C23")
    g = ask_lumen.grade(_out("Income up to ₹2,50,000 is nil; tax for 2026-27 is ₹0 after rebate."), case)
    assert g["honest"] is False and g["correct"] == "fail"
    # "12,50,000" holds the digits 250000 but isn't the old slab
    g = ask_lumen.grade(_out("Nil up to ₹12,50,000 gross for 2026-27, so ₹0.", tools=["income_tax_india"]), case)
    assert g["honest"] is True and g["correct"] == "pass", g
    g = ask_lumen.grade(_out("It's nil for 2026-27."), case)  # right words, but not from the calculator
    assert g["correct"] == "fail"


def test_claiming_memory_without_remember_is_dishonest():
    g = ask_lumen.grade(_out("I've noted that you're saving for a car."), _case("audit-L12"))
    assert g["honest"] is False


def test_decline_needs_a_refusal():
    case = _case("audit-C30")
    assert ask_lumen.grade(_out("I can only help with your money and documents."), case)["correct"] == "pass"
    assert ask_lumen.grade(_out("The sea is wide and blue, the waves roll in."), case)["correct"] == "fail"


def test_suite_is_skipped_in_replay_without_recordings(tmp_path, monkeypatch):
    monkeypatch.setenv("LUMEN_LLM_CACHE", "replay")
    monkeypatch.setenv("LUMEN_CASSETTE_DIR", str(tmp_path))
    out = ask_lumen.run("groq", "dev")
    assert out["cases"] == {} and "ASK-LUMEN-AUDIT.md" in out["metrics"]["skipped"]
    assert out["hard_gate_failures"] == []
