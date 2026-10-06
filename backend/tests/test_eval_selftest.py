"""`pytest -m eval`: the harness end to end, offline (SPEC-EVAL)."""
import pytest

pytestmark = pytest.mark.eval


def test_selftest_suite_passes_its_gate(tmp_path):
    from evals import run

    assert run.main(["--tier", "openrouter", "--suite", "selftest"], results_dir=tmp_path) == 0
    assert (tmp_path / "dev-openrouter-dev.json").exists()
