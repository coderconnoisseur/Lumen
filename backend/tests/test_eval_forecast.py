"""The forecast eval (spec 2026-10-28 §5): both methods backtested on synthetic and demo users, gated on accuracy."""
import pytest

pytestmark = pytest.mark.eval


def test_eval_forecast_passes_its_gates():
    from evals.suites import forecast

    out = forecast.run("groq", "dev")
    m = out["metrics"]
    print("\nforecast eval:", m)
    assert out["hard_gate_failures"] == [], out["hard_gate_failures"]
    assert m["users"] == 3 and m["chosen"]["months_tested"] >= 15
    assert m["baseline"]["median_error_pct"] is not None  # the old smoothing forecast, scored the same way


def test_every_why_line_uses_its_own_numbers():
    from evals.suites import forecast

    assert forecast.run("groq", "dev")["metrics"]["why_mismatches"] == []
