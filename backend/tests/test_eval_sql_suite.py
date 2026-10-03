"""EVAL-03: the SQL suite scores the real SQL agent correctly (a fake model stands in for the LLM)."""
import json
import re

import pytest

from evals.suites.common import DATA_DIR


def _gold_by_question():
    rows = [json.loads(line) for line in (DATA_DIR / "sql.jsonl").read_text(encoding="utf-8").splitlines()]
    return {r["question"]: r["gold_sql"] for r in rows}


@pytest.fixture
def fake_model(monkeypatch):
    """Answer with the gold SQL ("perfect"), or with junk ("broken")."""
    import ai.sql_agent

    gold = _gold_by_question()
    prompts = []

    def install(mode):
        def chat_completion(prompt, **_):
            prompts.append(prompt)
            if mode == "broken":
                return "Sorry, I can't help with that."
            question = re.search(r"User Question: (.+)", prompt).group(1).strip()
            uid = re.search(r"user_id = '([0-9a-f-]{36})'", prompt).group(1)
            return (gold[question] or "SELECT 1").replace("{user_id}", uid)

        monkeypatch.setattr(ai.sql_agent, "chat_completion", chat_completion)
        return prompts

    return install


def test_a_perfect_model_scores_full_marks(fake_model):
    from evals.suites import sql

    prompts = fake_model("perfect")
    out = sql.run("openrouter", "dev")
    m = out["metrics"]
    answerable = len(out["cases"])
    assert answerable == 32  # 35 dev questions, 3 unanswerable
    assert m["execution_accuracy"]["passed"] == answerable
    assert m["relaxed_accuracy_diagnostic"]["passed"] == answerable
    assert m["fallback_rate"]["passed"] == 0
    assert m["unanswerable"]["total"] == 3
    assert out["hard_gate_failures"] == []
    assert all("Current Date: 2026-06-30" in p for p in prompts)  # "today" pinned to AS_OF


def test_a_broken_model_falls_back_and_scores_zero(fake_model):
    from evals.suites import sql

    fake_model("broken")
    m = sql.run("openrouter", "dev")["metrics"]
    assert m["execution_accuracy"]["passed"] == 0
    assert m["fallback_rate"]["passed"] == m["fallback_rate"]["total"] == 32


def test_replay_without_a_recording_is_a_hard_gate_failure(monkeypatch, tmp_path):
    from evals import run

    monkeypatch.setenv("LUMEN_CASSETTE_DIR", str(tmp_path / "none"))
    assert run.main(["--tier", "openrouter", "--suite", "sql"], results_dir=tmp_path) == 1
    report = json.loads((tmp_path / "dev-openrouter-dev.json").read_text(encoding="utf-8"))
    assert report["suites"]["sql"]["hard_gate_failures"][0].startswith("cassette miss")
