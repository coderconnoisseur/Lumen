"""evals/run.py: splits, deterministic output, the paired regression gate, record modes."""
import json

import pytest


def _suite(cases, metrics=None, hard=None):
    def run(tier, split):
        return {"cases": dict(cases), "metrics": metrics or {}, "hard_gate_failures": list(hard or [])}
    return run


@pytest.fixture
def workdir(tmp_path, monkeypatch):
    monkeypatch.setenv("LUMEN_CASSETTE_DIR", str(tmp_path / "cassettes"))
    return tmp_path


def _run(workdir, args, suites):
    from evals import run

    return run.main(args, suites=suites, results_dir=workdir / "results")


def test_test_split_is_refused_without_release(workdir):
    from evals import run

    with pytest.raises(SystemExit):
        _run(workdir, ["--tier", "groq", "--split", "test"], {"s": _suite({"a": True})})


def test_dev_run_writes_deterministic_results(workdir):
    suites = {"s": _suite({"a": True, "b": False}, {"accuracy": {"passed": 1, "total": 2}})}
    assert _run(workdir, ["--tier", "groq"], suites) == 0
    first = (workdir / "results" / "dev-groq-dev.json").read_bytes()
    assert _run(workdir, ["--tier", "groq"], suites) == 0
    assert (workdir / "results" / "dev-groq-dev.json").read_bytes() == first
    data = json.loads(first)
    assert data["suites"]["s"]["cases"] == {"a": True, "b": False}


def test_replay_is_the_default_cache_mode(workdir, monkeypatch):
    import os

    seen = {}

    def suite(tier, split):
        seen["mode"] = os.environ.get("LUMEN_LLM_CACHE")
        seen["tier"] = os.environ.get("LUMEN_LLM_TIER")
        return {"cases": {}, "metrics": {}, "hard_gate_failures": []}

    _run(workdir, ["--tier", "groq"], {"s": suite})
    assert seen == {"mode": "replay", "tier": "groq"}


def _release(workdir, n, tier, split, cases):
    path = workdir / "results" / f"release-{n}-{tier}-{split}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"release": n, "suites": {"s": {"cases": cases}}}), encoding="utf-8")


def test_two_regressions_against_the_last_release_fail_and_are_named(workdir, capsys):
    _release(workdir, 0, "groq", "dev", {"a": True, "b": True, "c": True})
    _release(workdir, 1, "groq", "dev", {"a": True, "b": True, "c": False})  # newest release is the reference
    code = _run(workdir, ["--tier", "groq"], {"s": _suite({"a": False, "b": False, "c": True})})
    out = capsys.readouterr().out
    assert code == 1
    assert "regressed" in out and "a" in out and "b" in out
    data = json.loads((workdir / "results" / "dev-groq-dev.json").read_text())
    assert data["suites"]["s"]["changes"] == {"regressed": ["a", "b"], "fixed": ["c"], "new": []}


def test_one_regression_passes_the_gate_but_is_listed(workdir, capsys):
    _release(workdir, 0, "groq", "dev", {"a": True, "b": True})
    assert _run(workdir, ["--tier", "groq"], {"s": _suite({"a": False, "b": True})}) == 0
    assert "a" in capsys.readouterr().out


def test_hard_gate_failure_fails_the_run(workdir):
    assert _run(workdir, ["--tier", "groq"], {"s": _suite({}, hard=["tenant leak: q7"])}) == 1


def test_release_run_is_written_as_the_next_release(workdir):
    _release(workdir, 0, "groq", "test", {"a": True})
    code = _run(workdir, ["--tier", "groq", "--split", "test", "--release", "1"], {"s": _suite({"a": True})})
    assert code == 0
    assert (workdir / "results" / "release-1-groq-test.json").exists()


def test_record_rerecords_a_suite_from_scratch(workdir):
    from llm import cassette

    path = workdir / "cassettes" / "groq" / "s.jsonl"
    path.parent.mkdir(parents=True)
    path.write_text('{"key": "old", "entry": {}}\n', encoding="utf-8")
    seen = {}

    def suite(tier, split):
        import os
        seen["mode"] = os.environ["LUMEN_LLM_CACHE"]
        return {"cases": {}, "metrics": {}, "hard_gate_failures": []}

    _run(workdir, ["--tier", "groq", "--suite", "s", "--record"], {"s": suite})
    assert seen["mode"] == "record" and not path.exists()
    cassette.clear_memory()


def test_record_only_missing_keeps_existing_lines(workdir):
    path = workdir / "cassettes" / "groq" / "s.jsonl"
    path.parent.mkdir(parents=True)
    path.write_text('{"key": "old", "entry": {}}\n', encoding="utf-8")
    _run(workdir, ["--tier", "groq", "--suite", "s", "--record", "--only-missing"], {"s": _suite({})})
    assert path.read_text(encoding="utf-8") == '{"key": "old", "entry": {}}\n'


def test_only_missing_requires_record(workdir):
    with pytest.raises(SystemExit):
        _run(workdir, ["--tier", "groq", "--only-missing"], {"s": _suite({})})
