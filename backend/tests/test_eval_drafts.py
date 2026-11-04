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


def test_every_reason_uses_its_own_numbers():
    from evals.suites import drafts

    assert drafts.run("groq", "dev")["metrics"]["reason_mismatches"] == []
