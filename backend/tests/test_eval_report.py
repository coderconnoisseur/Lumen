"""evals.report: README tables come from release results, never typed (SPEC-EVAL AC 6)."""
import json

import pytest


def _release(sql_passed=28, models=None):
    rate = lambda p, t, lo, hi: {"passed": p, "total": t, "value": p / t, "ci95": [lo, hi]}
    return {
        "tier": "openrouter", "suites": {
            "sql": {"metrics": {
                "execution_accuracy": rate(sql_passed, 30, 0.79, 0.98),
                "strict_execution_accuracy": rate(20, 30, 0.49, 0.81),
                "fallback_rate": rate(0, 30, 0.0, 0.11),
                "ops": {"latency_s_recorded": {"p50": 2.391, "p95": 15.781},
                        "cost_usd_per_question_list_price": 0.000481,
                        "models": models or {"nvidia/nemotron-3-ultra-550b-a55b:free": 21}},
            }},
            "safety": {"metrics": {"tenant_leaks": 0, "injections_followed": 2}},
        },
    }


@pytest.fixture
def results(tmp_path):
    d = tmp_path / "results"
    d.mkdir()
    (d / "release-0-openrouter-dev.json").write_text(json.dumps(_release(26)), encoding="utf-8")
    (d / "release-1-openrouter-dev.json").write_text(json.dumps(_release(28)), encoding="utf-8")
    (d / "dev-openrouter-dev.json").write_text(json.dumps(_release(1)), encoding="utf-8")  # never reported
    return d


def test_latest_release_per_tier_and_split_wins(results):
    from evals.report import latest_releases

    releases = latest_releases(results)
    assert list(releases) == [("openrouter", "dev")]
    assert releases[("openrouter", "dev")][0] == 1


def test_cells_show_counts_and_intervals(results):
    from evals.report import latest_releases, table

    text = table(latest_releases(results), "dev")
    assert "| openrouter (release 1) |" in text
    assert "28/30 (93%, CI 79%-98%)" in text
    assert "20/30 (67%, CI 49%-81%)" in text
    assert "2.4 s / 15.8 s" in text and "$0.00048" in text
    assert "| Prompt injections followed (must be 0) | 2 |" in text
    assert "`nvidia/nemotron-3-ultra-550b-a55b:free`" in text
    assert "Extraction" not in text  # suites without results are left out, not shown as zeros


def test_readme_is_rewritten_only_between_the_markers(results, tmp_path):
    from evals.report import main

    readme = tmp_path / "README.md"
    readme.write_text("# Lumen\nintro\n<!-- eval:start -->\nold numbers\n<!-- eval:end -->\nfooter\n",
                      encoding="utf-8")
    main([], results_dir=results, readme=readme)
    first = readme.read_text(encoding="utf-8")
    assert first.startswith("# Lumen\nintro\n<!-- eval:start -->\n") and first.endswith("<!-- eval:end -->\nfooter\n")
    assert "old numbers" not in first and "28/30" in first and "_No test-split release results yet._" in first
    main([], results_dir=results, readme=readme)
    assert readme.read_text(encoding="utf-8") == first  # idempotent
    assert (results / "release-1-openrouter-dev.md").exists()


def test_missing_markers_are_an_error():
    from evals.report import update_readme

    with pytest.raises(ValueError, match="markers"):
        update_readme("# no markers here", "x")


def test_the_real_readme_has_the_markers():
    from evals.report import END, README, START

    text = README.read_text(encoding="utf-8")
    assert START in text and END in text
