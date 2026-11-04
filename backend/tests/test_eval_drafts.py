"""The drafts eval (spec 2026-11-04 §5): new rule against today's on the same months, gated."""
import pytest

pytestmark = pytest.mark.eval


def test_eval_drafts_passes_its_gates():
    from evals.suites import drafts

    out = drafts.run("groq", "dev")
    m = out["metrics"]
    print("\ndrafts eval:", m)
    assert out["hard_gate_failures"] == [], out["hard_gate_failures"]
    assert m["users"] == 3 and m["new"]["lines"] >= 100
    assert 20000 <= m["laptop_shift"]["baseline_median"] <= 30000  # today's rule: a third of the laptop
    assert m["found_failures"] == []
    assert m["laptop_shift"]["new_p90"] is not None and m["control"]["lines"] >= 100  # 75th percentile, one-offs kept in


def test_the_found_bill_case_needs_the_recurring_check(monkeypatch):
    """Guards the eval itself: without the recurring check a bill's rise would be told as a purchase."""
    from ai import home_signals
    from evals.suites import drafts, forecast

    key, txns, today = forecast.users()[0]
    assert drafts._found_failures(key, txns, today) == []
    monkeypatch.setattr(drafts, "_spikes", lambda rows, now, recurring: home_signals._spikes(rows, now, []))
    assert any("bill rises" in f for f in drafts._found_failures(key, txns, today))


def test_every_reason_uses_its_own_numbers():
    from evals.suites import drafts

    assert drafts.run("groq", "dev")["metrics"]["reason_mismatches"] == []
