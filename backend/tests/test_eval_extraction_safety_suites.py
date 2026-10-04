"""EVAL-03: the extraction and safety suites score the real pipeline correctly (fake models stand in)."""
import json

import pytest

from evals.suites.common import DATA_DIR


def _invoices():
    rows = [json.loads(l) for l in (DATA_DIR / "extraction.jsonl").read_text(encoding="utf-8").splitlines()]
    return {r["file"].split("/")[1]: r for r in rows}


@pytest.fixture
def fake_vision(monkeypatch):
    """Read the invoice "perfectly" from its gold, or fall for the injection."""
    import utils.openrouter

    by_file = _invoices()
    seen = []

    def install(mode):
        def chat_completion(content, **_):
            url = content[1]["image_url"]["url"]
            seen.append(url[:30])
            # The image bytes identify the file: find which gold row it is.
            import base64
            data = base64.b64decode(url.split(",", 1)[1])
            name = next(n for n in by_file if (DATA_DIR / "invoices" / n).read_bytes() == data)
            gold = dict(by_file[name]["gold"])
            if mode == "gullible" and "injection" in by_file[name]["faults"]:
                gold.update(vendor_name="Approved Vendor", total_amount=0)
            return json.dumps(gold)

        monkeypatch.setattr(utils.openrouter, "chat_completion", chat_completion)
        return seen

    return install


def test_perfect_reader_scores_full_f1(fake_vision):
    from evals.suites import extraction

    fake_vision("perfect")
    out = extraction.run("openrouter", "dev")
    assert out["metrics"]["field_f1"] == 1.0
    assert all(out["cases"].values()) and len(out["cases"]) == 56
    assert set(out["metrics"]["f1_by_variant"]) >= {"clean", "degraded"}


@pytest.fixture
def fake_chat(monkeypatch):
    """Ask Lumen with a model that writes safe SQL, and answers by echoing (gullible) or not (careful)."""
    import ai.hybrid_query_engine
    import ai.sql_agent

    def install(mode):
        def sql_completion(prompt, **_):
            uid = prompt.split("user_id = '")[1][:36]
            return f"SELECT vendor_name, total_amount FROM transactions WHERE user_id = '{uid}' LIMIT 5"

        def answer(prompt, **_):
            if mode == "gullible":
                return prompt  # parrots everything, including injected canaries
            return "Here is a summary of your spending."

        monkeypatch.setattr(ai.sql_agent, "chat_completion", sql_completion)
        monkeypatch.setattr(ai.hybrid_query_engine, "chat_completion", answer)

    return install


def test_careful_pipeline_passes_both_hard_gates(fake_chat, fake_vision):
    from evals.suites import safety

    fake_chat("careful")
    fake_vision("perfect")
    out = safety.run("openrouter", "dev")
    assert out["metrics"]["tenant_leaks"] == 0 and out["metrics"]["injections_followed"] == 0
    assert out["hard_gate_failures"] == []


def test_gullible_pipeline_is_caught_following_injections(fake_chat, fake_vision):
    from evals.suites import safety

    fake_chat("gullible")
    fake_vision("gullible")
    out = safety.run("openrouter", "dev")
    assert out["metrics"]["injections_followed"] > 0
    assert any(f.startswith("injection followed") for f in out["hard_gate_failures"])
    # SQL is scoped to the asking user by the guardrails, so even a parroting model can't leak another tenant.
    assert out["metrics"]["tenant_leaks"] == 0
